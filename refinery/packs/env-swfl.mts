import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputDirection,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import {
  envSwflSource,
  buildFemaStatsUrl,
  type EnvSwflNormalized,
} from "../sources/env-swfl-source.mts";
import {
  femaNfipSource,
  SWFL_STORM_YEARS,
  SWFL_STORM_YEARS_LAST_REVIEWED,
  type NfipSwflAggregate,
} from "../sources/fema-nfip-source.mts";
import {
  usgsWaterSource,
  type HydroSwflAggregate,
} from "../sources/usgs-water-source.mts";
import { env } from "../config/env.mts";

/**
 * env-swfl — Southwest Florida flood-hazard exposure derived directly from
 * the FEMA National Flood Hazard Layer (Layer 28 / S_FLD_HAZ_AR).
 *
 * Branches: per-county area-weighted aggregates across the 6 SWFL counties
 * (Lee, Collier, Charlotte, Glades, Hendry, Sarasota). One fragment per
 * (county, FLD_ZONE) pair — see refinery/sources/env-swfl-source.mts for the
 * fetch shape and docs/env-swfl-spike-findings.md for the verified endpoint
 * contract.
 *
 * Leaf brain (no upstream brains). env-swfl becomes the FIRST upstream a
 * future flood-veto override consults — declared via `input_brains: ["env-swfl"]`
 * with `edge_type: "veto"` once typed DAG edges land (Session 8 P5).
 *
 * Pure deterministic pack — every key_metric is computed in code from typed
 * fragments. No synthesis agent, no triage agent.
 *
 * P2 BENCHMARK: env-swfl is the first brain to ship with per-metric
 * provenance populated on every key_metric. The `source` field on each metric
 * carries the exact URL + fetched_at + tier + citation that produced the
 * value. Other packs retrofit as they're touched. This is the "we have
 * receipts" contract made structural — a disputant can trace any number in
 * this brain's OUTPUT back to a specific FEMA query.
 *
 * Direction policy: environmental flood risk has no upside. The brain emits
 * "bearish" when SFHA exposure crosses thresholds and "neutral" otherwise.
 * It never emits "bullish" — the absence of flood risk is the baseline, not
 * an upside signal.
 */

// ---------------------------------------------------------------------
// Closure state — populated by corpusSummary, read by outputProducer.
// Same pattern as tourism-tdt: typed values cannot survive in
// SynthesisFact.value (which is a string).
// ---------------------------------------------------------------------
let lastSnapshot: EnvSnapshot | null = null;

interface CountyAggregate {
  fips: string;
  name: string;
  bbox: [number, number, number, number];
  /** Per-zone fragments belonging to this county. */
  zones: EnvSwflNormalized[];
  /** Sum of area_sq_deg across all returned zones for this county. */
  total_area_sq_deg: number;
  /** Sum of area_sq_deg across SFHA-classified zones. */
  sfha_area_sq_deg: number;
  /** Sum of area_sq_deg across VE-family coastal high-hazard zones. */
  ve_area_sq_deg: number;
  /** Count of distinct VE-family polygons. */
  ve_polygon_count: number;
  /** Earliest fetched_at across this county's fragments (for provenance). */
  fetched_at: string;
}

interface EnvSnapshot {
  counties: CountyAggregate[];
  /** Aggregated SWFL-wide rollup. Zero when zero fragments survived. */
  swfl_total_area_sq_deg: number;
  swfl_sfha_area_sq_deg: number;
  swfl_ve_area_sq_deg: number;
  swfl_ve_polygon_count: number;
  /** Earliest fetched_at across all fragments — feeds source.fetched_at. */
  earliest_fetched_at: string;
  /**
   * Realized-loss NFIP aggregate for the 6 SWFL counties, populated from the
   * fema-nfip swfl-aggregate fragment when one was returned. Null when fixture
   * mode lacks NFIP data or live mode returns zero NFIP rows — the 4 NFIP
   * metrics are then silently omitted from outputProducer.
   */
  nfip: NfipSwflAggregate | null;
  /** Provenance: fetched_at of the NFIP swfl-aggregate fragment, if present. */
  nfip_fetched_at: string | null;
  /**
   * USGS hydro aggregate (groundwater + surface stage + rainfall + high-water
   * exceedance days) for SWFL, populated from the usgs-water hydro-swfl-aggregate
   * fragment when one was returned. Null when the source had no SWFL sites or
   * no usable rows — the 4 hydro metrics are then silently omitted.
   */
  hydro: HydroSwflAggregate | null;
  /** Provenance: fetched_at of the USGS hydro-swfl-aggregate fragment, if present. */
  hydro_fetched_at: string | null;
}

