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
  AAL_WINDOW_YEARS,
  INSURED_PENETRATION_FACTOR,
  type NfipSwflAggregate,
  type NfipZipAggregate,
} from "../sources/fema-nfip-source.mts";
import {
  usgsWaterSource,
  type HydroSwflAggregate,
} from "../sources/usgs-water-source.mts";
import {
  barrierClassFor,
  capRateBpsFor,
  capRateBpsRangeFor,
} from "../lib/swfl-geo.mts";
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
  /**
   * Top-N (currently 6) highest-AAL SWFL ZIPs from the fema-nfip source, each
   * carrying per-insured-property AAL$/yr, percentile rank across all SWFL
   * ZIPs with ≥1 claim in window, median building_property_value (for the
   * insurance-as-pct-of-NOI calc), denominator basis string, and window meta.
   * Empty when fixture mode lacks the new fragment kind OR live mode returns
   * zero NFIP rows — the producer then falls back to the SWFL-area conclusion
   * path and selectEnvMode returns "no-data".
   */
  zipAggregates: NfipZipAggregate[];
  /** Provenance: earliest fetched_at across the per-ZIP fragments, when present. */
  zip_aggregates_fetched_at: string | null;
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

/** Collect every nfip-zip-aggregate fragment (top-N per refine). */
function zipAggregatesFrom(fragments: RawFragment[]): {
  aggs: NfipZipAggregate[];
  fetched_at: string | null;
} {
  const hits = fragments.filter(
    (f) =>
      (f.normalized as { kind?: string } | null)?.kind === "nfip-zip-aggregate",
  );
  if (hits.length === 0) return { aggs: [], fetched_at: null };
  // Earliest fetched_at across the per-ZIP fragments — provenance for the
  // citation rendered on each per-ZIP metric.
  let earliest = hits[0].fetched_at;
  for (const h of hits) {
    if (h.fetched_at < earliest) earliest = h.fetched_at;
  }
  return {
    aggs: hits.map((h) => h.normalized as unknown as NfipZipAggregate),
    fetched_at: earliest,
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
    zipAggregates: [],
    zip_aggregates_fetched_at: null,
  };
}

// ---------------------------------------------------------------------
// Mode selection + direction vote — bearish or neutral only.
// Flood risk has no upside. Mode logic joins NfipZipAggregate fragments
// against the static barrier-island classification in swfl-geo.mts.
// ---------------------------------------------------------------------

interface EnvVote {
  direction: BrainOutputDirection;
  magnitude: number;
  swfl_sfha_pct: number;
  swfl_ve_pct: number;
}

/** Recovery-shadow window: any storm within this many years forces bearish-0.6 floor. */
const STORM_SHADOW_YEARS = 3;

/**
 * Per-insured-property AAL threshold (USD/yr) above which a barrier-island
 * ZIP triggers the flood-veto mode. Calibrated from Wharton/Kousky NFIP-
 * claims-based ranges (barrier-island avg claim ~$134k ÷ ~10-yr return ÷
 * ~30% NFIP-coverage proxy). Group C's constitution rule (PR-to-follow)
 * imports this same value so the producer-side mode and the constitution-
 * side override fire on the identical boundary. Revisit after the first
 * full live refine — open question §1 in the restructure plan.
 */
export const FLOOD_VETO_AAL_THRESHOLD_USD = 800;

/**
 * Four-state mode selection consumed by both `voteEnvDirection` (for
 * direction/magnitude) and `envSwflOutputProducer` (for conclusion template).
 * Centralising the mode keeps the two surfaces aligned by construction.
 *
 *   "barrier-veto"     — any ZIP with barrier_score 1.0 AND aal ≥ $800/yr.
 *                        Headline mode; binding flood-veto signal.
 *   "coastal-mainland" — no barrier-veto fire AND ≥1 ZIP with score ≥ 0.5.
 *                        Includes barrier ZIPs whose AAL is below threshold.
 *   "inland"           — only ZIPs at barrier_score 0.0.
 *   "no-data"          — empty zipAggregates. Caller falls back to the
 *                        SWFL-area-aggregate path.
 */
