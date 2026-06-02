import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import {
  leepaValueSource,
  type LeepaSummaryNormalized,
  type SalesVelocityYearNormalized,
} from "../sources/leepa-value-source.mts";
import {
  fhfaHpiSource,
  type HpiSwflSummary,
} from "../sources/fhfa-hpi-source.mts";
import { env } from "../config/env.mts";

/**
 * properties-lee-value — Lee County Property Appraiser parcel-value direction read.
 *
 * Single source: data_lake.leepa_parcels (Tier 2, populated by the LeePA dlt
 * pipeline; layers 9+10+12 joined on FOLIOID). The source connector pre-aggregates
 * everything in Postgres views — this pack is a pure reader.
 *
 * Direction signal: sales-velocity z-score for the most recent COMPLETE
 * calendar year (year-1 relative to today) versus the trailing 3-year mean.
 *   bullish if z ≥ +1.0, bearish if z ≤ −1.0, neutral otherwise.
 *
 * Level metrics (no direction contribution):
 *   - value_sales_velocity_per_1k  : current year sales / total_parcels × 1000
 *   - value_sales_velocity_zscore  : current-year z vs trailing 3yr
 *   - value_soh_gap_median_pct     : median (just−taxable)/just × 100 across homesteaded parcels
 *   - value_total_parcels          : snapshot row count
 *
 * Dropped from v1: implied-appreciation (structurally weak from a single
 * snapshot — re-runs once a 2nd snapshot exists for true YoY). True YoY waits.
 *
 * Leaf brain (input_brains: []). Pure deterministic — no synthesis agent.
 *
 * Survival-bias caveat: the per-year sales counts come from each parcel's
 * LATEST qualified sale. Re-sales attributed to recent years are subtracted
 * from earlier-year buckets, so the current-year z-score is biased UPWARD —
 * treat marginal bullish reads as suggestive, not confirmatory.
 */

const Z_BULL_THRESHOLD = 1.0;
const Z_BEAR_THRESHOLD = -1.0;
const BASELINE_YEAR_COUNT = 3;

interface PropertyValueAggregates {
  currentYear: number;
  baselineYears: number[];
  currentSalesCount: number | null;
  baselineSalesCounts: number[];
  baselineMean: number | null;
  baselineStd: number | null;
  zScore: number | null;
  totalParcels: number;
  homesteadedParcels: number;
  velocityCurrentPer1k: number | null;
  velocityBaselineMeanPer1k: number | null;
  sohGapMedianPct: number | null;
}

let lastAggregate: PropertyValueAggregates | null = null;
let lastFetchedAt: string | null = null;

let lastFhfaSummary: HpiSwflSummary | null = null;

function salesByYearFrom(fragments: RawFragment[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of fragments) {
    const n = f.normalized as unknown as SalesVelocityYearNormalized;
    if (n?.kind !== "leepa-sales-year") continue;
    out.set(n.year, n.sales_count);
  }
  return out;
}

function summaryFrom(fragments: RawFragment[]): LeepaSummaryNormalized | null {
  for (const f of fragments) {
    const n = f.normalized as unknown as LeepaSummaryNormalized;
    if (n?.kind === "leepa-summary") return n;
  }
  return null;
}

function fhfaSummaryFrom(fragments: RawFragment[]): HpiSwflSummary | null {
  for (const f of fragments) {
    const n = f.normalized as unknown as HpiSwflSummary;
    if (n?.kind === "hpi-swfl-summary") return n;
  }
  return null;
}

function populationStd(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sq =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(sq);
}

