import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputDirection,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
  BrainOutputDetailTable,
  BrainOutputDetailRow,
} from "../types/brain-output.mts";
import { stressDropsSource, type PriceDropsRow } from "../sources/stress-price-drops-source.mts";
import {
  stressCancSource,
  type CancellationsRow,
} from "../sources/stress-cancellations-source.mts";
import { stressDelistSource, type DelistingsRow } from "../sources/stress-delistings-source.mts";
import { subtractMonthsUtc, isoDate } from "../lib/dates.mts";

const BRAIN_ID = "seller-stress-swfl";

// ── Weights (all signals are NEGATIVE-ON-RISE: higher value = more stress = bearish) ──

// Exported so the test can assert on the SHIPPING weights (not hardcoded literals).
export const DELISTING_WEIGHT = 0.3; // Redfin Nov 2025: delistings lead price unlock
export const PRICE_DROP_BREADTH_WEIGHT = 0.25; // Zillow MHI (2024): price cut share = primary coincident
export const CANCELLATION_WEIGHT = 0.25; // Calibrated: equal-weight with price-drop breadth as first-order proxy; no published ZIP-grain cancellation composite precedent — pending empirical tuning
export const PRICE_DROP_DEPTH_WEIGHT = 0.15; // Dallas Fed (2023): depth amplifies breadth signal but lags it
export const RELISTING_WEIGHT = 0.05; // Low-information at ZIP grain

const BASELINE_START = "2019-01-01"; // Pre-COVID, pre-rate-shock equilibrium
const BASELINE_END = "2021-12-31"; // Fed rate shock (Mar 2022) + Ian (Sept 2022) excluded

const N_BASELINE_MIN = 18; // Min monthly observations in baseline window to compute a score
const N_TRAILING_MIN = 3; // Min recent periods required to compute a current reading

// Judgment floor, NOT a derived value (calibration, pending empirical tuning — same status as
// CANCELLATION_WEIGHT). Require >= 3 of the 5 signals present at the latest period so a
// published composite reflects multiple independent signals. Below 3, renormalization would
// stretch one or two metrics (incl. the low-information relisting share) across the full
// 0–100 range and print a lone-signal score that isn't interpretable at ZIP grain. Set to 3,
// not 2 (too thin — could publish on one informative signal + relisting noise) and not 4
// (would suppress the ~9 live ZIPs that drop a single signal in a given monthly vintage).
const MIN_SIGNALS_AT_LATEST = 3;

const SCORE_FLOOR_SIGMA = -2.0; // raw composite <= this → score 0
// Display ceiling only (direction/magnitude read raw composite, decoupled below).
// Measured 2026-06-14 live distribution: the 11 ZIPs pegged at 100 under CEIL=2.0
// spanned raw 2.02–3.05 — a single 3σ outlier (33983 @ 3.05) over a cluster at
// 2.02–2.58, all flattened to an identical 100. Widened 2.0→3.0 (the observed
// extreme): the outlier still reads 100, the cluster spreads ~80–92, ceiling
// saturation 11→1. NOT 3.8 (no data supports it) and FLOOR left at -2.0 (no
// floor-side saturation — the distribution is right-skewed toward stress).
const SCORE_CEIL_SIGMA = 3.0; // raw composite >= this → score 100

// ── Domain types ──────────────────────────────────────────────────────────────

interface UnifiedPeriodRow {
  pct_active_with_drops: number | null;
  avg_price_drop_pct: number | null;
  cancellation_rate_pct: number | null;
  share_delisted_pct: number | null;
  share_relisted_pct: number | null;
}

interface BaselineStats {
  mean: number;
  stddev: number;
  count: number;
}

interface ZipScore {
  zip_code: string;
  score: number;
  raw_composite: number;
  baseline_suppressed: false;
  trailing_suppressed: false;
  periods_scored: number;
  pct_active_with_drops: number | null;
  avg_price_drop_pct: number | null;
  cancellation_rate_pct: number | null;
  share_delisted_pct: number | null;
  share_relisted_pct: number | null;
}

interface ZipSuppressed {
  zip_code: string;
  baseline_suppressed: boolean;
  trailing_suppressed: boolean;
  periods_scored: number;
}

