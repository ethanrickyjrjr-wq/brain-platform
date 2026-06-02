import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import {
  fdotSource,
  LATEST_FDOT_YEAR,
  type TrafficCountyYearNormalized,
  type TrafficCohortYoYNormalized,
} from "../sources/fdot-source.mts";
import { env } from "../config/env.mts";

/**
 * traffic-swfl — FDOT AADT (Annual Average Daily Traffic) for SWFL corridors.
 *
 * Single source: data_lake.fdot_aadt_fl (Tier 2, populated by the FDOT dlt
 * pipeline). The source connector pre-aggregates raw segment rows into
 * per-(county, year) length-weighted buckets and one cohort-matched YoY
 * fragment — this pack is a pure reader of those pre-aggregated values.
 *
 * Five SKOS metrics:
 *   1. traffic_aadt_swfl_avg              — latest-year length-weighted AADT (Lee + Collier)
 *   2. traffic_aadt_swfl_yoy_pct          — cohort-matched YoY (Lee + Collier)
 *   3. traffic_aadt_swfl_5yr_cagr_pct     — 5yr CAGR (Lee + Collier)
 *   4. traffic_truck_share_swfl_median_pct — median TFCTR (Lee + Collier)
 *   5. traffic_post_ian_recovery_index     — 2025/2022 ratio (Lee + Collier + CHARLOTTE; storm-geo exception)
 *
 * Direction thresholds: bullish if YoY ≥ +3%, bearish if YoY ≤ −3%, neutral
 * otherwise. Symmetric, deliberately narrower than the macro brains' ±5%
 * (SWFL corridor traffic moves slower than macro indicators).
 *
 * Leaf brain (no upstream brains). Pure deterministic — no synthesis agent.
 */

const BRAIN_COUNTIES = ["Lee", "Collier"] as const;
const IAN_COUNTIES = ["Lee", "Collier", "Charlotte"] as const;
const IAN_BASELINE_YEAR = 2022;
const FIVE_YEAR_BASE = LATEST_FDOT_YEAR - 4;
const WINDOW_GAP = LATEST_FDOT_YEAR - FIVE_YEAR_BASE; // years between CAGR endpoints
const PRIOR_YEAR = LATEST_FDOT_YEAR - 1;

const YOY_BULL_THRESHOLD = 3;
const YOY_BEAR_THRESHOLD = -3;

interface TrafficAggregates {
  /** Latest-year length-weighted AADT averaged across Lee + Collier. */
  latestAvgAadt: number | null;
  /** Per-county latest-year buckets for the brain scope. */
  latestByCounty: TrafficCountyYearNormalized[];
  /** Cohort YoY pct (Lee + Collier). */
  yoyPct: number | null;
  cohortSize: number;
  /** 5-yr CAGR pct (Lee + Collier). */
  cagrPct: number | null;
  /** Median TFCTR across Lee + Collier latest year. */
  medianTfctr: number | null;
  /** Ian recovery index (LATEST/2022) across Lee + Collier + Charlotte. */
  ianRecoveryIndex: number | null;
  ianBaseAadt: number | null;
  ianLatestAadt: number | null;
  /** Sanity counters. */
  segmentCountLatest: number;
}

let lastAggregate: TrafficAggregates | null = null;
let lastFetchedAt: string | null = null;

function countyYearsFrom(
  fragments: RawFragment[],
): TrafficCountyYearNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as TrafficCountyYearNormalized)
    .filter((n) => n?.kind === "fdot-county-year");
}

function cohortFrom(
  fragments: RawFragment[],
): TrafficCohortYoYNormalized | null {
  const match = fragments
    .map((f) => f.normalized as unknown as TrafficCohortYoYNormalized)
    .find((n) => n?.kind === "fdot-cohort-yoy");
  return match ?? null;
}

function weightedAvgAcrossCounties(
  buckets: TrafficCountyYearNormalized[],
  counties: readonly string[],
  year: number,
): { avg: number; segmentCount: number } | null {
  const inScope = buckets.filter(
    (b) => counties.includes(b.county) && b.year === year,
  );
  if (inScope.length === 0) return null;
  let weighted = 0;
  let totalLen = 0;
  let count = 0;
  for (const b of inScope) {
    weighted += b.weighted_avg_aadt * b.sum_shape_length;
    totalLen += b.sum_shape_length;
    count += b.segment_count;
  }
  if (totalLen === 0) return null;
  return { avg: weighted / totalLen, segmentCount: count };
}

