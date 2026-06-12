import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutput,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
  BrainOutputDetailRow,
} from "../types/brain-output.mts";
import { makeBrainInputSource, type BrainInputNormalized } from "../sources/brain-input-source.mts";
import { resolveZip } from "../lib/zip-resolver.mts";

/**
 * investor-zip-swfl — the per-ZIP investor composite.
 *
 * Joins three already-shipped upstream brains ON ZIP and computes, in code, the
 * one number nobody else pairs at ZIP grain: a flood-adjusted gross rent yield.
 *
 *   value ← home-values-swfl  (detail_table home_values_by_zip → home_value_zhvi)
 *   rent  ← rentals-swfl       (detail_table rentals_by_zip     → rent_index_latest)
 *   flood ← env-swfl           (key_metric swfl_zip_{ZIP}_flood_cap_rate_adj_bps, …)
 *
 * Join contract (the #1 risk — kept explicit, never a regex sweep):
 *   - The card universe is the UNION of value+rent ZIPs, each gated through
 *     resolveZip(zip).in_scope so out-of-scope MSA spillover (e.g. Manatee ZIPs
 *     the shared Zillow metro filter pulls in) is dropped at the canonical
 *     6-county authority — NOT trimmed by hand.
 *   - Flood is a LEFT-JOIN overlay: env-swfl only surfaces its top-N highest-AAL
 *     ZIPs (aggregateZipRollupTop6), so for each ZIP we read the flood value by
 *     EXACT constructed key. A miss → flood fields null, the card is still
 *     emitted (anti-silent-drop). The flood-adjusted cap rate — the moat metric —
 *     therefore populates only for the env-surfaced ZIPs; the coverage gap is
 *     surfaced explicitly via investor_zip_cards_with_flood_overlay.
 *
 * STR (short-term-rental revenue) has no free source. The card ships an
 * Operation-Dumbo-Drop placeholder column (str_revenue_est_monthly = null,
 * source_tag "available_on_request") so a later AirDNA manual drop is a
 * zero-code graduation.
 *
 * Pure deterministic — skipSynthesisAgent. Every number is code-computed; the
 * LLM never sees the math.
 */

const BRAIN_ID = "investor-zip-swfl";

const UP_HOME_VALUES = "home-values-swfl";
const UP_RENTALS = "rentals-swfl";
const UP_ENV = "env-swfl";

const TOP_N_PER_ZIP_SLUGS = 6; // emit per-ZIP composite slugs for the flood-overlay cards

// Plausibility band for a ZIP-median gross rent yield. Standard residential
// gross-yield thresholds for SWFL; a value outside this range signals
// high-variance index inputs (ZORI rent basket vs ZHVI value basket diverge —
// the vacation/seasonal-market disparity) rather than a real return.
const GROSS_YIELD_MIN_PCT = 2;
const GROSS_YIELD_MAX_PCT = 12;
const YIELD_BAND_CITATION =
  "Standard residential gross yield thresholds for SWFL (2-12%); values outside indicate high-variance index inputs (ZORI/ZHVI disparity), not a real return.";

// ── Domain types ─────────────────────────────────────────────────────────────

interface InvestorCard {
  zip: string;
  county_names: string[];
  city: string | null;
  // value (home-values-swfl)
  home_value_zhvi: number | null;
  value_yoy_pct: number | null;
  // rent (rentals-swfl)
  rent_index_latest: number | null;
  rent_yoy_pct: number | null;
  // derived
  gross_rent_yield_pct: number | null;
  /** Set when the raw yield fell outside the plausibility band and was suppressed. */
  yield_flag: string | null;
  // flood overlay (env-swfl, exact-key, may be null)
  flood_cap_rate_adj_bps: number | null;
  flood_adj_cap_rate_pct: number | null;
  nfip_pct_rank: number | null;
  barrier_island_score: number | null;
  flood_aal_usd: number | null;
  // STR ODD placeholder
  str_revenue_est_monthly: number | null;
  str_source_tag: string;
}