interface SellerStressData {
  latestPeriod: string;
  scoredZips: ZipScore[];
  suppressedZips: ZipSuppressed[];
  swflMedianScore: number | null;
  /** Median of per-ZIP raw composites (sigma space). Direction/magnitude read
   *  THIS, not the clamped 0-100 score, so they survive SCORE_CEIL_SIGMA changes. */
  swflMedianRawComposite: number | null;
  medianDelistingsRate: number | null;
  medianPriceDropsRate: number | null;
  medianCancellationRate: number | null;
  medianAvgDropDepth: number | null;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function median(values: readonly (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computeStats(values: readonly (number | null)[]): BaselineStats | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length < N_BASELINE_MIN) return null;
  const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
  const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length;
  return { mean, stddev: Math.sqrt(variance), count: nums.length };
}

function zScore(value: number | null, stats: BaselineStats | null): number | null {
  if (value === null || stats === null) return null;
  if (stats.stddev === 0) return 0;
  return (value - stats.mean) / stats.stddev;
}

// Exported so the ceiling-tuning regression test asserts the SHIPPING map (not a
// re-derived copy) — a future SCORE_CEIL_SIGMA edit that re-bunches the top decile
// must fail the test, not sail through.
export function rawCompositeToScore(raw: number): number {
  const clamped = Math.max(SCORE_FLOOR_SIGMA, Math.min(SCORE_CEIL_SIGMA, raw));
  return ((clamped - SCORE_FLOOR_SIGMA) / (SCORE_CEIL_SIGMA - SCORE_FLOOR_SIGMA)) * 100;
}

// ── Module-level state (handoff corpusSummary → outputProducer) ───────────────

let lastData: SellerStressData | null = null;
let lastFetchedAt: string | null = null;

// ── corpusSummary ─────────────────────────────────────────────────────────────

function sellerStressCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  lastData = null;
  lastFetchedAt = null;

  // Partition fragments by source
  const dropRows = new Map<string, PriceDropsRow>(); // "zip|period" → row
  const cancRows = new Map<string, CancellationsRow>();
  const delistRows = new Map<string, DelistingsRow>();

  for (const f of allFragments) {
    const key = `${(f.normalized as { zip_code?: string }).zip_code ?? ""}|${(f.normalized as { period_begin?: string }).period_begin ?? ""}`;
    if (f.source_id === "redfin_price_drops_swfl") {
      dropRows.set(key, f.normalized as PriceDropsRow);
    } else if (f.source_id === "redfin_contract_cancellations_swfl") {
      cancRows.set(key, f.normalized as CancellationsRow);
    } else if (f.source_id === "redfin_delistings_relistings_swfl") {
      delistRows.set(key, f.normalized as DelistingsRow);
    }
  }

  if (dropRows.size === 0 && cancRows.size === 0 && delistRows.size === 0) return [];

  // Collect all unique (zip, period) combos
  const allKeys = new Set([...dropRows.keys(), ...cancRows.keys(), ...delistRows.keys()]);

  // Build per-ZIP, per-period unified rows
  const byZip = new Map<string, Map<string, UnifiedPeriodRow>>();
  for (const key of allKeys) {
    const [zip, period] = key.split("|");
    if (!zip || !period) continue;
    if (!byZip.has(zip)) byZip.set(zip, new Map());
    const zipMap = byZip.get(zip)!;
    const drop = dropRows.get(key);
    const canc = cancRows.get(key);
    const delist = delistRows.get(key);
    zipMap.set(period, {
      pct_active_with_drops: drop?.pct_active_with_drops ?? null,
      avg_price_drop_pct: drop?.avg_price_drop_pct ?? null,
      cancellation_rate_pct: canc?.cancellation_rate_pct ?? null,
      share_delisted_pct: delist?.share_delisted_pct ?? null,
      share_relisted_pct: delist?.share_relisted_pct ?? null,
    });
  }

  // Determine latest period across all zips
  let latestPeriod = "";
  for (const key of allKeys) {
    const period = key.split("|")[1] ?? "";
    if (period > latestPeriod) latestPeriod = period;
  }

  const scoredZips: ZipScore[] = [];
  const suppressedZips: ZipSuppressed[] = [];