function medianTfctrAcrossCounties(
  buckets: TrafficCountyYearNormalized[],
  counties: readonly string[],
  year: number,
): number | null {
  const inScope = buckets.filter(
    (b) => counties.includes(b.county) && b.year === year,
  );
  if (inScope.length === 0) return null;
  // Length-weighted median is hard without raw segments; the source already
  // computed per-county median TFCTR, so we report a length-weighted MEAN of
  // those per-county medians as the brain-level estimate. Documented in caveats.
  let weighted = 0;
  let totalLen = 0;
  for (const b of inScope) {
    weighted += b.median_tfctr * b.sum_shape_length;
    totalLen += b.sum_shape_length;
  }
  return totalLen === 0 ? null : weighted / totalLen;
}

function aggregate(
  buckets: TrafficCountyYearNormalized[],
  cohort: TrafficCohortYoYNormalized | null,
): TrafficAggregates {
  const latest = weightedAvgAcrossCounties(
    buckets,
    BRAIN_COUNTIES,
    LATEST_FDOT_YEAR,
  );
  const base5yr = weightedAvgAcrossCounties(
    buckets,
    BRAIN_COUNTIES,
    FIVE_YEAR_BASE,
  );

  let cagrPct: number | null = null;
  if (latest && base5yr && base5yr.avg > 0) {
    const ratio = latest.avg / base5yr.avg;
    cagrPct = (Math.pow(ratio, 1 / WINDOW_GAP) - 1) * 100;
  }

  const ianBase = weightedAvgAcrossCounties(
    buckets,
    IAN_COUNTIES,
    IAN_BASELINE_YEAR,
  );
  const ianLatest = weightedAvgAcrossCounties(
    buckets,
    IAN_COUNTIES,
    LATEST_FDOT_YEAR,
  );
  const ianRecovery =
    ianBase && ianLatest && ianBase.avg > 0
      ? (ianLatest.avg / ianBase.avg) * 100
      : null;

  return {
    latestAvgAadt: latest?.avg ?? null,
    latestByCounty: buckets.filter(
      (b) =>
        BRAIN_COUNTIES.includes(b.county as (typeof BRAIN_COUNTIES)[number]) &&
        b.year === LATEST_FDOT_YEAR,
    ),
    yoyPct: cohort?.yoy_pct ?? null,
    cohortSize: cohort?.cohort_size ?? 0,
    cagrPct,
    medianTfctr: medianTfctrAcrossCounties(
      buckets,
      BRAIN_COUNTIES,
      LATEST_FDOT_YEAR,
    ),
    ianRecoveryIndex: ianRecovery,
    ianBaseAadt: ianBase?.avg ?? null,
    ianLatestAadt: ianLatest?.avg ?? null,
    segmentCountLatest: latest?.segmentCount ?? 0,
  };
}

const fmt1 = (n: number): string =>
  Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();

export function directionFromYoY(
  yoyPct: number | null,
): "bullish" | "bearish" | "neutral" {
  if (yoyPct == null) return "neutral";
  if (yoyPct >= YOY_BULL_THRESHOLD) return "bullish";
  if (yoyPct <= YOY_BEAR_THRESHOLD) return "bearish";
  return "neutral";
}

function metricDirectionFromValue(
  v: number,
  posMeans: "rising" | "falling",
): "rising" | "falling" | "stable" {
  if (Math.abs(v) < 0.5) return "stable";
  if (v > 0) return posMeans === "rising" ? "rising" : "falling";
  return posMeans === "rising" ? "falling" : "rising";
}