interface InvestorSnapshot {
  cards: InvestorCard[];
  cards_covered: number;
  cards_with_flood_overlay: number;
  regional_median_gross_yield_pct: number | null;
  regional_median_flood_adj_cap_rate_pct: number | null;
  latest_value_period: string | null;
  latest_rent_period: string | null;
  upstream_available: { value: boolean; rent: boolean; flood: boolean };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Read a cell as a finite number, else null. */
function numCell(row: BrainOutputDetailRow | undefined, col: string): number | null {
  if (!row) return null;
  const v = row.cells[col];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Read a cell as a string, else null. */
function strCell(row: BrainOutputDetailRow | undefined, col: string): string | null {
  if (!row) return null;
  const v = row.cells[col];
  return typeof v === "string" ? v : null;
}

function brainInputFrom(fragments: RawFragment[], upstreamId: string): BrainOutput | null {
  for (const f of fragments) {
    const n = f.normalized as unknown as BrainInputNormalized;
    if (n?.kind === "brain-input" && n.upstream_id === upstreamId) {
      return n.output;
    }
  }
  return null;
}

/** Index a brain's detail_table rows by row.key (ZIP). */
function detailRowsByZip(
  output: BrainOutput | null,
  tableId: string,
): Map<string, BrainOutputDetailRow> {
  const out = new Map<string, BrainOutputDetailRow>();
  const table = output?.detail_tables?.find((t) => t.id === tableId);
  if (!table) return out;
  for (const row of table.rows) out.set(row.key, row);
  return out;
}

/** Index a brain's key_metrics by exact slug for O(1) constructed-key lookup. */
function metricsBySlug(output: BrainOutput | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!output) return out;
  for (const m of output.key_metrics) {
    if (typeof m.value === "number" && Number.isFinite(m.value)) {
      out.set(m.metric, m.value);
    }
  }
  return out;
}

/**
 * Build the composite snapshot. Pure — takes the three upstream outputs and
 * joins them deterministically. Exported for unit testing.
 */
export function buildSnapshot(
  valueOut: BrainOutput | null,
  rentOut: BrainOutput | null,
  envOut: BrainOutput | null,
): InvestorSnapshot {
  const valueByZip = detailRowsByZip(valueOut, "home_values_by_zip");
  const rentByZip = detailRowsByZip(rentOut, "rentals_by_zip");
  const floodMetrics = metricsBySlug(envOut);

  // Universe = union of value + rent ZIPs, gated to the canonical 6-county scope.
  const universe = new Set<string>();
  for (const zip of valueByZip.keys()) universe.add(zip);
  for (const zip of rentByZip.keys()) universe.add(zip);

  const cards: InvestorCard[] = [];
  for (const zip of universe) {
    if (!resolveZip(zip).in_scope) continue; // drop MSA spillover (e.g. Manatee)

    const vRow = valueByZip.get(zip);
    const rRow = rentByZip.get(zip);

    const home_value_zhvi = numCell(vRow, "home_value_zhvi");
    const value_yoy_pct = numCell(vRow, "value_yoy_pct");
    const rent_index_latest = numCell(rRow, "rent_index_latest");
    const rent_yoy_pct = numCell(rRow, "rent_yoy_pct");

    // Raw gross rent yield — null-guarded: never divide by zero / null.
    const raw_yield =
      home_value_zhvi !== null && home_value_zhvi > 0 && rent_index_latest !== null
        ? ((rent_index_latest * 12) / home_value_zhvi) * 100
        : null;

    // Plausibility band. A ZIP-median gross yield is only meaningful when the
    // ZORI rent basket and the ZHVI value basket describe comparable property —
    // which fails on barrier-island / vacation ZIPs (scarce luxury rentals vs
    // condo/land-depressed values), producing absurd yields (FMB ~36%). Outside
    // the band we suppress BOTH the yield and the flood-adjusted cap rate and
    // flag the card; the raw value/rent/flood facts stay (they are honest).
    const yield_assessable =
      raw_yield !== null && raw_yield >= GROSS_YIELD_MIN_PCT && raw_yield <= GROSS_YIELD_MAX_PCT;
    const gross_rent_yield_pct = yield_assessable ? raw_yield : null;
    const yield_flag =
      raw_yield !== null && !yield_assessable
        ? "Index disparity in vacation/seasonal markets; yield unassessable."
        : null;

    // Flood overlay — EXACT constructed keys, miss → null. The raw flood facts
    // are kept regardless of yield assessability.
    const flood_cap_rate_adj_bps =
      floodMetrics.get(`swfl_zip_${zip}_flood_cap_rate_adj_bps`) ?? null;
    const nfip_pct_rank = floodMetrics.get(`swfl_zip_${zip}_flood_aal_pct_swfl_rank`) ?? null;
    const barrier_island_score = floodMetrics.get(`swfl_zip_${zip}_barrier_island_score`) ?? null;
    const flood_aal_usd =
      floodMetrics.get(`swfl_zip_${zip}_flood_aal_usd_per_insured_property`) ?? null;

    // Flood-adjusted cap rate rides on the ASSESSABLE yield only — suppressed
    // alongside the yield when the inputs are incoherent.
    const flood_adj_cap_rate_pct =
      gross_rent_yield_pct !== null && flood_cap_rate_adj_bps !== null
        ? gross_rent_yield_pct - flood_cap_rate_adj_bps / 100
        : null;

    const resolved = resolveZip(zip);
    cards.push({
      zip,
      county_names: resolved.county_names,
      city: strCell(vRow, "city") ?? strCell(rRow, "city"),
      home_value_zhvi,
      value_yoy_pct,
      rent_index_latest,
      rent_yoy_pct,
      gross_rent_yield_pct,
      yield_flag,
      flood_cap_rate_adj_bps,
      flood_adj_cap_rate_pct,
      nfip_pct_rank,
      barrier_island_score,
      flood_aal_usd,
      str_revenue_est_monthly: null,
      str_source_tag: "available_on_request",
    });
  }

  cards.sort((a, b) => (a.zip < b.zip ? -1 : a.zip > b.zip ? 1 : 0));

  const yields = cards.map((c) => c.gross_rent_yield_pct).filter((y): y is number => y !== null);
  const floodAdj = cards
    .map((c) => c.flood_adj_cap_rate_pct)
    .filter((y): y is number => y !== null);

  const valueTable = valueOut?.detail_tables?.find((t) => t.id === "home_values_by_zip");
  const rentTable = rentOut?.detail_tables?.find((t) => t.id === "rentals_by_zip");
  const latest_value_period =
    (valueTable?.rows[0]?.cells.latest_period as string | undefined) ?? null;
  const latest_rent_period =
    (rentTable?.rows[0]?.cells.latest_period as string | undefined) ?? null;

  return {
    cards,
    cards_covered: cards.length,
    cards_with_flood_overlay: cards.filter((c) => c.flood_adj_cap_rate_pct !== null).length,
    regional_median_gross_yield_pct: median(yields),
    regional_median_flood_adj_cap_rate_pct: median(floodAdj),
    latest_value_period,
    latest_rent_period,
    upstream_available: {
      value: valueByZip.size > 0,
      rent: rentByZip.size > 0,
      flood: floodMetrics.size > 0,
    },
  };
}

// ── Module-level state for corpusSummary -> outputProducer handoff ──────────

let lastSnapshot: InvestorSnapshot | null = null;
let lastFetchedAt: string | null = null;

function investorCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  lastSnapshot = null;
  lastFetchedAt = null;