function aggregate(
  salesByYear: Map<number, number>,
  summary: LeepaSummaryNormalized | null,
): PropertyValueAggregates {
  // Current year = most recent COMPLETE calendar year. Today is the only
  // run-date dependency in this pack; the source-side window already covers
  // the right span.
  const currentYear = new Date().getUTCFullYear() - 1;
  const baselineYears = Array.from(
    { length: BASELINE_YEAR_COUNT },
    (_, i) => currentYear - BASELINE_YEAR_COUNT + i,
  );

  // Missing year = 0 sales (deliberate — silence in a baseline year is low velocity,
  // not "skip"). Missing CURRENT year = null (no signal at all → neutral direction).
  const currentSalesCount = salesByYear.has(currentYear)
    ? (salesByYear.get(currentYear) ?? 0)
    : null;
  const baselineSalesCounts = baselineYears.map((y) => salesByYear.get(y) ?? 0);

  const baselineMean =
    baselineSalesCounts.length === 0
      ? null
      : baselineSalesCounts.reduce((a, b) => a + b, 0) /
        baselineSalesCounts.length;
  const baselineStd = populationStd(baselineSalesCounts);
  const zScore =
    currentSalesCount != null && baselineMean != null && baselineStd > 0
      ? (currentSalesCount - baselineMean) / baselineStd
      : null;

  const totalParcels = summary?.total_parcels ?? 0;
  const homesteadedParcels = summary?.soh_homesteaded_parcels ?? 0;
  const velocityCurrentPer1k =
    currentSalesCount != null && totalParcels > 0
      ? (currentSalesCount / totalParcels) * 1000
      : null;
  const velocityBaselineMeanPer1k =
    baselineMean != null && totalParcels > 0
      ? (baselineMean / totalParcels) * 1000
      : null;

  return {
    currentYear,
    baselineYears,
    currentSalesCount,
    baselineSalesCounts,
    baselineMean,
    baselineStd: baselineStd > 0 ? baselineStd : null,
    zScore,
    totalParcels,
    homesteadedParcels,
    velocityCurrentPer1k,
    velocityBaselineMeanPer1k,
    sohGapMedianPct: summary?.soh_gap_median_pct ?? null,
  };
}

const fmt1 = (n: number): string =>
  Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();

export function directionFromZScore(
  z: number | null,
): "bullish" | "bearish" | "neutral" {
  if (z == null) return "neutral";
  if (z >= Z_BULL_THRESHOLD) return "bullish";
  if (z <= Z_BEAR_THRESHOLD) return "bearish";
  return "neutral";
}

function buildLeepaSource(
  fetched_at: string,
  totalParcels: number,
): BrainOutputMetricSource {
  const url =
    env.source === "live" && env.supabaseUrl
      ? `${env.supabaseUrl}/rest/v1/leepa_parcels?select=folioid,just_value,taxable_value,cap_difference,last_sale_date,use_code`
      : "fixture://refinery/__fixtures__/properties-lee-value.sample.json";
  const provenance =
    env.source === "live"
      ? `LeePA parcel snapshot via data_lake.leepa_parcels (dlt-ingested from ` +
        `gissvr.leepa.org ParcelInfo/MapServer layers 9+10+12, joined on FOLIOID; Lee County). ` +
        `Snapshot row count: ${totalParcels} parcels. Pre-aggregated through ` +
        `data_lake.leepa_parcels_sales_yearly + data_lake.leepa_parcels_summary.`
      : `LeePA parcel snapshot (fixture; refinery/__fixtures__/properties-lee-value.sample.json), ` +
        `layers 9+10+12 joined on FOLIOID; Lee County. ` +
        `Snapshot row count: ${totalParcels} parcels (fixture).`;
  return {
    url,
    fetched_at,
    tier: 2,
    citation: provenance,
  };
}