function buildFdotSource(
  fetched_at: string,
  segmentCount: number,
): BrainOutputMetricSource {
  const url =
    env.source === "live" && env.supabaseUrl
      ? `${env.supabaseUrl}/rest/v1/fdot_aadt_fl?select=year_,county,roadway,desc_frm,desc_to,aadt,aadtflg,tfctr,shape_length&county=in.(LEE,COLLIER,CHARLOTTE)`
      : "fixture://refinery/__fixtures__/traffic-swfl.sample.json";
  const provenance =
    env.source === "live"
      ? "FDOT AADT segments via data_lake.fdot_aadt_fl (dlt-ingested from FDOT FTO_PROD/MapServer/7)"
      : "FDOT AADT segments (fixture; refinery/__fixtures__/traffic-swfl.sample.json)";
  return {
    url,
    fetched_at,
    tier: 2,
    citation:
      `${provenance} — ` +
      `counties Lee + Collier (Charlotte added for the post-Ian recovery exception), years ${FIVE_YEAR_BASE}-${LATEST_FDOT_YEAR}, non-null AADT only. ` +
      `Aggregate: ${segmentCount} latest-year segments contributing to the length-weighted corridor average.`,
  };
}

function trafficCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const buckets = countyYearsFrom(allFragments);
  const cohort = cohortFrom(allFragments);
  lastAggregate = aggregate(buckets, cohort);
  lastFetchedAt = allFragments[0]?.fetched_at ?? null;

  if (lastAggregate.latestAvgAadt == null) return [];

  const agg = lastAggregate;
  const facts: SynthesisFact[] = [];

  facts.push({
    topic: "corpus_overview",
    fact: "FDOT AADT corpus — Lee + Collier corridor segments, latest published year",
    value:
      `${agg.segmentCountLatest} non-null AADT segments aggregated across Lee + Collier counties for year ${LATEST_FDOT_YEAR}. ` +
      `Length-weighting source: shape_length (auto-generated geometry length). Cohort YoY size: ${agg.cohortSize} segments present with non-null AADT in BOTH ${PRIOR_YEAR} and ${LATEST_FDOT_YEAR}.`,
    source_fragment_ids: [],
  });

  if (agg.latestAvgAadt != null) {
    facts.push({
      topic: "metric:aadt_swfl_avg",
      fact: "SWFL length-weighted average AADT (latest year)",
      value: `Length-weighted average AADT across Lee + Collier in ${LATEST_FDOT_YEAR}: ${fmt1(agg.latestAvgAadt)} vehicles/day.`,
      source_fragment_ids: [],
    });
  }

  if (agg.yoyPct != null) {
    facts.push({
      topic: "metric:aadt_yoy_pct",
      fact: "SWFL AADT year-over-year change (cohort-matched)",
      value: `Cohort-matched YoY change ${PRIOR_YEAR}→${LATEST_FDOT_YEAR}: ${fmt1(agg.yoyPct)}% over ${agg.cohortSize} segments present with non-null AADT in both years.`,
      source_fragment_ids: [],
    });
  }

  if (agg.cagrPct != null) {
    facts.push({
      topic: "metric:aadt_5yr_cagr",
      fact: "SWFL AADT 5-year CAGR",
      value: `5-year CAGR (${FIVE_YEAR_BASE} → ${LATEST_FDOT_YEAR}): ${fmt1(agg.cagrPct)}% per year.`,
      source_fragment_ids: [],
    });
  }

  if (agg.medianTfctr != null) {
    facts.push({
      topic: "metric:truck_share_median",
      fact: "SWFL median truck factor (TFCTR, latest year)",
      value: `Median TFCTR across Lee + Collier in ${LATEST_FDOT_YEAR}: ${fmt1(agg.medianTfctr * 100)}% truck share.`,
      source_fragment_ids: [],
    });
  }

  if (agg.ianRecoveryIndex != null) {
    facts.push({
      topic: "metric:post_ian_recovery",
      fact: "Coastal SWFL post-Ian traffic recovery index (Lee + Collier + Charlotte)",
      value: `Length-weighted AADT in ${LATEST_FDOT_YEAR} vs ${IAN_BASELINE_YEAR} baseline across Lee + Collier + Charlotte: ${fmt1(agg.ianRecoveryIndex)} (2022 = 100).`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

function trafficOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const agg = lastAggregate;
  const fetched_at =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!agg || agg.latestAvgAadt == null) {
    return {
      conclusion:
        "traffic-swfl could not resolve any FDOT AADT segments for Lee + Collier in the latest year — no corridor context available this build.",
      key_metrics: [],
      caveats: [
        `No segments returned by ${env.source === "fixture" ? "fixture" : "live data_lake.fdot_aadt_fl query"}. ` +
          "If live, confirm the dlt pipeline ran (python -m ingest.pipelines.fdot.pipeline) and that docs/sql/fdot_aadt_fl_grant.sql was applied.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const sourceMeta = buildFdotSource(fetched_at, agg.segmentCountLatest);
  // Level metrics (aadt_swfl_avg, truck_share_median) are hardcoded direction:"stable"
  // because they are scalars at a single point in time — their YoY direction lives in
  // a sibling delta metric (aadt_yoy_pct) rather than being inferred from the level.
  const key_metrics: BrainOutputMetric[] = [
    {
      metric: "aadt_swfl_avg",
      value: Math.round(agg.latestAvgAadt),
      direction: "stable",
      label: `SWFL length-weighted average AADT, year ${LATEST_FDOT_YEAR} (vehicles/day)`,
      // AADT is a daily count averaged across corridor segments (an aggregate
      // count, not a per-unit rate) — extensive.
      variable_type: "extensive",
      units: "vehicles/day",
      display_format: "count",
      source: sourceMeta,
    },
  ];

  if (agg.yoyPct != null) {
    key_metrics.push({
      metric: "aadt_yoy_pct",
      value: Math.round(agg.yoyPct * 10) / 10,
      direction: metricDirectionFromValue(agg.yoyPct, "rising"),
      label: `SWFL AADT YoY change ${PRIOR_YEAR}→${LATEST_FDOT_YEAR}, cohort-matched (%)`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: sourceMeta,
    });
  }
  if (agg.cagrPct != null) {
    key_metrics.push({
      metric: "aadt_5yr_cagr",
      value: Math.round(agg.cagrPct * 10) / 10,
      direction: metricDirectionFromValue(agg.cagrPct, "rising"),
      label: `SWFL AADT 5-year CAGR (${FIVE_YEAR_BASE} → ${LATEST_FDOT_YEAR}, %)`,
      variable_type: "intensive",
      units: "percent/year",
      display_format: "percent",
      source: sourceMeta,
    });
  }
  if (agg.medianTfctr != null) {
    // Level metric — same rationale as aadt_swfl_avg above. No YoY for TFCTR
    // because FDOT publishes annually and a single-segment truck-factor delta is
    // too noisy to translate into a directional read at the corridor level.
    key_metrics.push({
      metric: "truck_share_median",
      value: Math.round(agg.medianTfctr * 1000) / 10,
      direction: "stable",
      label: `SWFL median truck factor (TFCTR × 100), year ${LATEST_FDOT_YEAR}`,
      // Truck factor is a share (%) — intensive ratio.
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: sourceMeta,
    });
  }
  if (agg.ianRecoveryIndex != null) {
    key_metrics.push({
      metric: "post_ian_recovery",
      value: Math.round(agg.ianRecoveryIndex * 10) / 10,
      direction: agg.ianRecoveryIndex >= 100 ? "rising" : "falling",
      label: `Coastal SWFL (Lee + Collier + Charlotte) post-Ian recovery index, ${LATEST_FDOT_YEAR} ÷ ${IAN_BASELINE_YEAR} × 100`,
      // Recovery index = ratio × 100 (so 100 = baseline). Intensive index.
      variable_type: "intensive",
      units: "index (2022=100)",
      display_format: "ratio",
      source: sourceMeta,
    });
  }

  const direction = directionFromYoY(agg.yoyPct);
  // Magnitude convention:
  //   - With a YoY signal: |yoy_pct| / 10 (clamped to [0,1]). 10% YoY ⇒ full magnitude.
  //   - Without YoY (no cohort match): default to 0.3 — a "weak but non-zero" signal so
  //     master's rollup still sees us as a low-weight contributor rather than a hard zero.
  //     Direction stays "neutral" in that path, so the 0.3 only shows up as a tie-breaker
  //     in voteDirection, not as a directional vote.
  const magnitude =
    agg.yoyPct == null ? 0.3 : Math.min(1, Math.abs(agg.yoyPct) / 10);

  const conclusionParts: string[] = [];
  conclusionParts.push(
    `SWFL (Lee + Collier) length-weighted AADT in ${LATEST_FDOT_YEAR} averaged ${fmt1(agg.latestAvgAadt)} vehicles/day across ${agg.segmentCountLatest} FDOT segments.`,
  );
  if (agg.yoyPct != null) {
    conclusionParts.push(
      `Cohort-matched YoY ${PRIOR_YEAR}→${LATEST_FDOT_YEAR}: ${fmt1(agg.yoyPct)}% over ${agg.cohortSize} segments — ${direction} read on corridor demand.`,
    );
  }
  if (agg.cagrPct != null) {
    conclusionParts.push(
      `5-year CAGR ${FIVE_YEAR_BASE}→${LATEST_FDOT_YEAR}: ${fmt1(agg.cagrPct)}% per year.`,
    );
  }
  if (agg.ianRecoveryIndex != null) {
    const ianFraming = agg.ianRecoveryIndex >= 100 ? "above" : "below";
    conclusionParts.push(
      `Coastal post-Ian recovery (Lee + Collier + Charlotte, ${LATEST_FDOT_YEAR}/${IAN_BASELINE_YEAR}): ${fmt1(agg.ianRecoveryIndex)} — ${ianFraming} pre-storm baseline.`,
    );
  }

  const caveats: string[] = [
    `Length-weighting uses shape_length (auto-generated geometry length in the layer projection). The shape_leng attribute is not consulted — it may be stale after route realignments.`,
    `Cohort-matched YoY identifies segments by (roadway, desc_frm, desc_to). If FDOT changes any of those three fields between years for the same physical segment, that segment drops from the cohort silently — small cohort sizes (< 100) should be read with skepticism.`,
    `Truck factor metric reports a length-weighted MEAN of per-county MEDIANS rather than a true cross-county median (true median would require raw segment access, defeating the source aggregation). Treat the value as a county-mix-aware estimate, not an exact statistic.`,
    `Year scope is ${FIVE_YEAR_BASE}-${LATEST_FDOT_YEAR}. Bump LATEST_FDOT_YEAR in refinery/sources/fdot-source.mts when FDOT publishes the next vintage.`,
    `Post-Ian recovery index DELIBERATELY uses a wider 3-county set (Lee + Collier + Charlotte) than the brain's standard 2-county scope — Charlotte sat in Ian's eye-wall path and must be included for the storm signal to be honest. The other 4 metrics stay 2-county.`,
    `Direction thresholds: bullish ≥ +${YOY_BULL_THRESHOLD}% YoY; bearish ≤ ${YOY_BEAR_THRESHOLD}% YoY; neutral otherwise.`,
  ];
  if (env.source === "fixture") {
    caveats.unshift(
      "FDOT AADT segments in this build are synthetic fixture data — unset REFINERY_SOURCE or set it to `live` to query data_lake.fdot_aadt_fl.",
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
    exogenous_signals: [],
  };
}

export const trafficSwfl: PackDefinition = {
  id: "traffic-swfl",
  brain_id: "traffic-swfl",
  public_label: "Traffic & Growth",
  domain: "logistics",
  scope:
    "FDOT AADT corridor traffic for SWFL (Lee + Collier) — latest-year length-weighted average, cohort-matched YoY, 5-year CAGR, median truck factor, plus a 3-county post-Ian recovery index.",
  ttl_seconds: 2592000, // 30 days — FDOT publishes annually
  sources: [fdotSource],
  input_brains: [],
  fitScore: (): number => 8,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: trafficCorpusSummary,
  outputProducer: trafficOutputProducer,
  preferences: [
    "The user is an SWFL operator or analyst reading corridor traffic to size demand against fixed-location retail, food, and service footprints.",
    "The user treats AADT as a corridor-demand snapshot, not a leading indicator — direction reads come from cohort-matched YoY and 5-year CAGR rather than a single-year level.",
    "The user pairs corridor traffic with logistics-swfl freight flows cross-vertically through master synthesis; AADT says WHERE vehicles move, FAF5 says WHAT TOTAL VOLUME they carry.",
  ],
  activeProject:
    "traffic-swfl: standing snapshot of SWFL corridor AADT — length-weighted average, YoY, CAGR, truck factor, plus post-Ian recovery index for storm-zone framing.",
  prompts: {
    triageContext:
      "These fragments are FDOT AADT (county, year) aggregates plus one cohort-matched YoY fragment. They are all decision-relevant by construction; the pack is pure deterministic aggregation over pre-aggregated source values.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by trafficCorpusSummary and the BrainOutput is built by trafficOutputProducer.",
  },
};