  for (const [zip, periodMap] of byZip.entries()) {
    const periods = [...periodMap.keys()].sort();

    // Split baseline vs trailing
    const baselinePeriods = periods.filter((p) => p >= BASELINE_START && p <= BASELINE_END);
    // Trailing: the 12 months ending at (and including) the latest period — a true rolling
    // window via the tested dates.mts util. The old `latestPeriod.slice(0,4)+"-01-01"` was
    // calendar-YTD, which silently starved the N_TRAILING_MIN guard every Jan–Mar (≤2 in-year
    // periods → every ZIP suppressed → brain flips to neutral with NO error thrown).
    const trailingCutoff = isoDate(
      subtractMonthsUtc(new Date(`${latestPeriod}T00:00:00.000Z`), 11),
    );
    const recentPeriods = periods.filter((p) => p >= trailingCutoff);

    // Baseline guard runs first: a ZIP with no usable baseline is suppressed regardless of trailing data
    const baselineRows = baselinePeriods.map((p) => periodMap.get(p)!);
    const statsDelisting = computeStats(baselineRows.map((r) => r.share_delisted_pct));
    const statsBreadth = computeStats(baselineRows.map((r) => r.pct_active_with_drops));
    const statsCanc = computeStats(baselineRows.map((r) => r.cancellation_rate_pct));
    const statsDepth = computeStats(baselineRows.map((r) => r.avg_price_drop_pct));
    const statsRelisting = computeStats(baselineRows.map((r) => r.share_relisted_pct));

    // DEVIATION FROM SPEC (documented): the spec suppressed a ZIP unless it had
    // N_BASELINE_MIN observations outright. Instead we require >= 2 of the 5 signals to each
    // carry a usable baseline (>= N_BASELINE_MIN obs). This is only a cheap early filter —
    // the binding constraint is MIN_SIGNALS_AT_LATEST below, which requires >= 3
    // baseline-backed signals to actually be present at the latest period before scoring.
    const validBaseline = [
      statsDelisting,
      statsBreadth,
      statsCanc,
      statsDepth,
      statsRelisting,
    ].filter(Boolean).length;
    if (validBaseline < 2) {
      suppressedZips.push({
        zip_code: zip,
        baseline_suppressed: true,
        trailing_suppressed: false,
        periods_scored: recentPeriods.length,
      });
      continue;
    }

    if (recentPeriods.length < N_TRAILING_MIN) {
      suppressedZips.push({
        zip_code: zip,
        baseline_suppressed: false,
        trailing_suppressed: true,
        periods_scored: recentPeriods.length,
      });
      continue;
    }

    // Get the latest period's values for this ZIP
    const latestRow = periodMap.get(latestPeriod) ?? periodMap.get(periods[periods.length - 1]!);
    if (!latestRow) {
      suppressedZips.push({
        zip_code: zip,
        baseline_suppressed: false,
        trailing_suppressed: true,
        periods_scored: 0,
      });
      continue;
    }

    // Compute z-scores
    const zDelisting = zScore(latestRow.share_delisted_pct, statsDelisting);
    const zBreadth = zScore(latestRow.pct_active_with_drops, statsBreadth);
    const zCanc = zScore(latestRow.cancellation_rate_pct, statsCanc);
    const zDepth = zScore(latestRow.avg_price_drop_pct, statsDepth);
    const zRelisting = zScore(latestRow.share_relisted_pct, statsRelisting);

    // Weighted composite. A signal is "present" only when it has both a latest value AND a
    // usable baseline (zScore returns null otherwise).
    const weightedTerms: Array<[number | null, number]> = [
      [zDelisting, DELISTING_WEIGHT],
      [zBreadth, PRICE_DROP_BREADTH_WEIGHT],
      [zCanc, CANCELLATION_WEIGHT],
      [zDepth, PRICE_DROP_DEPTH_WEIGHT],
      [zRelisting, RELISTING_WEIGHT],
    ];
    // CAP (documented decision): require >= MIN_SIGNALS_AT_LATEST present signals before
    // publishing a composite. Without it a ZIP carrying a single signal would have that lone
    // z-score renormalized across the full 0–100 range and printed as a confident score — an
    // ungrounded claim. Below the floor we suppress, exactly like the baseline guard.
    const presentSignals = weightedTerms.filter(([z]) => z !== null).length;
    if (presentSignals < MIN_SIGNALS_AT_LATEST) {
      suppressedZips.push({
        zip_code: zip,
        baseline_suppressed: false,
        trailing_suppressed: true,
        periods_scored: recentPeriods.length,
      });
      continue;
    }
    let rawComposite = 0;
    let totalWeight = 0;
    for (const [z, w] of weightedTerms) {
      if (z !== null) {
        rawComposite += z * w;
        totalWeight += w;
      }
    }
    // Renormalize over the present weights so a ZIP missing 1–2 signals lands on the same
    // 0–100 scale. Bounded by the cap above (>= 3 signals always contribute), so no single
    // metric can dominate the composite. totalWeight is guaranteed > 0 by the cap.
    if (totalWeight < 1.0) rawComposite = rawComposite / totalWeight;

    const score = rawCompositeToScore(rawComposite);

    scoredZips.push({
      zip_code: zip,
      score: Math.round(score * 10) / 10,
      raw_composite: Math.round(rawComposite * 100) / 100,
      baseline_suppressed: false,
      trailing_suppressed: false,
      periods_scored: recentPeriods.length,
      pct_active_with_drops: latestRow.pct_active_with_drops,
      avg_price_drop_pct: latestRow.avg_price_drop_pct,
      cancellation_rate_pct: latestRow.cancellation_rate_pct,
      share_delisted_pct: latestRow.share_delisted_pct,
      share_relisted_pct: latestRow.share_relisted_pct,
    });
  }