  const valueOut = brainInputFrom(allFragments, UP_HOME_VALUES);
  const rentOut = brainInputFrom(allFragments, UP_RENTALS);
  const envOut = brainInputFrom(allFragments, UP_ENV);

  const snap = buildSnapshot(valueOut, rentOut, envOut);
  if (snap.cards_covered === 0) return [];

  lastSnapshot = snap;
  lastFetchedAt = allFragments[0]?.fetched_at ?? new Date().toISOString();

  const yieldStr =
    snap.regional_median_gross_yield_pct === null
      ? "n/a"
      : `${snap.regional_median_gross_yield_pct.toFixed(2)}%`;

  return [
    {
      topic: "corpus_overview",
      fact: "SWFL per-ZIP investor composite (value + rent + flood-adjusted yield)",
      value: `${snap.cards_covered} ZIP cards (${snap.cards_with_flood_overlay} with flood overlay). Regional median gross rent yield = ${yieldStr}.`,
      source_fragment_ids: [],
    },
  ];
}

// ── outputProducer ──────────────────────────────────────────────────────────

function buildSourceMeta(fetched_at: string): BrainOutputMetricSource {
  return {
    url: "https://www.swfldatagulf.com/api/b/investor-zip-swfl",
    fetched_at,
    tier: 2,
    citation:
      "Deterministic per-ZIP composite computed by investor-zip-swfl from three upstream brains: " +
      "home value (home-values-swfl, Zillow ZHVI), long-term rent (rentals-swfl, Zillow ZORI), and " +
      "flood cap-rate adjustment (env-swfl, FEMA/NFIP). Gross rent yield = rent x 12 / home value x 100; " +
      "flood-adjusted cap rate = gross yield - flood_cap_rate_adj_bps / 100. ZIP scope: 6-county SWFL " +
      "authority (fixtures/swfl-zip-county.json).",
  };
}

function investorOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snap = lastSnapshot;
  const fetched_at = lastFetchedAt ?? new Date().toISOString();

  if (!snap || snap.cards_covered === 0) {
    const missing: string[] = [];
    if (!snap?.upstream_available.value) missing.push("home-values-swfl (value)");
    if (!snap?.upstream_available.rent) missing.push("rentals-swfl (rent)");
    return {
      conclusion:
        "investor-zip-swfl produced no ZIP cards this build — no in-scope ZIP carried both a value and a rent observation.",
      key_metrics: [],
      caveats: [
        `Upstream coverage was insufficient${missing.length ? ` (missing: ${missing.join(", ")})` : ""}. ` +
          "Verify home-values-swfl and rentals-swfl rebuilt with non-empty detail_tables.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const source = buildSourceMeta(fetched_at);
  const key_metrics: BrainOutputMetric[] = [];

  // 1. Coverage count.
  key_metrics.push({
    metric: "investor_zip_cards_covered",
    value: snap.cards_covered,
    direction: "stable",
    label: "Count of SWFL ZIP investor cards (value + rent present, in-scope)",
    variable_type: "extensive",
    units: "count",
    display_format: "count",
    source,
  });

  // 2. Flood-overlay coverage — surfaces the moat-metric gap explicitly.
  key_metrics.push({
    metric: "investor_zip_cards_with_flood_overlay",
    value: snap.cards_with_flood_overlay,
    direction: "stable",
    label:
      "Count of investor cards that also carry the flood-adjusted cap rate (env-surfaced ZIPs)",
    variable_type: "extensive",
    units: "count",
    display_format: "count",
    source,
  });

  // 3. Regional median gross rent yield.
  if (snap.regional_median_gross_yield_pct !== null) {
    key_metrics.push({
      metric: "investor_gross_rent_yield_pct_regional_median",
      value: Number(snap.regional_median_gross_yield_pct.toFixed(2)),
      direction: "stable",
      label: "SWFL regional median gross rent yield % (ZORI rent x 12 / ZHVI value)",
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source,
    });
  }

  // 4. Regional median flood-adjusted cap rate (over flood-overlay cards).
  if (snap.regional_median_flood_adj_cap_rate_pct !== null) {
    key_metrics.push({
      metric: "investor_flood_adj_cap_rate_pct_regional_median",
      value: Number(snap.regional_median_flood_adj_cap_rate_pct.toFixed(2)),
      direction: "stable",
      label:
        "SWFL regional median flood-adjusted cap rate % (gross yield minus flood bps), env-surfaced ZIPs",
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source,
    });
  }

  // 5. Per-ZIP composite slugs — for the flood-overlay cards (the leapfrog cards).
  const floodCards = snap.cards
    .filter((c) => c.flood_adj_cap_rate_pct !== null)
    .slice(0, TOP_N_PER_ZIP_SLUGS);
  for (const c of floodCards) {
    if (c.gross_rent_yield_pct !== null) {
      key_metrics.push({
        metric: `investor_gross_rent_yield_pct_zip_${c.zip}`,
        value: Number(c.gross_rent_yield_pct.toFixed(2)),
        direction: "stable",
        label: `Gross rent yield % - ZIP ${c.zip}${c.city ? " (" + c.city + ")" : ""}`,
        variable_type: "intensive",
        units: "percent",
        display_format: "percent",
        source,
      });
    }
    if (c.flood_adj_cap_rate_pct !== null) {
      key_metrics.push({
        metric: `investor_flood_adj_cap_rate_pct_zip_${c.zip}`,
        value: Number(c.flood_adj_cap_rate_pct.toFixed(2)),
        direction: "stable",
        label: `Flood-adjusted cap rate % - ZIP ${c.zip}${c.city ? " (" + c.city + ")" : ""}`,
        variable_type: "intensive",
        units: "percent",
        display_format: "percent",
        source,
      });
    }
  }

  // ── Caveats ──
  const caveats: string[] = [];
  const suppressed = snap.cards.filter((c) => c.yield_flag !== null).length;
  if (suppressed > 0) {
    caveats.push(
      `${suppressed} ZIP card(s) had a gross yield outside the ${GROSS_YIELD_MIN_PCT}-${GROSS_YIELD_MAX_PCT}% plausibility band — ` +
        `yield and flood-adjusted cap rate suppressed (value/rent indices not comparable in vacation/seasonal markets); ` +
        `raw value, rent, and flood facts retained. ${YIELD_BAND_CITATION}`,
    );
  }
  const noFlood = snap.cards_covered - snap.cards_with_flood_overlay;
  if (noFlood > 0) {
    caveats.push(
      `${noFlood} of ${snap.cards_covered} ZIP cards carry value + rent but no flood overlay — ` +
        "env-swfl surfaces the flood cap-rate adjustment only for its top-AAL ZIPs, so the flood-adjusted cap rate is null for the rest.",
    );
  }
  if (!snap.upstream_available.flood) {
    caveats.push(
      "env-swfl carried no per-ZIP flood metrics this build — every card's flood-adjusted cap rate is null.",
    );
  }
  caveats.push(
    "Short-term-rental revenue (str_revenue_est_monthly) is null pending an AirDNA feed — available on request.",
  );

  // ── Conclusion ──
  const yieldDisplay =
    snap.regional_median_gross_yield_pct === null
      ? "n/a"
      : `${snap.regional_median_gross_yield_pct.toFixed(2)}%`;
  const conclusion = [
    `SWFL investor composite: ${snap.cards_covered} ZIP cards pairing home value (ZHVI) with long-term rent (ZORI) at a regional median gross rent yield of ${yieldDisplay}.`,
    `${snap.cards_with_flood_overlay} carry the flood-adjusted cap rate — the value + rent + flood-and-NFIP-percentile read no other source pairs at ZIP grain.`,
  ].join(" ");

  // ── Detail table: one investor card per ZIP ──
  const rows: BrainOutputDetailRow[] = snap.cards.map((c) => ({
    key: c.zip,
    label: c.zip,
    cells: {
      county: c.county_names.join(", ") || null,
      city: c.city,
      home_value_zhvi: c.home_value_zhvi,
      value_yoy_pct: c.value_yoy_pct === null ? null : Number(c.value_yoy_pct.toFixed(2)),
      rent_index_latest: c.rent_index_latest,
      rent_yoy_pct: c.rent_yoy_pct === null ? null : Number(c.rent_yoy_pct.toFixed(2)),
      gross_rent_yield_pct:
        c.gross_rent_yield_pct === null ? null : Number(c.gross_rent_yield_pct.toFixed(2)),
      yield_flag: c.yield_flag,
      flood_cap_rate_adj_bps: c.flood_cap_rate_adj_bps,
      flood_adj_cap_rate_pct:
        c.flood_adj_cap_rate_pct === null ? null : Number(c.flood_adj_cap_rate_pct.toFixed(2)),
      nfip_pct_rank: c.nfip_pct_rank === null ? null : Number(c.nfip_pct_rank.toFixed(2)),
      barrier_island_score: c.barrier_island_score,
      flood_aal_usd: c.flood_aal_usd,
      str_revenue_est_monthly: c.str_revenue_est_monthly,
      str_source_tag: c.str_source_tag,
    },
  }));

  return {
    conclusion,
    key_metrics,
    caveats,
    direction: "neutral",
    magnitude: 0,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    detail_tables: [
      {
        id: "investor_zip_card",
        title: `SWFL per-ZIP investor composite — value/rent ${snap.latest_value_period ?? snap.latest_rent_period ?? "latest"}`,
        grain: "zip",
        columns: [
          { id: "county", label: "County" },
          { id: "city", label: "City" },
          {
            id: "home_value_zhvi",
            label: "Home value (ZHVI, USD)",
            display_format: "currency",
            units: "USD",
          },
          {
            id: "value_yoy_pct",
            label: "Value YoY %",
            display_format: "percent",
            units: "percent",
          },
          {
            id: "rent_index_latest",
            label: "Rent (ZORI, USD/mo)",
            display_format: "currency",
            units: "USD/month",
          },
          { id: "rent_yoy_pct", label: "Rent YoY %", display_format: "percent", units: "percent" },
          {
            id: "gross_rent_yield_pct",
            label: "Gross rent yield %",
            display_format: "percent",
            units: "percent",
          },
          { id: "yield_flag", label: "Yield note" },
          {
            id: "flood_cap_rate_adj_bps",
            label: "Flood cap-rate adj (bps)",
            display_format: "raw",
            units: "basis points",
          },
          {
            id: "flood_adj_cap_rate_pct",
            label: "Flood-adjusted cap rate %",
            display_format: "percent",
            units: "percent",
          },
          {
            id: "nfip_pct_rank",
            label: "NFIP AAL percentile (SWFL)",
            display_format: "raw",
            units: "percentile",
          },
          {
            id: "barrier_island_score",
            label: "Barrier-island score",
            display_format: "raw",
            units: "score",
          },
          {
            id: "flood_aal_usd",
            label: "Flood AAL (USD/yr/insured)",
            display_format: "currency",
            units: "USD",
          },
          {
            id: "str_revenue_est_monthly",
            label: "STR revenue (USD/mo)",
            display_format: "currency",
            units: "USD/month",
          },
          { id: "str_source_tag", label: "STR source" },
        ],
        rows,
        source,
        note: "One investor card per in-scope SWFL ZIP carrying a value or rent observation. Gross rent yield = ZORI rent x 12 / ZHVI value x 100; null when value or rent is absent (never a divide-by-zero), AND suppressed (with yield_flag set) when outside the 2-12% plausibility band — value and rent indices are not comparable in vacation/seasonal markets (e.g. barrier islands), where ZORI's luxury-rental basket and ZHVI's condo/land-depressed value produce an implausible ratio. Flood-adjusted cap rate = gross yield - flood_cap_rate_adj_bps / 100; null where the yield is unassessable or env-swfl does not surface that ZIP (its top-AAL ZIPs only). Raw value, rent, and flood facts are retained on suppressed cards. STR revenue is null pending an AirDNA feed (source_tag available_on_request).",
      },
    ],
  };
}

// ── Pack definition ─────────────────────────────────────────────────────────

export const investorZipSwfl: PackDefinition = {
  id: BRAIN_ID,
  brain_id: BRAIN_ID,
  public_label: "Investor ZIP Composite",
  domain: "real-estate",
  scope:
    "SWFL ZIP-level investor composite — home value (ZHVI) + long-term rent (ZORI) + gross rent yield, with a flood-adjusted cap rate and NFIP percentile on env-surfaced ZIPs.",
  ttl_seconds: 86400 * 35, // monthly cadence (gated by the slowest upstream, value/rent)
  sources: [
    makeBrainInputSource(UP_HOME_VALUES),
    makeBrainInputSource(UP_RENTALS),
    makeBrainInputSource(UP_ENV),
  ],
  input_brains: [
    { id: UP_HOME_VALUES, edge_type: "input" },
    { id: UP_RENTALS, edge_type: "input" },
    { id: UP_ENV, edge_type: "input" },
  ],
  fitScore: () => 8,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: investorCorpusSummary,
  outputProducer: investorOutputProducer,
  preferences: [
    "The user wants the per-ZIP card: home value, long-term rent, gross rent yield, and — where available — the flood-adjusted cap rate plus NFIP percentile.",
    "The flood-adjusted cap rate is the differentiator; lead with it on the ZIPs that have it and say plainly when a ZIP doesn't.",
    "Short-term-rental revenue is a known gap (no free source) — present it as available-on-request, never invent it.",
  ],
  activeProject:
    "investor-zip-swfl: pair home value + rent + flood economics at ZIP grain so a SWFL investor can read a property's full yield picture no single competitor offers.",
  prompts: {
    triageContext:
      "Fragments are the OUTPUT blocks of home-values-swfl, rentals-swfl, and env-swfl. The pack joins them deterministically by ZIP — no LLM triage.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). The BrainOutput is built by investorOutputProducer from the three upstream OUTPUT blocks via exact-key ZIP joins.",
  },
};