function propertyValueCorpusSummary(
  allFragments: RawFragment[],
): SynthesisFact[] {
  const salesByYear = salesByYearFrom(allFragments);
  const summary = summaryFrom(allFragments);
  lastAggregate = aggregate(salesByYear, summary);
  lastFetchedAt = allFragments[0]?.fetched_at ?? null;
  lastFhfaSummary = fhfaSummaryFrom(allFragments);

  const agg = lastAggregate;
  if (agg.totalParcels === 0) return [];

  const facts: SynthesisFact[] = [];

  facts.push({
    topic: "corpus_overview",
    fact: "Lee County parcel snapshot — value/use/sale fields joined on FOLIOID",
    value:
      `${agg.totalParcels} Lee County parcels in snapshot. ` +
      `${agg.homesteadedParcels} actively homesteaded (cap_difference > 0). ` +
      `Sales-velocity baseline derived from each parcel's LATEST qualified sale across the ` +
      `${BASELINE_YEAR_COUNT}-year window ${agg.baselineYears[0]}-${agg.baselineYears[agg.baselineYears.length - 1]}, ` +
      `current year ${agg.currentYear}.`,
    source_fragment_ids: [],
  });

  if (agg.velocityCurrentPer1k != null) {
    facts.push({
      topic: "metric:sales_velocity_per_1k",
      fact: `Lee sales velocity (year ${agg.currentYear})`,
      value: `${agg.currentSalesCount} qualified sales in ${agg.currentYear} across ${agg.totalParcels} parcels → ${fmt1(agg.velocityCurrentPer1k)} sales per 1,000 parcels.`,
      source_fragment_ids: [],
    });
  }

  if (agg.zScore != null) {
    facts.push({
      topic: "metric:sales_velocity_zscore",
      fact: "Lee sales-velocity z-score (current year vs trailing 3yr)",
      value:
        `Baseline counts ${agg.baselineYears.map((y, i) => `${y}=${agg.baselineSalesCounts[i]}`).join(", ")}; ` +
        `mean ${agg.baselineMean != null ? fmt1(agg.baselineMean) : "n/a"}, ` +
        `population std ${agg.baselineStd != null ? fmt1(agg.baselineStd) : "n/a"}. ` +
        `Current ${agg.currentSalesCount}. z = ${fmt1(agg.zScore)}.`,
      source_fragment_ids: [],
    });
  }

  if (agg.sohGapMedianPct != null) {
    facts.push({
      topic: "metric:soh_gap_median",
      fact: "Lee Save-Our-Homes gap median across homesteaded parcels",
      value: `Median (just−taxable)/just across ${agg.homesteadedParcels} homesteaded parcels: ${fmt1(agg.sohGapMedianPct)}%.`,
      source_fragment_ids: [],
    });
  }

  facts.push({
    topic: "metric:total_parcels",
    fact: "Lee total parcel count in snapshot",
    value:
      env.source === "live"
        ? `${agg.totalParcels} parcels in data_lake.leepa_parcels.`
        : `${agg.totalParcels} parcels in fixture refinery/__fixtures__/properties-lee-value.sample.json.`,
    source_fragment_ids: [],
  });

  const fhfa = lastFhfaSummary;
  if (fhfa?.cape_coral_msa) {
    const msa = fhfa.cape_coral_msa;
    facts.push({
      topic: "metric:fhfa_cape_coral_msa_yoy",
      fact: `FHFA Cape Coral-Fort Myers MSA HPI YoY (${msa.latest_period})`,
      value:
        `Index (NSA): ${msa.index_nsa ?? "n/a"}. ` +
        `YoY: ${msa.yoy_change_pct != null ? `${msa.yoy_change_pct > 0 ? "+" : ""}${msa.yoy_change_pct}%` : "n/a"}. ` +
        `QoQ: ${msa.qoq_change_pct != null ? `${msa.qoq_change_pct > 0 ? "+" : ""}${msa.qoq_change_pct}%` : "n/a"}. ` +
        `Federal HPI benchmark for Lee County market price direction (purchase-only, traditional, quarterly).`,
      source_fragment_ids: [],
    });
  }
  if (fhfa?.fl_state) {
    const st = fhfa.fl_state;
    facts.push({
      topic: "metric:fhfa_fl_state_yoy",
      fact: `FHFA Florida state HPI YoY (${st.latest_period})`,
      value:
        `Index (NSA): ${st.index_nsa ?? "n/a"}. ` +
        `YoY: ${st.yoy_change_pct != null ? `${st.yoy_change_pct > 0 ? "+" : ""}${st.yoy_change_pct}%` : "n/a"}. ` +
        `Statewide baseline — Lee MSA delta vs state signals local over/underperformance.`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

function propertyValueOutputProducer(
  _out: PackOutput,
): BrainOutputProducerResult {
  const agg = lastAggregate;
  const fetched_at =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!agg || agg.totalParcels === 0) {
    return {
      conclusion:
        "properties-lee-value could not resolve any Lee County parcels — no value/velocity context available this build.",
      key_metrics: [],
      caveats: [
        `No rows returned by ${env.source === "fixture" ? "fixture" : "live data_lake.leepa_parcels query"}. ` +
          "If live, confirm the dlt pipeline ran (python -m ingest.pipelines.leepa.pipeline) and that " +
          "docs/sql/leepa_parcels_grant.sql was applied.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const sourceMeta = buildLeepaSource(fetched_at, agg.totalParcels);
  const key_metrics: BrainOutputMetric[] = [];

  if (agg.velocityCurrentPer1k != null) {
    key_metrics.push({
      metric: "sales_velocity_per_1k",
      value: Math.round(agg.velocityCurrentPer1k * 10) / 10,
      direction: "stable",
      label: `Lee sales velocity, year ${agg.currentYear} (qualified sales per 1,000 parcels)`,
      // Velocity is a normalized per-1,000-parcels rate — intensive.
      variable_type: "intensive",
      units: "sales per 1,000 parcels",
      display_format: "ratio",
      source: sourceMeta,
    });
  }
  if (agg.zScore != null) {
    key_metrics.push({
      metric: "sales_velocity_zscore",
      value: Math.round(agg.zScore * 100) / 100,
      direction:
        agg.zScore >= Z_BULL_THRESHOLD
          ? "rising"
          : agg.zScore <= Z_BEAR_THRESHOLD
            ? "falling"
            : "stable",
      label: `Lee sales-velocity z-score, year ${agg.currentYear} vs trailing ${BASELINE_YEAR_COUNT}yr (${agg.baselineYears[0]}-${agg.baselineYears[agg.baselineYears.length - 1]})`,
      variable_type: "intensive",
      units: "z-score",
      display_format: "ratio",
      source: sourceMeta,
    });
  }
  if (agg.sohGapMedianPct != null) {
    key_metrics.push({
      metric: "soh_gap_median_pct",
      value: Math.round(agg.sohGapMedianPct * 10) / 10,
      direction: "stable",
      label: `Lee Save-Our-Homes gap median (% of just value suppressed for taxation) across ${agg.homesteadedParcels} homesteaded parcels`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: sourceMeta,
    });
  }
  key_metrics.push({
    metric: "total_parcels",
    value: agg.totalParcels,
    direction: "stable",
    label:
      env.source === "live"
        ? "Lee County parcels in snapshot (data_lake.leepa_parcels)"
        : "Lee County parcels in snapshot (fixture; refinery/__fixtures__/properties-lee-value.sample.json)",
    variable_type: "extensive",
    units: "parcels",
    display_format: "count",
    source: sourceMeta,
  });

  const fhfa = lastFhfaSummary;
  const fhfaCitationBase =
    env.source === "live"
      ? "FHFA House Price Index via data_lake.fhfa_hpi (purchase-only, traditional, quarterly)"
      : "FHFA House Price Index (fixture)";

  if (fhfa?.cape_coral_msa) {
    const msa = fhfa.cape_coral_msa;
    key_metrics.push({
      metric: "fhfa_cape_coral_msa_yoy_pct",
      value: msa.yoy_change_pct ?? 0,
      direction:
        msa.yoy_change_pct == null
          ? "stable"
          : msa.yoy_change_pct > 0
            ? "rising"
            : "falling",
      label: `FHFA Cape Coral-Fort Myers MSA HPI YoY (${msa.latest_period}) — Lee County price-level proxy`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: {
        url: "https://www.fhfa.gov/hpi/download/monthly/hpi_master.json",
        fetched_at,
        tier: 1,
        citation: fhfaCitationBase,
      },
    });
  }
  if (fhfa?.fl_state) {
    const st = fhfa.fl_state;
    key_metrics.push({
      metric: "fhfa_fl_state_yoy_pct",
      value: st.yoy_change_pct ?? 0,
      direction:
        st.yoy_change_pct == null
          ? "stable"
          : st.yoy_change_pct > 0
            ? "rising"
            : "falling",
      label: `FHFA Florida state HPI YoY (${st.latest_period}) — statewide baseline`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: {
        url: "https://www.fhfa.gov/hpi/download/monthly/hpi_master.json",
        fetched_at,
        tier: 1,
        citation: fhfaCitationBase,
      },
    });
  }

  const direction = directionFromZScore(agg.zScore);
  // Magnitude: |z| / 3, clamped to [0,1]. z=+3 ⇒ full magnitude.
  //   - When z is null (no current-year data), default to 0.3 so master still
  //     sees us as a low-weight contributor in voteDirection without a directional vote.
  const magnitude =
    agg.zScore == null ? 0.3 : Math.min(1, Math.abs(agg.zScore) / 3);

  const conclusionParts: string[] = [];
  conclusionParts.push(
    `Lee County had ${agg.currentSalesCount ?? 0} qualified parcel sales recorded for ${agg.currentYear} across ${agg.totalParcels} parcels (${agg.velocityCurrentPer1k != null ? fmt1(agg.velocityCurrentPer1k) : "n/a"} per 1,000).`,
  );
  if (agg.zScore != null && agg.baselineMean != null) {
    conclusionParts.push(
      `Trailing ${BASELINE_YEAR_COUNT}yr baseline (${agg.baselineYears[0]}-${agg.baselineYears[agg.baselineYears.length - 1]}) averaged ${fmt1(agg.baselineMean)} sales/yr; current year sits at z = ${fmt1(agg.zScore)} — ${direction} read on Lee parcel transaction velocity.`,
    );
  } else if (agg.currentSalesCount == null) {
    conclusionParts.push(
      `No qualified sales recorded for ${agg.currentYear} yet — direction is neutral until next snapshot lands.`,
    );
  } else {
    conclusionParts.push(
      `Trailing baseline has zero variance (all ${BASELINE_YEAR_COUNT} years identical), so z-score is undefined; direction is neutral.`,
    );
  }
  if (fhfa?.cape_coral_msa?.yoy_change_pct != null) {
    const msa = fhfa.cape_coral_msa;
    const sign = msa.yoy_change_pct > 0 ? "+" : "";
    conclusionParts.push(
      `FHFA Cape Coral-Fort Myers MSA HPI: ${sign}${msa.yoy_change_pct}% YoY (${msa.latest_period}), FL state ${fhfa.fl_state?.yoy_change_pct != null ? `${fhfa.fl_state.yoy_change_pct > 0 ? "+" : ""}${fhfa.fl_state.yoy_change_pct}%` : "n/a"} — federal price-index benchmark for the Lee market.`,
    );
  }
  if (agg.sohGapMedianPct != null) {
    conclusionParts.push(
      `Median Save-Our-Homes gap across ${agg.homesteadedParcels} homesteaded parcels: ${fmt1(agg.sohGapMedianPct)}% of just value suppressed for taxation.`,
    );
  }

  const exogenous_signals: string[] = [];
  if (fhfa?.cape_coral_msa?.yoy_change_pct != null) {
    const msa = fhfa.cape_coral_msa;
    exogenous_signals.push(
      `FHFA Cape Coral-Fort Myers MSA HPI YoY: ${msa.yoy_change_pct > 0 ? "+" : ""}${msa.yoy_change_pct}% (${msa.latest_period}). Federal benchmark for Lee County repeat-sale price direction — purchase-only, traditional, quarterly.`,
    );
  }
  if (fhfa?.fl_state?.yoy_change_pct != null) {
    const st = fhfa.fl_state;
    exogenous_signals.push(
      `FHFA Florida state HPI YoY: ${st.yoy_change_pct > 0 ? "+" : ""}${st.yoy_change_pct}% (${st.latest_period}). Statewide baseline — Lee MSA delta vs state signals local over/underperformance.`,
    );
  }

  const caveats: string[] = [
    `Sales-velocity baseline is derived from each parcel's LATEST qualified sale, so re-sales attributed to recent years are subtracted from earlier-year buckets. Current-year z-score is therefore biased UPWARD; treat marginal bullish reads as suggestive rather than confirmatory.`,
    `Qualified-sale-only sample: inheritance, divorce, and non-arms-length transfers do not appear in the velocity counts. The signal measures market-mediated parcel turnover, not total ownership change.`,
    `Lee County only — Collier and Charlotte are NOT included. SWFL-wide reads must be assembled from sibling brains (not yet built).`,
    `FHFA HPI metrics (Cape Coral MSA + FL state) use a repeat-sale methodology and are published quarterly with a ~2-month lag. They measure price-level change, not transaction volume — the LeePA z-score and the FHFA YoY are complementary, not interchangeable.`,
    `Save-Our-Homes gap median is restricted to parcels with cap_difference > 0 (actively benefiting from the SOH cap). Non-homestead and newly-homesteaded parcels are excluded from the median; total_parcels is the full snapshot row count for context.`,
    `Direction thresholds: bullish if z ≥ +${Z_BULL_THRESHOLD.toFixed(1)}σ; bearish if z ≤ ${Z_BEAR_THRESHOLD.toFixed(1)}σ; neutral otherwise. Standard deviation is population std over ${BASELINE_YEAR_COUNT} baseline years; if variance is zero (all baseline years identical) z is undefined and direction is neutral.`,
  ];
  if (env.source === "fixture") {
    caveats.unshift(
      "LeePA parcels in this build are synthetic fixture data — unset REFINERY_SOURCE or set it to `live` to query data_lake.leepa_parcels.",
    );
  }

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats,
    direction,
    magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals,
  };
}

export const propertiesLeeValue: PackDefinition = {
  id: "properties-lee-value",
  brain_id: "properties-lee-value",
  public_label: "Lee County Properties",
  domain: "real-estate",
  scope:
    "Lee County (FL) parcel-value direction read — sales-velocity z-score (current year vs trailing 3yr) plus Save-Our-Homes gap median across homesteaded parcels, derived from the LeePA Property Appraiser snapshot.",
  ttl_seconds: 2592000, // 30 days — LeePA pulls are scheduled monthly
  sources: [leepaValueSource, fhfaHpiSource],
  input_brains: [],
  fitScore: (): number => 8,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: propertyValueCorpusSummary,
  outputProducer: propertyValueOutputProducer,
  preferences: [
    "The user reads Lee-specific real-estate signals as a county-scoped check against the SWFL-wide cre-swfl brain; divergence between them is itself a signal worth surfacing.",
    "The user treats sales velocity as the leading indicator of direction in v1, with the Save-Our-Homes gap as a level metric describing how much of the tax base is locked behind the homestead cap.",
    "The user expects new LeePA-derived sibling brains (supply, corridors, flood) to land additively against the same Tier 2 leepa_parcels table without re-ingesting layers.",
  ],
  activeProject:
    "properties-lee-value: standing snapshot of Lee County parcel-value direction — sales-velocity z-score + SOH gap median, leaf brain feeding master.",
  prompts: {
    triageContext:
      "These fragments are pre-aggregated per-year sales counts plus a single-row snapshot summary from data_lake.leepa_parcels. They are all decision-relevant by construction; the pack is pure deterministic aggregation over pre-aggregated source values.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by propertyValueCorpusSummary and the BrainOutput is built by propertyValueOutputProducer.",
  },
};