export type EnvMode =
  | "barrier-veto"
  | "coastal-mainland"
  | "inland"
  | "no-data";

export function selectEnvMode(
  snapshot: EnvSnapshot,
  threshold: number = FLOOD_VETO_AAL_THRESHOLD_USD,
): EnvMode {
  const zips = snapshot.zipAggregates;
  if (!zips || zips.length === 0) return "no-data";

  // Mode 1: any barrier ZIP whose per-insured-property AAL clears the
  // veto threshold. Iterate once; first hit short-circuits.
  for (const z of zips) {
    const cls = barrierClassFor(z.zip);
    if (cls.score === 1.0 && z.aal_usd_per_insured_property >= threshold) {
      return "barrier-veto";
    }
  }

  // Mode 2: any ZIP whose barrier_score ≥ 0.5 — coastal-mainland OR a barrier
  // ZIP that fell below the veto threshold. The latter is intentional: a
  // barrier with low realized AAL is still NOT inland, and the +20-35 bps
  // language is the honest read.
  for (const z of zips) {
    const cls = barrierClassFor(z.zip);
    if (cls.score >= 0.5) return "coastal-mainland";
  }

  // Mode 3: every snapshot ZIP is barrier_score 0.0.
  return "inland";
}

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

  const mode = selectEnvMode(snapshot);

  // Mode-driven magnitude when per-ZIP data is available. The old SWFL-wide
  // SFHA/VE area tiers stay as the no-data fallback only — they were too
  // coarse to read a barrier-island metro correctly (see plan §A.1).
  let baseMagnitude: number;
  let baseDirection: BrainOutputDirection;
  if (mode === "barrier-veto") {
    baseDirection = "bearish";
    baseMagnitude = 0.8;
  } else if (mode === "coastal-mainland") {
    baseDirection = "bearish";
    baseMagnitude = 0.4;
  } else if (mode === "inland") {
    baseDirection = "neutral";
    baseMagnitude = 0.2;
  } else {
    // no-data — replicate legacy SFHA/VE area-aggregate tier logic verbatim.
    if (swfl_sfha_pct > 0.4 || swfl_ve_pct > 0.08) {
      baseMagnitude = 0.8;
      baseDirection = "bearish";
    } else if (swfl_sfha_pct > 0.3 || swfl_ve_pct > 0.05) {
      baseMagnitude = 0.6;
      baseDirection = "bearish";
    } else if (swfl_sfha_pct > 0.2 || swfl_ve_pct > 0.02) {
      baseMagnitude = 0.4;
      baseDirection = "bearish";
    } else {
      baseMagnitude = 0.2;
      baseDirection = "neutral";
    }
  }

  // Storm-shadow override: any named SWFL hurricane within STORM_SHADOW_YEARS
  // forces a bearish floor of 0.6 regardless of mode. The physical signal
  // (insurance market dislocation, contractor capacity, reinsurer pricing)
  // outlasts the storm year by ~3 years. As of 2026 the recent storms are
  // Ian 2022, Helene 2024, Milton 2024 — env-swfl reads bearish through 2027
  // even if mode is inland. Once 2028+ rolls around with no new storm, this
  // reverts to pure mode-driven logic.
  const recentStorm = SWFL_STORM_YEARS.some(
    (s) => currentYear - s.year <= STORM_SHADOW_YEARS,
  );
  if (recentStorm) {
    return {
      direction: "bearish",
      magnitude: Math.max(0.6, baseMagnitude),
      swfl_sfha_pct,
      swfl_ve_pct,
    };
  }

  return {
    direction: baseDirection,
    magnitude: baseMagnitude,
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
const METRIC_NFIP_POST_IAN_RATIO = "swfl_post_ian_claims_ratio";

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

  const zipHit = zipAggregatesFrom(allFragments);
  snapshot.zipAggregates = zipHit.aggs;
  snapshot.zip_aggregates_fetched_at = zipHit.fetched_at;

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

  // Per-ZIP NFIP metrics — 5 records per top SWFL ZIP. The zipAggregates list
  // is whatever fema-nfip-source's aggregateZipRollupTop6 emitted, joined at
  // render time against swfl-geo's static barrier-island classification. v1
  // denominator is population × 0.30 NSI proxy — surfaced in the denominator
  // caveat below. Per-ZIP metric URLs all point at the same OpenFEMA endpoint;
  // the citation field carries the ZIP and the denominator basis so a
  // disputant can trace any per-ZIP number back to its computation.
  const mode = selectEnvMode(snapshot);
  for (const z of snapshot.zipAggregates) {
    const classified = barrierClassFor(z.zip);
    const bps = capRateBpsFor(classified.score);
    const insurancePctNoi = computeInsurancePctNoi(z);
    const source = zipAggregateSource(snapshot, z);
    key_metrics.push({
      metric: `swfl_zip_${z.zip}_flood_aal_usd_per_insured_property`,
      value: z.aal_usd_per_insured_property,
      direction: "stable",
      label: `${z.zip} (${z.county_name} County) per-insured-property NFIP AAL — ${AAL_WINDOW_YEARS}-year window ending ${z.window_end_year}`,
      variable_type: "intensive",
      units: "USD/year",
      display_format: "currency",
      source,
    });
    key_metrics.push({
      metric: `swfl_zip_${z.zip}_flood_aal_pct_swfl_rank`,
      value: z.aal_pct_swfl_rank,
      direction: "stable",
      label: `${z.zip} percentile rank by per-insured-property AAL across SWFL ZIPs with ≥1 claim in window`,
      variable_type: "intensive",
      units: "percentile",
      display_format: "raw",
      source,
    });
    key_metrics.push({
      metric: `swfl_zip_${z.zip}_barrier_island_score`,
      value: classified.score,
      direction: "stable",
      label: `${z.zip} barrier-island classification (1.0 barrier / 0.5 coastal-mainland / 0.0 inland)`,
      variable_type: "intensive",
      units: "score",
      display_format: "raw",
      source: {
        url: "internal://refinery/lib/swfl-geo.mts",
        fetched_at: source.fetched_at,
        tier: 1,
        citation: `Static SWFL barrier-island classification table (refinery/lib/swfl-geo.mts): ZIP ${z.zip} → ${classified.classification}.`,
      },
    });
    key_metrics.push({
      metric: `swfl_zip_${z.zip}_flood_cap_rate_adj_bps`,
      value: bps,
      direction: "stable",
      label: `${z.zip} flood cap-rate adjustment (${capRateBpsRangeFor(classified.score)})`,
      variable_type: "intensive",
      units: "bps",
      display_format: "raw",
      source: {
        url: "internal://refinery/lib/swfl-geo.mts",
        fetched_at: source.fetched_at,
        tier: 1,
        citation: `swfl-geo capRateBpsFor(${classified.score}) midpoint; range ${capRateBpsRangeFor(classified.score)}. Calibrated against ULI/LaSalle 2024 "+25-50 bps for elevated physical risk" stratified by exposure intensity.`,
      },
    });
    key_metrics.push({
      metric: `swfl_zip_${z.zip}_insurance_pct_typical_noi`,
      value: insurancePctNoi,
      direction: "stable",
      label: `${z.zip} imputed flood insurance as fraction of NOI (8% cap on median building value)`,
      variable_type: "intensive",
      units: "ratio",
      display_format: "ratio",
      source: {
        url: source.url,
        fetched_at: source.fetched_at,
        tier: 1,
        citation: `Computed: (AAL × 2) ÷ (median_building_property_value × 0.08). AAL = ${z.aal_usd_per_insured_property} USD/yr; median building value = ${z.median_building_property_value_usd} USD; 8% cap-rate assumption. Source: ${source.citation}`,
      },
    });
  }

  // ------------------------------------------------------------------
  // Conclusion — mode-branched. Three templates per plan §A.3 when ZIP
  // aggregates are available; legacy SWFL-area prose for the no-data
  // fallback only. The "flood-veto territory" disclaimer that lived here
  // pre-2026-05-19 is gone — the per-ZIP metrics ARE the receipt; the
  // prose disclaimer re-stated them and violated CLAUDE.md's "no caveat
  // that restates a fact already in a metric" rule.
  // ------------------------------------------------------------------
  const conclusionParts: string[] = [];

  if (mode === "no-data") {
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
    if (snapshot.hydro && snapshot.hydro.sw_stage_caloosahatchee_ft !== null) {
      const h = snapshot.hydro;
      conclusionParts.push(
        `Hydrology — Caloosahatchee surface stage at gage local zero was ${h.sw_stage_caloosahatchee_ft.toFixed(2)} ft on its latest read (${h.sw_stage_window.end}).`,
      );
    }
  } else {
    conclusionParts.push(modeConclusion(mode, snapshot));
  }

  // Trailing insurance-market sentence — fires regardless of mode when the
  // post-Ian recovery ratio is still elevated. Quantified per CLAUDE.md
  // smoothing-token rules.
  if (snapshot.nfip && snapshot.nfip.post_ian_ratio > 2.0) {
    conclusionParts.push(
      `Insurance-market signal — most recent complete year (${snapshot.nfip.latest_complete_year}) ran ${snapshot.nfip.post_ian_ratio.toFixed(2)}× the non-storm NFIP baseline; the post-Ian rate environment is still binding.`,
    );
  }

  // ------------------------------------------------------------------
  // Caveats — keep technical+data-quality ones; add denominator-proxy
  // gap when ZIP aggregates are present (so the v1 NSI 0.30 assumption
  // is visible to every downstream consumer).
  // ------------------------------------------------------------------
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
  if (snapshot.zipAggregates.length > 0) {
    caveats.push(
      `Per-ZIP AAL denominator uses 2020 ACS population × ${INSURED_PENETRATION_FACTOR} NSI-coverage proxy for insured-property count (v1). Replace with the live OpenFEMA NFIP Policies insured count in v2 before treating per-ZIP magnitudes as policy-grade — current numbers compress toward each other when actual NFIP penetration in a ZIP diverges from the 30% proxy.`,
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

// ---------------------------------------------------------------------
// Per-ZIP helpers.
// ---------------------------------------------------------------------

/**
 * Imputed annual flood-insurance premium as a fraction of NOI:
 *   insurance ≈ AAL × 2 (loss-ratio inverse to premium)
 *   NOI       ≈ median_building_property_value × 0.08 (8% cap-rate assumption)
 * Defensive: returns 0 when the median building value is non-positive (no
 * valid rows). The 8% cap is conservative for SWFL value-add multifamily and
 * survives the smoothing-token ban as a stated assumption with a number.
 */
function computeInsurancePctNoi(z: NfipZipAggregate): number {
  if (z.median_building_property_value_usd <= 0) return 0;
  const num = z.aal_usd_per_insured_property * 2;
  const denom = z.median_building_property_value_usd * 0.08;
  return num / denom;
}

/** Median of a number array, returns 0 on empty. */
function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

const FEMA_NFIP_TABLE_URL_FOR_ZIP =
  "https://www.fema.gov/api/open/v2/FimaNfipClaims";

function zipAggregateSource(
  snapshot: EnvSnapshot,
  z: NfipZipAggregate,
): BrainOutputMetricSource {
  const provenance =
    env.source === "live"
      ? "OpenFEMA FimaNfipClaims via data_lake.fema_nfip_claims"
      : "OpenFEMA FimaNfipClaims (fixture; refinery/__fixtures__/fema-nfip-swfl.sample.json)";
  return {
    url: FEMA_NFIP_TABLE_URL_FOR_ZIP,
    fetched_at:
      snapshot.zip_aggregates_fetched_at ?? snapshot.earliest_fetched_at,
    tier: 1,
    citation: `${provenance}, ZIP ${z.zip} (${z.county_name} County, FIPS ${z.county_code}), AAL window = last ${z.window_years} years ending ${z.window_end_year}, ${z.claim_count_in_window} claims in window, ${z.insured_denominator_basis}.`,
  };
}

/**
 * Mode-branched conclusion templates. Three modes from plan §A.3:
 *   barrier-veto      — top barrier ZIP cleared the $800 trigger; +50-70 bps.
 *   coastal-mainland  — ≥1 ZIP at barrier_score ≥ 0.5 (no veto fire); +20-35 bps.
 *   inland            — every snapshot ZIP at barrier_score 0.0; no adjustment.
 * Numbers are quantified per CLAUDE.md (no prose softening of deterministic
 * values). The `mode` argument is the same EnvMode that drove the direction
 * vote, so producer narrative and machine direction can never disagree.
 */
function modeConclusion(
  mode: Exclude<EnvMode, "no-data">,
  snapshot: EnvSnapshot,
): string {
  const zips = snapshot.zipAggregates;
  const sortedDesc = [...zips].sort(
    (a, b) => b.aal_usd_per_insured_property - a.aal_usd_per_insured_property,
  );

  if (mode === "barrier-veto") {
    const topBarrier =
      sortedDesc.find((z) => barrierClassFor(z.zip).score === 1.0) ??
      sortedDesc[0];
    const mainlandSameCounty = zips.filter(
      (z) =>
        z.county_code === topBarrier.county_code &&
        barrierClassFor(z.zip).score < 1.0,
    );
    const mainlandMedian = medianOf(
      mainlandSameCounty.map((z) => z.aal_usd_per_insured_property),
    );
    const mainlandClause =
      mainlandSameCounty.length > 0
        ? `, vs the ${topBarrier.county_name}-mainland median of $${Math.round(mainlandMedian).toLocaleString()}/yr per insured property`
        : "";
    const insPct = computeInsurancePctNoi(topBarrier);
    return (
      `Barrier-island SWFL ZIPs carry order-of-magnitude higher flood loss: ${topBarrier.zip} (${topBarrier.county_name} County) runs $${Math.round(topBarrier.aal_usd_per_insured_property).toLocaleString()}/yr per insured property ` +
      `(${Math.round(topBarrier.aal_pct_swfl_rank)}th percentile across SWFL ZIPs with claims in window)${mainlandClause}. ` +
      `CRE translation: +50-70 bps cap-rate adjustment for barrier-island flood exposure; imputed flood insurance runs ${(insPct * 100).toFixed(1)}% of NOI at an 8% cap. ` +
      `Geography is the entire signal — flood risk for a ${topBarrier.county_name} County address is a property of the ZIP, not the metro.`
    );
  }

  if (mode === "coastal-mainland") {
    const coastalish = zips.filter((z) => barrierClassFor(z.zip).score >= 0.5);
    const topCoastal = [...coastalish].sort(
      (a, b) => b.aal_usd_per_insured_property - a.aal_usd_per_insured_property,
    )[0];
    const med = medianOf(coastalish.map((z) => z.aal_usd_per_insured_property));
    const insPct = computeInsurancePctNoi(topCoastal);
    return (
      `SWFL coastal-mainland ZIPs cluster at $${Math.round(med).toLocaleString()}/yr per insured property over the ${AAL_WINDOW_YEARS}-year window, ` +
      `with no ZIP crossing the $${FLOOD_VETO_AAL_THRESHOLD_USD}/yr barrier-island band. ` +
      `CRE translation: +20-35 bps cap-rate adjustment for coastal-mainland flood exposure; imputed flood insurance runs ${(insPct * 100).toFixed(1)}% of NOI at an 8% cap. ` +
      `Flood exposure here is a real but bounded line item, not a structural veto.`
    );
  }

  // inland
  const topInland = sortedDesc[0];
  const insPct = computeInsurancePctNoi(topInland);
  return (
    `SWFL inland ZIPs in this snapshot show $${Math.round(topInland.aal_usd_per_insured_property).toLocaleString()}/yr or less per insured property over the ${AAL_WINDOW_YEARS}-year window — ` +
    `below the $${FLOOD_VETO_AAL_THRESHOLD_USD}/yr threshold where flood becomes a binding underwriting factor. ` +
    `CRE translation: no flood cap-rate adjustment indicated; imputed flood insurance runs ${(insPct * 100).toFixed(1)}% of NOI.`
  );
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