  if (scoredZips.length === 0) {
    lastFetchedAt = allFragments[0]?.fetched_at ?? null;
    return [];
  }

  const scores = scoredZips.map((z) => z.score);
  const swflMedianScore = median(scores);

  lastData = {
    latestPeriod,
    scoredZips,
    suppressedZips,
    swflMedianScore,
    swflMedianRawComposite: median(scoredZips.map((z) => z.raw_composite)),
    medianDelistingsRate: median(scoredZips.map((z) => z.share_delisted_pct)),
    medianPriceDropsRate: median(scoredZips.map((z) => z.pct_active_with_drops)),
    medianCancellationRate: median(scoredZips.map((z) => z.cancellation_rate_pct)),
    medianAvgDropDepth: median(scoredZips.map((z) => z.avg_price_drop_pct)),
  };
  lastFetchedAt = allFragments[0]?.fetched_at ?? null;

  return [
    {
      topic: "seller_stress_summary",
      fact: "Redfin SWFL seller stress composite",
      value: `${scoredZips.length} ZIPs scored (${suppressedZips.length} suppressed), SWFL median stress score = ${swflMedianScore?.toFixed(1) ?? "n/a"}/100, latest period = ${latestPeriod}.`,
      source_fragment_ids: [],
    },
  ];
}

// ── outputProducer ────────────────────────────────────────────────────────────

function sellerStressOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const data = lastData;
  const fetched_at = lastFetchedAt ?? new Date().toISOString();

  if (!data || data.scoredZips.length === 0) {
    return {
      conclusion: "seller-stress-swfl: no scored ZIPs available for this build.",
      key_metrics: [],
      caveats: [
        "Zero ZIPs scored. Verify the three Redfin stress parquets are populated in s3://lake-tier1/market/ and the baseline window (2019–2021) has sufficient data.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const source: BrainOutputMetricSource = {
    url: "https://www.redfin.com/news/data-center/",
    fetched_at,
    tier: 3,
    citation:
      "Redfin Data Center — price_drops, contract_cancellations, delistings_relistings ZIP-level monthly rolling-3-month data for SWFL MSAs.",
  };

  const score = data.swflMedianScore ?? 50;

  // Direction & magnitude read the SWFL median RAW composite (sigma space), NOT
  // the clamped 0-100 display score — so they are INVARIANT to SCORE_CEIL_SIGMA.
  // Thresholds are the old score gates (65/45/35) inverted through the linear map
  // at FLOOR=-2/CEIL=2: score 65->raw 0.6, 45->-0.2, 35->-0.6. Without this, widening
  // the display ceiling lowers every score, drags the median down, and silently
  // flips the headline (e.g. bearish->mixed) — a display tweak must never do that.
  const rawMedian = data.swflMedianRawComposite ?? 0;
  let direction: BrainOutputDirection;
  if (rawMedian >= 0.6) direction = "bearish";
  else if (rawMedian >= -0.2) direction = "mixed";
  else if (rawMedian >= -0.6) direction = "neutral";
  else direction = "bullish";

  const magnitude = Math.min(Math.abs(rawMedian) / 2, 1);

  // Key metrics (5)
  const key_metrics: BrainOutputMetric[] = [
    {
      metric: "seller_stress_score_swfl",
      value: Math.round(score * 10) / 10,
      direction: rawMedian > 0.2 ? "rising" : rawMedian < -0.2 ? "falling" : "stable",
      label: `SWFL median seller stress score (0-100) at ${data.latestPeriod} — ${data.scoredZips.length} ZIPs scored vs 2019–2021 baseline`,
      variable_type: "intensive",
      units: "score (0-100)",
      display_format: "raw",
      source,
    },
    {
      metric: "seller_stress_delistings_rate_swfl",
      value: data.medianDelistingsRate ?? 0,
      direction: (data.medianDelistingsRate ?? 0) > 12 ? "rising" : "stable",
      label: `SWFL median delistings rate (share of listings pulled off market without selling) — leading indicator`,
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source,
    },
    {
      metric: "seller_stress_price_drops_rate_swfl",
      value: data.medianPriceDropsRate ?? 0,
      direction: (data.medianPriceDropsRate ?? 0) > 40 ? "rising" : "stable",
      label: `SWFL median share of active listings with a price reduction — coincident indicator`,
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source,
    },
    {
      metric: "seller_stress_cancellation_rate_swfl",
      value: data.medianCancellationRate ?? 0,
      direction: (data.medianCancellationRate ?? 0) > 15 ? "rising" : "stable",
      label: `SWFL median contract cancellation rate (% of pending sales cancelled) — lagging ~30-60 days`,
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source,
    },
    {
      metric: "seller_stress_avg_drop_depth_swfl",
      value: data.medianAvgDropDepth ?? 0,
      direction: (data.medianAvgDropDepth ?? 0) > 4 ? "rising" : "stable",
      label: `SWFL median average price reduction size among listings that received a cut — lagging indicator`,
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source,
    },
  ];

  // Per-ZIP detail table
  const sortedZips = [...data.scoredZips].sort((a, b) => b.score - a.score);
  const detailRows: BrainOutputDetailRow[] = [
    ...sortedZips.map((z) => ({
      key: z.zip_code,
      label: z.zip_code,
      cells: {
        seller_stress_score: z.score,
        share_delisted_pct: z.share_delisted_pct,
        pct_active_with_drops: z.pct_active_with_drops,
        cancellation_rate_pct: z.cancellation_rate_pct,
        avg_price_drop_pct: z.avg_price_drop_pct,
        share_relisted_pct: z.share_relisted_pct,
        periods_scored: z.periods_scored,
        baseline_suppressed: false,
      },
    })),
    ...data.suppressedZips.map((z) => ({
      key: z.zip_code,
      label: z.zip_code,
      cells: {
        seller_stress_score: null,
        share_delisted_pct: null,
        pct_active_with_drops: null,
        cancellation_rate_pct: null,
        avg_price_drop_pct: null,
        share_relisted_pct: null,
        periods_scored: z.periods_scored,
        baseline_suppressed: z.baseline_suppressed,
      },
    })),
  ];

  const detail_tables: BrainOutputDetailTable[] = [
    {
      id: "seller_stress_by_zip",
      title: `SWFL seller stress by ZIP — ${data.latestPeriod} (vs 2019–2021 baseline)`,
      grain: "zip",
      columns: [
        {
          id: "seller_stress_score",
          label: "Stress Score (0-100)",
          display_format: "raw",
          units: "score",
        },
        {
          id: "share_delisted_pct",
          label: "Delistings Rate",
          display_format: "percent",
          units: "%",
        },
        {
          id: "pct_active_with_drops",
          label: "Price Drop Rate",
          display_format: "percent",
          units: "%",
        },
        {
          id: "cancellation_rate_pct",
          label: "Cancellation Rate",
          display_format: "percent",
          units: "%",
        },
        {
          id: "avg_price_drop_pct",
          label: "Avg Drop Depth",
          display_format: "percent",
          units: "%",
        },
        {
          id: "share_relisted_pct",
          label: "Relisting Rate",
          display_format: "percent",
          units: "%",
        },
        { id: "periods_scored", label: "Periods Scored", display_format: "count", units: "months" },
        { id: "baseline_suppressed", label: "Baseline Suppressed" },
      ],
      rows: detailRows,
      source,
    },
  ];

  // Required SWFL-specific caveats (from spec)
  const caveats = [
    "~50% of SWFL transactions are all-cash (Lee County, Attom 2024) — rate-sensitive national thresholds do not apply; this score is calibrated to SWFL's own 2019–2021 baseline.",
    "Hurricane Ian (Sept 2022) produced a natural spike; scores from Oct 2022–Mar 2023 reflect forced delistings, not organic seller stress — treat as a labeled distress event, not a trend.",
    "Condo segment is not separated in this score; SB 4-D special assessment delistings inflate stress in condo-heavy ZIPs (e.g., Marco Island corridor). See `condo-sirs-swfl` for the condo-specific read.",
  ];

  if (data.suppressedZips.length > 0) {
    caveats.push(
      `${data.suppressedZips.length} ZIP${data.suppressedZips.length > 1 ? "s" : ""} suppressed (insufficient baseline data in 2019–2021 or no recent observations).`,
    );
  }

  const topStressed = sortedZips
    .slice(0, 3)
    .map((z) => `${z.zip_code} (${z.score.toFixed(0)})`)
    .join(", ");
  const conclusion =
    direction === "bearish"
      ? `SWFL seller stress is elevated at ${score.toFixed(0)}/100 (bearish threshold: ≥65). ${data.scoredZips.length} of ${data.scoredZips.length + data.suppressedZips.length} ZIPs scored vs 2019–2021 baseline. Highest-stress ZIPs: ${topStressed}. Leading signal: ${(data.medianDelistingsRate ?? 0).toFixed(1)}% median delistings rate.`
      : direction === "mixed"
        ? `SWFL seller stress is mixed at ${score.toFixed(0)}/100. Some signals elevated above the 2019–2021 baseline — delistings and cancellations bear watching. ${data.scoredZips.length} ZIPs scored.`
        : direction === "neutral"
          ? `SWFL seller stress is near baseline at ${score.toFixed(0)}/100. Delistings, price drops, and cancellations are tracking close to the 2019–2021 pre-shock equilibrium. ${data.scoredZips.length} ZIPs scored.`
          : `SWFL seller stress is low at ${score.toFixed(0)}/100 (below pre-shock norms). Seller confidence is elevated across the region. ${data.scoredZips.length} ZIPs scored.`;

  return {
    conclusion,
    key_metrics,
    detail_tables,
    caveats,
    direction,
    magnitude: Math.round(magnitude * 100) / 100,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

// ── Pack definition ───────────────────────────────────────────────────────────

export const sellerStressSwfl: PackDefinition = {
  id: BRAIN_ID,
  brain_id: BRAIN_ID,
  public_label: "Seller Stress",
  domain: "real-estate",
  scope:
    "SWFL seller stress composite score (0-100) per ZIP vs the 2019–2021 pre-shock baseline, derived from three Redfin Data Center Tier-1 Parquets: price_drops, contract_cancellations, and delistings_relistings. Signals: delistings rate (leading), price drop breadth (coincident), cancellation rate (lagging), avg drop depth (lagging), relisting rate (coincident). Covers 126 SWFL ZIPs, Apr 2019–present, monthly rolling-3-month periods. All math deterministic; no LLM synthesis.",
  ttl_seconds: 30 * 24 * 60 * 60, // 30 days — matches Redfin monthly cadence

  sources: [stressDropsSource, stressCancSource, stressDelistSource],
  input_brains: [],

  fitScore: () => 8,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: sellerStressCorpusSummary,
  outputProducer: sellerStressOutputProducer,

  preferences: [
    "Answer seller stress questions at ZIP grain using the detail_table. Do not invent a score for a suppressed ZIP.",
    "The delistings rate is the LEADING signal — lead with it when explaining stress direction.",
    "Ian (Sept 2022) is a labeled event, not a trend. Do not interpret Oct 2022–Mar 2023 scores as forward-looking stress.",
  ],

  activeProject:
    "seller-stress-swfl: deterministic composite seller stress score at ZIP grain from 3 Redfin Data Center Tier-1 parquets.",

  prompts: {
    triageContext:
      "Seller stress fragments from three Redfin Data Center Tier-1 Parquets (price_drops, contract_cancellations, delistings_relistings). Join on (zip_code, period_begin) is done in TypeScript corpusSummary.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent=true). All math is deterministic: z-score normalization vs 2019–2021 baseline, weighted composite, clamp to 0-100.",
  },
};