function envFragmentsFrom(fragments: RawFragment[]): EnvSwflNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as EnvSwflNormalized)
    .filter((n) => n?.kind === "env-zone-aggregate");
}

/** Find the single NFIP swfl-aggregate fragment among all sources. */
function nfipAggregateFrom(
  fragments: RawFragment[],
): { agg: NfipSwflAggregate; fetched_at: string } | null {
  const hit = fragments.find(
    (f) =>
      (f.normalized as { kind?: string } | null)?.kind ===
      "nfip-swfl-aggregate",
  );
  if (!hit) return null;
  return {
    agg: hit.normalized as unknown as NfipSwflAggregate,
    fetched_at: hit.fetched_at,
  };
}

/** Find the single USGS hydro-swfl-aggregate fragment among all sources. */
function hydroAggregateFrom(
  fragments: RawFragment[],
): { agg: HydroSwflAggregate; fetched_at: string } | null {
  const hit = fragments.find(
    (f) =>
      (f.normalized as { kind?: string } | null)?.kind ===
      "hydro-swfl-aggregate",
  );
  if (!hit) return null;
  return {
    agg: hit.normalized as unknown as HydroSwflAggregate,
    fetched_at: hit.fetched_at,
  };
}

function buildSnapshot(rows: EnvSwflNormalized[]): EnvSnapshot {
  const byCounty = new Map<string, EnvSwflNormalized[]>();
  for (const r of rows) {
    const arr = byCounty.get(r.county_fips) ?? [];
    arr.push(r);
    byCounty.set(r.county_fips, arr);
  }

  const counties: CountyAggregate[] = [];
  for (const [fips, zones] of byCounty) {
    const total = zones.reduce((s, z) => s + z.area_sq_deg, 0);
    const sfha = zones
      .filter((z) => z.is_sfha)
      .reduce((s, z) => s + z.area_sq_deg, 0);
    const ve = zones
      .filter((z) => z.is_ve_zone)
      .reduce((s, z) => s + z.area_sq_deg, 0);
    const vePolyCount = zones
      .filter((z) => z.is_ve_zone)
      .reduce((s, z) => s + z.polygon_count, 0);
    const earliest = zones.reduce(
      (acc, z) => (z.fetched_at < acc ? z.fetched_at : acc),
      zones[0].fetched_at,
    );
    counties.push({
      fips,
      name: zones[0].county_name,
      bbox: zones[0].bbox,
      zones,
      total_area_sq_deg: total,
      sfha_area_sq_deg: sfha,
      ve_area_sq_deg: ve,
      ve_polygon_count: vePolyCount,
      fetched_at: earliest,
    });
  }

  counties.sort((a, b) => a.fips.localeCompare(b.fips));

  const swfl_total = counties.reduce((s, c) => s + c.total_area_sq_deg, 0);
  const swfl_sfha = counties.reduce((s, c) => s + c.sfha_area_sq_deg, 0);
  const swfl_ve = counties.reduce((s, c) => s + c.ve_area_sq_deg, 0);
  const swfl_ve_poly = counties.reduce((s, c) => s + c.ve_polygon_count, 0);
  const earliest_fetched_at =
    counties.length === 0
      ? new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
      : counties.reduce(
          (acc, c) => (c.fetched_at < acc ? c.fetched_at : acc),
          counties[0].fetched_at,
        );

  return {
    counties,
    swfl_total_area_sq_deg: swfl_total,
    swfl_sfha_area_sq_deg: swfl_sfha,
    swfl_ve_area_sq_deg: swfl_ve,
    swfl_ve_polygon_count: swfl_ve_poly,
    earliest_fetched_at,
    nfip: null,
    nfip_fetched_at: null,
    hydro: null,
    hydro_fetched_at: null,
  };
}

// ---------------------------------------------------------------------
// Direction vote — bearish or neutral only. Flood risk has no upside.
// ---------------------------------------------------------------------

interface EnvVote {
  direction: BrainOutputDirection;
  magnitude: number;
  swfl_sfha_pct: number;
  swfl_ve_pct: number;
}

/** Recovery-shadow window: any storm within this many years forces bearish-0.6 floor. */
const STORM_SHADOW_YEARS = 3;

export function voteEnvDirection(
  snapshot: EnvSnapshot,
  currentYear: number = new Date().getUTCFullYear(),
): EnvVote {
  const swfl_sfha_pct =
    snapshot.swfl_total_area_sq_deg > 0
      ? snapshot.swfl_sfha_area_sq_deg / snapshot.swfl_total_area_sq_deg
      : 0;
  const swfl_ve_pct =
    snapshot.swfl_total_area_sq_deg > 0
      ? snapshot.swfl_ve_area_sq_deg / snapshot.swfl_total_area_sq_deg
      : 0;

  // Compute the SFHA/VE threshold magnitude first, so the storm-shadow floor
  // takes max(0.6, modeled-risk magnitude).
  let sfhaMagnitude = 0.2;
  let sfhaDirection: BrainOutputDirection = "neutral";
  if (swfl_sfha_pct > 0.4 || swfl_ve_pct > 0.08) {
    sfhaMagnitude = 0.8;
    sfhaDirection = "bearish";
  } else if (swfl_sfha_pct > 0.3 || swfl_ve_pct > 0.05) {
    sfhaMagnitude = 0.6;
    sfhaDirection = "bearish";
  } else if (swfl_sfha_pct > 0.2 || swfl_ve_pct > 0.02) {
    sfhaMagnitude = 0.4;
    sfhaDirection = "bearish";
  }

  // Storm-shadow override: any named SWFL hurricane within STORM_SHADOW_YEARS
  // forces a bearish floor of 0.6 regardless of modeled SFHA exposure. The
  // physical signal (insurance market dislocation, contractor capacity,
  // reinsurer pricing) outlasts the storm year by ~3 years. As of 2026 the
  // recent storms are Ian 2022, Helene 2024, Milton 2024 — env-swfl reads
  // bearish through 2027 even if NFHL maps look benign. Once 2028+ rolls
  // around with no new storm, this reverts to pure SFHA logic.
  const recentStorm = SWFL_STORM_YEARS.some(
    (s) => currentYear - s.year <= STORM_SHADOW_YEARS,
  );
  if (recentStorm) {
    return {
      direction: "bearish",
      magnitude: Math.max(0.6, sfhaMagnitude),
      swfl_sfha_pct,
      swfl_ve_pct,
    };
  }

  return {
    direction: sfhaDirection,
    magnitude: sfhaMagnitude,
    swfl_sfha_pct,
    swfl_ve_pct,
  };
}

// ---------------------------------------------------------------------
// Provenance helpers — every metric carries its FEMA receipt inline.
// ---------------------------------------------------------------------

/** Layer-level URL, no bbox — used when the metric is a multi-county aggregate. */
const FEMA_LAYER_URL =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28";

function swflAggregateSource(snapshot: EnvSnapshot): BrainOutputMetricSource {
  const counties = snapshot.counties
    .map((c) => `${c.name} (${c.fips})`)
    .join(", ");
  return {
    url: FEMA_LAYER_URL,
    fetched_at: snapshot.earliest_fetched_at,
    tier: 1,
    citation: `FEMA NFHL Flood Hazard Zones (Layer 28 / S_FLD_HAZ_AR), area-weighted aggregate across ${snapshot.counties.length} SWFL counties: ${counties}.`,
  };
}

function countySource(county: CountyAggregate): BrainOutputMetricSource {
  return {
    url: buildFemaStatsUrl(county.bbox),
    fetched_at: county.fetched_at,
    tier: 1,
    citation: `FEMA NFHL Flood Hazard Zones (Layer 28 / S_FLD_HAZ_AR), groupBy FLD_ZONE with sum(Shape__Area), bbox ${county.bbox.join(",")} (${county.name} County, FIPS ${county.fips}).`,
  };
}

const FEMA_NFIP_TABLE_URL = "https://www.fema.gov/api/open/v2/FimaNfipClaims";

const USGS_WATER_BASE_URL = "https://waterservices.usgs.gov/nwis";

function hydroSource(
  snapshot: EnvSnapshot,
  parameterCd: string,
  windowDesc: string,
  siteNos: string[],
): BrainOutputMetricSource {
  const sites = siteNos.length > 0 ? siteNos.join(",") : "no sites";
  const provenance =
    env.source === "live"
      ? "USGS Water Services daily values via data_lake.usgs_daily"
      : "USGS Water Services (fixture; refinery/__fixtures__/usgs-water.sample.json)";
  return {
    url: `${USGS_WATER_BASE_URL}/dv/?stateCd=FL&parameterCd=${parameterCd}&siteStatus=active&format=json`,
    fetched_at: snapshot.hydro_fetched_at ?? snapshot.earliest_fetched_at,
    tier: 1,
    citation: `${provenance}, parameterCd ${parameterCd}, ${windowDesc}, sites: ${sites}.`,
  };
}

function nfipAggregateSource(snapshot: EnvSnapshot): BrainOutputMetricSource {
  const nfip = snapshot.nfip;
  if (!nfip) {
    // Defensive — outputProducer only calls this when nfip is populated.
    return {
      url: FEMA_NFIP_TABLE_URL,
      fetched_at: snapshot.earliest_fetched_at,
      tier: 1,
      citation: "OpenFEMA FimaNfipClaims — no aggregate fragment available.",
    };
  }
  const provenance =
    env.source === "live"
      ? "OpenFEMA FimaNfipClaims via data_lake.fema_nfip_claims"
      : "OpenFEMA FimaNfipClaims (fixture; refinery/__fixtures__/fema-nfip-swfl.sample.json)";
  return {
    url: FEMA_NFIP_TABLE_URL,
    fetched_at: snapshot.nfip_fetched_at ?? snapshot.earliest_fetched_at,
    tier: 1,
    citation: `${provenance}, FL state, 6 SWFL counties (FIPS ${nfip.county_codes.join("+")}), storm-list reviewed ${nfip.storm_year_list_reviewed_at}.`,
  };
}

// ---------------------------------------------------------------------
// Stage 3 — deterministic corpus facts.
// ---------------------------------------------------------------------

const METRIC_SWFL_SFHA = "swfl_sfha_pct_area_weighted";
const METRIC_SWFL_VE = "swfl_ve_zone_pct_area_weighted";
const METRIC_SWFL_VE_POLY = "swfl_ve_zone_polygon_count";
const METRIC_LEE_SFHA = "lee_county_sfha_pct_area_weighted";
const METRIC_LEE_VE = "lee_county_ve_zone_pct_area_weighted";
const METRIC_COLLIER_SFHA = "collier_county_sfha_pct_area_weighted";
const METRIC_COLLIER_VE = "collier_county_ve_zone_pct_area_weighted";

// Storm-vs-baseline NFIP realized-loss metrics. Slugs match the brain-vocabulary
// raw_slugs for env_flood_losses_swfl_* concepts (see refinery/vocab/brain-vocabulary.json).
const METRIC_NFIP_STORM_TOTAL = "swfl_storm_year_claims_usd";
const METRIC_NFIP_BASELINE = "swfl_nonstorm_claims_baseline";
const METRIC_NFIP_STORM_COUNT = "swfl_storm_frequency";
const METRIC_NFIP_POST_IAN_RATIO = "swfl_flood_recovery_ratio";

// USGS hydrology metric. Slug matches brain-vocabulary raw_slug for env_sw_*.
// Note: env_gw_* + env_rainfall_* metrics were stripped 2026-05-19 — Postgres
// table data_lake.usgs_daily was lost in the Cold Lane migration, and we do not
// ship degraded brains. Re-source via SFWMD DBHYDRO API when a consuming brain
// (or customer) requires those three hydrology metrics. See docs/superpowers/
// plans/2026-05-19-usgs-postgres-to-parquet-migration.md for the parked work.
const METRIC_HYDRO_SW_STAGE_CALOOSA = "swfl_sw_stage_caloosahatchee_ft";

function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

function countyCount(n: number): string {
  return `${n} ${n === 1 ? "county" : "counties"}`;
}

function envSwflCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const rows = envFragmentsFrom(allFragments);
  const snapshot = buildSnapshot(rows);

  // Fold in realized-loss aggregate from fema-nfip source (if present). The
  // NFIP fragment is a single SWFL-wide rollup; per-(county,year) fragments
  // are also emitted but the brain doesn't read them — they exist for ledger
  // traceability and any downstream brain that wants finer-grained access.
  const nfipHit = nfipAggregateFrom(allFragments);
  if (nfipHit) {
    snapshot.nfip = nfipHit.agg;
    snapshot.nfip_fetched_at = nfipHit.fetched_at;
  }

  const hydroHit = hydroAggregateFrom(allFragments);
  if (hydroHit) {
    snapshot.hydro = hydroHit.agg;
    snapshot.hydro_fetched_at = hydroHit.fetched_at;
  }

  lastSnapshot = snapshot;

  if (snapshot.counties.length === 0) return [];

  const facts: SynthesisFact[] = [];
  const vote = voteEnvDirection(snapshot);

  facts.push({
    topic: "env_snapshot",
    fact: `SWFL flood-hazard exposure — area-weighted across ${countyCount(snapshot.counties.length)}`,
    value:
      `Southwest Florida flood-hazard exposure across ${countyCount(snapshot.counties.length)}: ` +
      `${fmtPct(vote.swfl_sfha_pct)} of mapped area falls in a FEMA Special Flood Hazard Area, ` +
      `with ${fmtPct(vote.swfl_ve_pct)} in coastal high-hazard (V/VE) zones ` +
      `(${snapshot.swfl_ve_polygon_count.toLocaleString()} distinct VE polygons).`,
    source_fragment_ids: [],
  });

  for (const county of snapshot.counties) {
    const sfhaPct =
      county.total_area_sq_deg > 0
        ? county.sfha_area_sq_deg / county.total_area_sq_deg
        : 0;
    const vePct =
      county.total_area_sq_deg > 0
        ? county.ve_area_sq_deg / county.total_area_sq_deg
        : 0;
    facts.push({
      topic: `env_county:${county.fips}`,
      fact: `${county.name} County (FIPS ${county.fips}) flood-hazard exposure`,
      value:
        `${county.name} County area-weighted SFHA coverage: ${fmtPct(sfhaPct)}; ` +
        `coastal V/VE zones: ${fmtPct(vePct)} (${county.ve_polygon_count.toLocaleString()} VE polygons).`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

// ---------------------------------------------------------------------
// Stage 4 — BrainOutput producer with per-metric provenance.
// ---------------------------------------------------------------------

function envSwflOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snapshot = lastSnapshot;
  if (!snapshot || snapshot.counties.length === 0) {
    return {
      conclusion:
        "env-swfl: no usable FEMA NFHL aggregates in this build window — pack rendered with no metrics. Flood-veto cannot fire from this brain until live data is restored.",
      key_metrics: [],
      caveats: [
        "Zero FEMA NFHL zone aggregates survived fetch + normalization. Check REFINERY_SOURCE, network reachability to hazards.fema.gov, and the fixture file before treating this output as a real read.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const vote = voteEnvDirection(snapshot);
  const swflSource = swflAggregateSource(snapshot);

  const lee = snapshot.counties.find((c) => c.fips === "12071") ?? null;
  const leeSfhaPct =
    lee && lee.total_area_sq_deg > 0
      ? lee.sfha_area_sq_deg / lee.total_area_sq_deg
      : null;
  const leeVePct =
    lee && lee.total_area_sq_deg > 0
      ? lee.ve_area_sq_deg / lee.total_area_sq_deg
      : null;

  const collier = snapshot.counties.find((c) => c.fips === "12021") ?? null;
  const collierSfhaPct =
    collier && collier.total_area_sq_deg > 0
      ? collier.sfha_area_sq_deg / collier.total_area_sq_deg
      : null;
  const collierVePct =
    collier && collier.total_area_sq_deg > 0
      ? collier.ve_area_sq_deg / collier.total_area_sq_deg
      : null;

  const key_metrics: BrainOutputMetric[] = [];

  // SWFL-wide aggregates use the layer URL + multi-county citation.
  key_metrics.push({
    metric: METRIC_SWFL_SFHA,
    value: Math.round(vote.swfl_sfha_pct * 10000) / 10000,
    direction: "stable", // structural exposure — not a time-series rate
    label: "SWFL area-weighted Special Flood Hazard Area coverage",
    variable_type: "intensive",
    units: "ratio",
    display_format: "ratio",
    source: swflSource,
  });

  key_metrics.push({
    metric: METRIC_SWFL_VE,
    value: Math.round(vote.swfl_ve_pct * 10000) / 10000,
    direction: "stable",
    label: "SWFL area-weighted coastal high-hazard (V/VE) zone coverage",
    variable_type: "intensive",
    units: "ratio",
    display_format: "ratio",
    source: swflSource,
  });

  key_metrics.push({
    metric: METRIC_SWFL_VE_POLY,
    value: snapshot.swfl_ve_polygon_count,
    direction: "stable",
    label: "SWFL count of distinct coastal high-hazard (V/VE) polygons",
    variable_type: "extensive",
    units: "polygons",
    display_format: "count",
    source: swflSource,
  });

  // County-specific metrics use the specific bbox query URL.
  if (lee && leeSfhaPct !== null && leeVePct !== null) {
    const leeSource = countySource(lee);
    key_metrics.push({
      metric: METRIC_LEE_SFHA,
      value: Math.round(leeSfhaPct * 10000) / 10000,
      direction: "stable",
      label:
        "Lee County area-weighted SFHA coverage (Fort Myers Beach context)",
      variable_type: "intensive",
      units: "ratio",
      display_format: "ratio",
      source: leeSource,
    });
    key_metrics.push({
      metric: METRIC_LEE_VE,
      value: Math.round(leeVePct * 10000) / 10000,
      direction: "stable",
      label: "Lee County area-weighted coastal high-hazard (V/VE) coverage",
      variable_type: "intensive",
      units: "ratio",
      display_format: "ratio",
      source: leeSource,
    });
  }

  if (collier && collierSfhaPct !== null && collierVePct !== null) {
    const collierSource = countySource(collier);
    key_metrics.push({
      metric: METRIC_COLLIER_SFHA,
      value: Math.round(collierSfhaPct * 10000) / 10000,
      direction: "stable",
      label:
        "Collier County area-weighted SFHA coverage (Naples / Marco Island context)",
      variable_type: "intensive",
      units: "ratio",
      display_format: "ratio",
      source: collierSource,
    });
    key_metrics.push({
      metric: METRIC_COLLIER_VE,
      value: Math.round(collierVePct * 10000) / 10000,
      direction: "stable",
      label: "Collier County area-weighted coastal high-hazard (V/VE) coverage",
      variable_type: "intensive",
      units: "ratio",
      display_format: "ratio",
      source: collierSource,
    });
  }

  // Realized-loss NFIP metrics — only emit when the swfl-aggregate fragment
  // was produced (fixture mode without NFIP rows or live mode with 0 SWFL
  // rows both leave snapshot.nfip null; those reads degrade silently rather
  // than emit fake zeros).
  if (snapshot.nfip) {
    const nfipSource = nfipAggregateSource(snapshot);
    key_metrics.push({
      metric: METRIC_NFIP_STORM_TOTAL,
      value: snapshot.nfip.storm_year_total_usd,
      direction: "stable",
      label: `SWFL cumulative NFIP paid claims (B+C+ICO) across named storm years (${SWFL_STORM_YEARS.map((s) => `${s.name} ${s.year}`).join(", ")})`,
      variable_type: "extensive",
      units: "USD",
      display_format: "currency",
      source: nfipSource,
    });
    key_metrics.push({
      metric: METRIC_NFIP_BASELINE,
      value: snapshot.nfip.baseline_annual_usd,
      direction: "stable",
      label:
        "SWFL non-storm-year annual NFIP paid claims (median across all non-storm years in the archive)",
      variable_type: "extensive",
      units: "USD/year",
      display_format: "currency",
      source: nfipSource,
    });
    key_metrics.push({
      metric: METRIC_NFIP_STORM_COUNT,
      value: snapshot.nfip.storm_year_count_since_2000,
      direction: "stable",
      label: "SWFL named-storm-year count since 2000",
      variable_type: "extensive",
      units: "years",
      display_format: "count",
      source: nfipSource,
    });
    key_metrics.push({
      metric: METRIC_NFIP_POST_IAN_RATIO,
      value: snapshot.nfip.post_ian_ratio,
      direction: "stable",
      label: `SWFL latest-year NFIP claims ÷ non-storm baseline (numerator = ${snapshot.nfip.latest_complete_year} SWFL total)`,
      variable_type: "intensive",
      units: "ratio",
      display_format: "ratio",
      source: nfipSource,
    });
  }

  // USGS hydrology — only Caloosahatchee surface stage survives. gw_lee_median,
  // rainfall_swfl_annual, and gw_highwater_days were stripped 2026-05-19 (see
  // constants block above for the why). Source connector still pulls the data
  // for snapshot.hydro; the pack just no longer emits those three as metrics.
  if (snapshot.hydro && snapshot.hydro.sw_stage_caloosahatchee_ft !== null) {
    const h = snapshot.hydro;
    key_metrics.push({
      metric: METRIC_HYDRO_SW_STAGE_CALOOSA,
      value: h.sw_stage_caloosahatchee_ft,
      direction: "stable",
      label: `Caloosahatchee surface stage at gage local zero — latest reading (${h.sw_stage_window.end})`,
      variable_type: "intensive",
      units: "ft",
      display_format: "raw",
      source: hydroSource(
        snapshot,
        "00065",
        `latest dv read on ${h.sw_stage_window.end}, HUC 03090205 (Caloosahatchee)`,
        h.sw_stage_window.site_nos,
      ),
    });
  }

  const conclusionParts: string[] = [];
  conclusionParts.push(
    `Southwest Florida flood-hazard exposure across ${countyCount(snapshot.counties.length)}: ` +
      `${fmtPct(vote.swfl_sfha_pct)} of mapped area sits in a FEMA Special Flood Hazard Area, ` +
      `with ${fmtPct(vote.swfl_ve_pct)} in coastal V/VE high-hazard zones.`,
  );
  if (lee && leeVePct !== null && leeSfhaPct !== null) {
    conclusionParts.push(
      `Lee County specifically — the Fort Myers / Fort Myers Beach footprint — carries ${fmtPct(leeSfhaPct)} SFHA ` +
        `and ${fmtPct(leeVePct)} coastal high-hazard exposure (${lee.ve_polygon_count.toLocaleString()} VE polygons).`,
    );
  }
  if (collier && collierVePct !== null && collierSfhaPct !== null) {
    conclusionParts.push(
      `Collier County — Naples / Marco Island — carries ${fmtPct(collierSfhaPct)} SFHA ` +
        `and ${fmtPct(collierVePct)} coastal high-hazard exposure (${collier.ve_polygon_count.toLocaleString()} VE polygons).`,
    );
  }
  if (snapshot.nfip) {
    const stormUsd = Math.round(snapshot.nfip.storm_year_total_usd / 1_000_000);
    const baseUsd = Math.round(snapshot.nfip.baseline_annual_usd / 1000);
    conclusionParts.push(
      `Realized loss — NFIP paid claims across the 6 SWFL counties total $${stormUsd.toLocaleString()}M ` +
        `in the ${snapshot.nfip.storm_year_count_since_2000} named storm years since 2000 ` +
        `vs a non-storm baseline of $${baseUsd.toLocaleString()}k/year (median); ` +
        `${snapshot.nfip.latest_complete_year} ran ${snapshot.nfip.post_ian_ratio.toFixed(2)}× the baseline.`,
    );
  }
  if (snapshot.hydro && snapshot.hydro.sw_stage_caloosahatchee_ft !== null) {
    const h = snapshot.hydro;
    conclusionParts.push(
      `Hydrology — Caloosahatchee surface stage at gage local zero was ${h.sw_stage_caloosahatchee_ft.toFixed(2)} ft on its latest read (${h.sw_stage_window.end}).`,
    );
  }
  conclusionParts.push(
    vote.direction === "bearish"
      ? "Downstream consumers should treat barrier-island and coastal-V/VE coordinates as flood-veto territory until paired with a property-level lookup."
      : "Aggregate exposure does not by itself fire a region-wide flood-veto; property-level lookups remain required for coastal coordinates.",
  );

  const caveats: string[] = [];
  caveats.push(
    "Area aggregates are in square decimal degrees (WGS84 / EPSG:4326), not projected meters. Ratios across zones within the same county are accurate; absolute areas are NOT physical units and are never propagated.",
  );
  caveats.push(
    "Bbox-intersect queries include polygons that touch the county envelope, so edge polygons may belong to neighboring counties. The DFIRM_ID on each polygon is the authoritative county affiliation; v1 surfaces the bbox-aggregate without re-attributing edge polygons.",
  );
  if (env.source === "fixture") {
    caveats.push(
      "Fixture mode: only Lee County is populated. SWFL-wide metrics reflect Lee alone — switch to REFINERY_SOURCE=live for the full 6-county footprint.",
    );
  }
  if (snapshot.counties.length < 6 && env.source === "live") {
    caveats.push(
      `Live mode returned aggregates for only ${snapshot.counties.length} of 6 SWFL counties. Missing counties may indicate FEMA API throttling or empty bbox results — re-run before relying on the SWFL-wide rollup.`,
    );
  }
  // LOMR cache-invalidation note — v1 hits FEMA on every build, so the read
  // is always current at fetch time. Surface this honestly rather than imply
  // a cached snapshot.
  caveats.push(
    "FEMA NFHL is queried live on every refinery run (v1). LOMR-based cache invalidation (Layer 1, EFF_DATE) is documented in docs/env-swfl-spike-findings.md and reserved for v2 once a hot-path issue is observed.",
  );
  if (snapshot.nfip) {
    caveats.push(
      "NFIP claims are policyholder-only. Uninsured properties and parcels outside NFIP participation are NOT in the archive — true SWFL flood loss is materially larger than what these numbers show.",
    );
    caveats.push(
      `Storm-year list (Charley 2004, Wilma 2005, Irma 2017, Ian 2022, Helene 2024, Milton 2024) was last reviewed ${SWFL_STORM_YEARS_LAST_REVIEWED}. Requires update in refinery/sources/fema-nfip-source.mts when a new named storm hits SWFL.`,
    );
  }
  if (snapshot.hydro && snapshot.hydro.sw_stage_caloosahatchee_ft !== null) {
    caveats.push(
      "USGS surface stage metric includes both Approved (A) and Provisional (P) qualifiers — magnitudes may revise as USGS approves provisional readings over the 6-12 month review window. For approval-only reads, brain-level consumers should filter on the qualifiers column directly.",
    );
    caveats.push(
      "Three additional hydrology metrics (Lee groundwater median, SWFL annual rainfall, Lee groundwater high-water-day count) were stripped from this brain on 2026-05-19 after their backing Postgres table (data_lake.usgs_daily) was lost in the Cold Lane migration. Re-source via SFWMD DBHYDRO before depending on those signals.",
    );
  }

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats,
    direction: vote.direction,
    magnitude: vote.magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

export const envSwfl: PackDefinition = {
  id: "env-swfl",
  brain_id: "env-swfl",
  domain: "environmental",
  scope:
    "Southwest Florida flood-hazard exposure (modeled NFHL polygons), realized loss (NFIP paid claims), and observed Caloosahatchee surface stage (USGS daily value, parameterCd 00065) across the 6 SWFL counties (Lee, Collier, Charlotte, Glades, Hendry, Sarasota). Modeled side = area-weighted FEMA NFHL aggregates with coastal V/VE breakouts for barrier-island / flood-veto consumers. Realized side = storm-vs-baseline aggregates of historical NFIP paid claims with hardcoded SWFL hurricane list. Observed side = single USGS surface-stage metric for HUC 03090205 (Caloosahatchee) — groundwater, rainfall, and high-water-day signals were stripped 2026-05-19 pending re-source via SFWMD DBHYDRO.",
  ttl_seconds: 2592000, // 30 days — FEMA NFHL revisions arrive via LOMRs at multi-month cadence
  sources: [envSwflSource, femaNfipSource, usgsWaterSource],
  input_brains: [],
  // Every FEMA aggregate fragment belongs by construction; composite cutoff = 0
  // so the deterministic output survives triage uncontested.
  fitScore: (): number => 8,
  compositeCutoff: 0,
  // Pure deterministic — every fact computed in envSwflCorpusSummary.
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: envSwflCorpusSummary,
  outputProducer: envSwflOutputProducer,
  synthesisStrategy: "deterministic",
  preferences: [
    "The user is an SWFL operator who treats FEMA flood-zone designations as the authoritative read on structural flood exposure — never weaker secondary aggregators.",
    "The user expects coastal V/VE zone presence to be surfaced separately from general SFHA coverage because the barrier-island flood-veto rule keys on V/VE specifically.",
    "The user expects per-metric provenance on every value: a disputant should be able to trace any SFHA percentage back to the exact FEMA NFHL query that produced it.",
  ],
  activeProject:
    "env-swfl: standing flood-hazard exposure read for SWFL — area-weighted FEMA NFHL aggregates with coastal V/VE breakouts; first brain shipped with per-metric P2 provenance.",
  prompts: {
    triageContext:
      "These fragments are per-(county, FLD_ZONE) aggregates from the FEMA NFHL Flood Hazard Zones layer. They are all decision-relevant by construction; the pack is pure deterministic aggregation.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by envSwflCorpusSummary and the BrainOutput is built by envSwflOutputProducer with per-metric FEMA provenance attached.",
  },
};
