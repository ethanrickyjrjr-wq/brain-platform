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
import {
  marketHeatCoreSource,
  type MarketHeatCoreRow,
} from "../sources/market-heat-core-source.mts";
import {
  marketHeatHotnessSource,
  type MarketHeatHotnessRow,
} from "../sources/market-heat-hotness-source.mts";

const BRAIN_ID = "market-heat-swfl";

// ── Vote calibration (judgment floors, NOT derived values — pending empirical
//    tuning against the live SWFL distribution once the parquet lands; same
//    documented status as seller-stress-swfl's CANCELLATION_WEIGHT) ───────────

// A 30% YoY move in a signal = full-strength (|signal| = 1). The _yy columns are
// FRACTIONAL (verified: active=222, active_yy=0.4323 => +43%), so CAP is a fraction.
export const CAP = 0.3;

// Require >= 2 of the 3 primary signals present at the latest month, else the ZIP
// is suppressed (no lone-signal vote). Mirrors seller-stress MIN_SIGNALS_AT_LATEST.
export const MIN_SIGNALS = 2;

// Region direction thresholds on the median per-ZIP tilt (∈ [-1, +1]).
export const BULL_THRESHOLD = 0.25;
export const BEAR_THRESHOLD = -0.25;

// ── Pure vote helpers (exported for the polarity tests) ───────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Normalize one signal's fractional YoY to [-1, +1] where +1 = maximally bullish.
 * `sign` encodes polarity: inventory & DOM are bullish when FALLING (sign -1);
 * pending_ratio is bullish when RISING (sign +1).
 */
export function normalizeSignal(yy: number | null, sign: -1 | 1): number | null {
  if (yy === null || !Number.isFinite(yy)) return null;
  return clamp((sign * yy) / CAP, -1, 1);
}

export interface ZipSignals {
  /** active_listing_count_yy (fractional) */
  invYy: number | null;
  /** median_days_on_market_yy (fractional) */
  domYy: number | null;
  /** pending_ratio_yy (fractional) */
  pendYy: number | null;
}

export interface ZipTilt {
  tilt: number; // [-1, +1], + = bullish/tightening
  s_inv: number | null;
  s_dom: number | null;
  s_pend: number | null;
  present: number;
}

/**
 * Per-ZIP directional tilt off the inline _yy deltas. Inventory falling and DOM
 * falling are bullish (sign -1); pending_ratio RISING is bullish (sign +1) — the
 * inversion trap (realtor's pending_ratio = pending ÷ active). Returns null when
 * fewer than MIN_SIGNALS are present (the ZIP is suppressed, never voted).
 */
export function computeZipTilt(sig: ZipSignals): ZipTilt | null {
  const s_inv = normalizeSignal(sig.invYy, -1);
  const s_dom = normalizeSignal(sig.domYy, -1);
  const s_pend = normalizeSignal(sig.pendYy, 1);
  const present = [s_inv, s_dom, s_pend].filter((s): s is number => s !== null);
  if (present.length < MIN_SIGNALS) return null;
  const tilt = present.reduce((a, b) => a + b, 0) / present.length;
  return { tilt, s_inv, s_dom, s_pend, present: present.length };
}

/** Display rescale: tilt ∈ [-1,+1] → 0–100 (50 = balanced, >50 = tightening). */
export function tiltToDisplayScore(tilt: number): number {
  return (tilt + 1) * 50;
}

const sign0 = (v: number | null): -1 | 0 | 1 =>
  v === null || Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : -1;

/**
 * Region direction. ≥ +0.25 bullish, ≤ −0.25 bearish. In the flat band, "mixed"
 * when the three regional median signals disagree in sign, else "neutral".
 */
export function regionDirection(
  regionTilt: number,
  sInvMed: number | null,
  sDomMed: number | null,
  sPendMed: number | null,
): BrainOutputDirection {
  if (regionTilt >= BULL_THRESHOLD) return "bullish";
  if (regionTilt <= BEAR_THRESHOLD) return "bearish";
  const signs = [sign0(sInvMed), sign0(sDomMed), sign0(sPendMed)].filter((s) => s !== 0);
  const hasUp = signs.some((s) => s > 0);
  const hasDown = signs.some((s) => s < 0);
  return hasUp && hasDown ? "mixed" : "neutral";
}

/**
 * Falsifier watch: a ZIP exhibits the pattern when, across its last 3 monthly
 * rows, pending_ratio falls for 2 consecutive months WHILE active_listing_count
 * rises. (The bullish thesis is falsified where this holds.) Rows must be sorted
 * ascending by month. Returns false on any null in the window.
 */
export function zipExhibitsFalsifier(monthsAsc: MarketHeatCoreRow[]): boolean {
  if (monthsAsc.length < 3) return false;
  const [a, b, c] = monthsAsc.slice(-3);
  const p = [a!.pending_ratio, b!.pending_ratio, c!.pending_ratio];
  const v = [a!.active_listing_count, b!.active_listing_count, c!.active_listing_count];
  if (p.some((x) => x === null) || v.some((x) => x === null)) return false;
  const pendingFalling = p[1]! < p[0]! && p[2]! < p[1]!;
  const inventoryRising = v[1]! > v[0]! && v[2]! > v[1]!;
  return pendingFalling && inventoryRising;
}

// ── Domain types ──────────────────────────────────────────────────────────────

interface ScoredZip {
  zip_code: string;
  month: string;
  tilt: number;
  s_inv: number | null;
  s_dom: number | null;
  s_pend: number | null;
  active_listing_count: number | null;
  active_yy: number | null;
  median_dom: number | null;
  dom_yy: number | null;
  pending_ratio: number | null;
  pending_ratio_yy: number | null;
  new_listing_count: number | null;
  price_reduced_share: number | null;
  price_reduced_share_yy: number | null;
  median_listing_price: number | null;
  hotness_score: number | null;
  hotness_rank: number | null;
}

interface SuppressedZip {
  zip_code: string;
  month: string;
  reason: string;
  active_listing_count: number | null;
  hotness_score: number | null;
  hotness_rank: number | null;
}

interface MarketHeatData {
  latestMonth: string;
  scored: ScoredZip[];
  suppressed: SuppressedZip[];
  regionTilt: number;
  sInvMed: number | null;
  sDomMed: number | null;
  sPendMed: number | null;
  medianActiveYy: number | null;
  medianDomYy: number | null;
  medianPendingRatio: number | null;
  medianPendingRatioYy: number | null;
  medianPriceCutShare: number | null;
  medianPriceCutShareYy: number | null;
  falsifierWatchCount: number;
  regionTrend: RegionTrendPoint[];
}

// ── Pure stats ────────────────────────────────────────────────────────────────

function median(values: readonly (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export interface RegionTrendPoint {
  month: string;
  active: number | null;
  dom: number | null;
  pending: number | null;
}

/**
 * Region monthly trend — inverts the loaded `coreByZip` history to a month-keyed
 * series carrying the region MEDIAN across ZIPs of the three per-month core
 * signals. Real medians of held realtor.com values (null-safe via `median()`);
 * a month/metric with no non-null values yields null, never a fabricated number.
 * Sorted ascending; capped to the last `cap` months (default 36).
 */
export function regionMonthlyTrend(
  coreByZip: Map<string, Map<string, MarketHeatCoreRow>>,
  cap = 36,
): RegionTrendPoint[] {
  const byMonth = new Map<string, MarketHeatCoreRow[]>();
  for (const months of coreByZip.values()) {
    for (const [m, row] of months) {
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(row);
    }
  }
  const points = [...byMonth.keys()].sort().map((m) => {
    const rows = byMonth.get(m)!;
    return {
      month: m,
      active: median(rows.map((r) => r.active_listing_count)),
      dom: median(rows.map((r) => r.median_days_on_market)),
      pending: median(rows.map((r) => r.pending_ratio)),
    };
  });
  return points.slice(-cap);
}

// ── Module-level state (handoff corpusSummary → outputProducer) ───────────────

let lastData: MarketHeatData | null = null;
let lastFetchedAt: string | null = null;

// ── corpusSummary ─────────────────────────────────────────────────────────────

export function marketHeatCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  lastData = null;
  lastFetchedAt = allFragments[0]?.fetched_at ?? null;

  // Partition by source.
  const coreByZip = new Map<string, Map<string, MarketHeatCoreRow>>();
  const hotnessLatest = new Map<string, MarketHeatHotnessRow>();

  for (const f of allFragments) {
    if (f.source_id === "realtor_market_heat_core_swfl") {
      const r = f.normalized as MarketHeatCoreRow;
      if (!r.zip_code || !r.month) continue;
      if (!coreByZip.has(r.zip_code)) coreByZip.set(r.zip_code, new Map());
      coreByZip.get(r.zip_code)!.set(r.month, r);
    } else if (f.source_id === "realtor_market_heat_hotness_swfl") {
      const r = f.normalized as MarketHeatHotnessRow;
      if (!r.zip_code || !r.month) continue;
      const prev = hotnessLatest.get(r.zip_code);
      if (!prev || r.month > prev.month) hotnessLatest.set(r.zip_code, r);
    }
  }

  if (coreByZip.size === 0) return [];

  // Region-wide latest month (max across all core rows).
  let latestMonth = "";
  for (const months of coreByZip.values()) {
    for (const m of months.keys()) if (m > latestMonth) latestMonth = m;
  }

  const scored: ScoredZip[] = [];
  const suppressed: SuppressedZip[] = [];
  let falsifierWatchCount = 0;

  for (const [zip, months] of coreByZip.entries()) {
    const sortedMonths = [...months.keys()].sort();
    const latestKey = sortedMonths[sortedMonths.length - 1]!;
    const row = months.get(latestKey)!;
    const hot = hotnessLatest.get(zip);

    // realtor's own low-confidence flag → suppress (never invent a vote on it).
    if (row.quality_flag !== null && row.quality_flag !== 0) {
      suppressed.push({
        zip_code: zip,
        month: latestKey,
        reason: "quality_flag",
        active_listing_count: row.active_listing_count,
        hotness_score: hot?.hotness_score ?? null,
        hotness_rank: hot?.hotness_rank ?? null,
      });
      continue;
    }

    const tiltResult = computeZipTilt({
      invYy: row.active_listing_count_yy,
      domYy: row.median_days_on_market_yy,
      pendYy: row.pending_ratio_yy,
    });

    if (tiltResult === null) {
      suppressed.push({
        zip_code: zip,
        month: latestKey,
        reason: "insufficient_signals",
        active_listing_count: row.active_listing_count,
        hotness_score: hot?.hotness_score ?? null,
        hotness_rank: hot?.hotness_rank ?? null,
      });
      continue;
    }

    if (zipExhibitsFalsifier(sortedMonths.map((m) => months.get(m)!))) {
      falsifierWatchCount += 1;
    }

    scored.push({
      zip_code: zip,
      month: latestKey,
      tilt: tiltResult.tilt,
      s_inv: tiltResult.s_inv,
      s_dom: tiltResult.s_dom,
      s_pend: tiltResult.s_pend,
      active_listing_count: row.active_listing_count,
      active_yy: row.active_listing_count_yy,
      median_dom: row.median_days_on_market,
      dom_yy: row.median_days_on_market_yy,
      pending_ratio: row.pending_ratio,
      pending_ratio_yy: row.pending_ratio_yy,
      new_listing_count: row.new_listing_count,
      price_reduced_share: row.price_reduced_share,
      price_reduced_share_yy: row.price_reduced_share_yy,
      median_listing_price: row.median_listing_price,
      hotness_score: hot?.hotness_score ?? null,
      hotness_rank: hot?.hotness_rank ?? null,
    });
  }

  if (scored.length === 0) return [];

  const regionTilt = median(scored.map((z) => z.tilt)) ?? 0;

  lastData = {
    latestMonth,
    scored,
    suppressed,
    regionTilt,
    sInvMed: median(scored.map((z) => z.s_inv)),
    sDomMed: median(scored.map((z) => z.s_dom)),
    sPendMed: median(scored.map((z) => z.s_pend)),
    medianActiveYy: median(scored.map((z) => z.active_yy)),
    medianDomYy: median(scored.map((z) => z.dom_yy)),
    medianPendingRatio: median(scored.map((z) => z.pending_ratio)),
    medianPendingRatioYy: median(scored.map((z) => z.pending_ratio_yy)),
    medianPriceCutShare: median(scored.map((z) => z.price_reduced_share)),
    medianPriceCutShareYy: median(scored.map((z) => z.price_reduced_share_yy)),
    falsifierWatchCount,
    regionTrend: regionMonthlyTrend(coreByZip),
  };

  return [
    {
      topic: "market_heat_summary",
      fact: "realtor.com SWFL market-heat composite",
      value: `${scored.length} ZIPs scored (${suppressed.length} suppressed), SWFL median tilt = ${regionTilt.toFixed(2)} (display ${tiltToDisplayScore(regionTilt).toFixed(0)}/100), latest month = ${latestMonth}.`,
      source_fragment_ids: [],
    },
  ];
}

// ── outputProducer ────────────────────────────────────────────────────────────

// Convert a fractional value (0.20) to the 0–100 percent scale the renderer
// expects (display_format:"percent" prints `${v}%` with no ×100). null-safe.
function pct(frac: number | null): number {
  return frac === null ? 0 : Math.round(frac * 1000) / 10;
}

const dirOfYy = (yy: number | null): "rising" | "falling" | "stable" =>
  yy === null || Math.abs(yy) < 1e-9 ? "stable" : yy > 0 ? "rising" : "falling";

export function marketHeatOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const data = lastData;
  const fetched_at = lastFetchedAt ?? new Date().toISOString();

  if (!data || data.scored.length === 0) {
    return {
      conclusion: "market-heat-swfl: no scored ZIPs available for this build.",
      key_metrics: [],
      caveats: [
        "Zero ZIPs scored. Verify market_heat_core_swfl.parquet + market_heat_hotness_swfl.parquet are populated in s3://lake-tier1/market/ and that the latest month carries the _yy deltas.",
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
    url: "https://www.realtor.com/research/data/",
    fetched_at,
    tier: 3,
    citation:
      "Data provided by Realtor.com — Economic Research Data Library (ZIP-grain Core Inventory + Market Hotness, monthly). Attribution-only license. Hotness is a relative cross-sectional rank, not the vote driver.",
  };

  const direction = regionDirection(data.regionTilt, data.sInvMed, data.sDomMed, data.sPendMed);
  const magnitude = Math.min(Math.abs(data.regionTilt), 1);
  const displayScore = Math.round(tiltToDisplayScore(data.regionTilt) * 10) / 10;

  const tiltDir: "rising" | "falling" | "stable" =
    data.regionTilt > 0.1 ? "rising" : data.regionTilt < -0.1 ? "falling" : "stable";

  // ── 5 key_metrics (region medians). Vote math is on raw fractions; percent
  //    metrics are converted to the 0–100 scale the renderer expects. ─────────
  const key_metrics: BrainOutputMetric[] = [
    {
      metric: "market_heat_tilt_swfl",
      value: displayScore,
      direction: tiltDir,
      label: `SWFL market-heat tilt (0-100, 50 = balanced; >50 = tightening/seller-favoring) at ${data.latestMonth} — ${data.scored.length} ZIPs scored`,
      variable_type: "intensive",
      units: "score (0-100)",
      display_format: "raw",
      source,
    },
    {
      metric: "market_heat_inventory_yy_swfl",
      value: pct(data.medianActiveYy),
      direction: dirOfYy(data.medianActiveYy),
      label:
        "SWFL median active-listing count, year-over-year change — the lead tightening signal (falling = bullish)",
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source,
    },
    {
      metric: "market_heat_dom_yy_swfl",
      value: pct(data.medianDomYy),
      direction: dirOfYy(data.medianDomYy),
      label:
        "SWFL median days-on-market, year-over-year change (falling = homes selling faster = bullish)",
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source,
    },
    {
      metric: "market_heat_pending_ratio_swfl",
      value: Math.round((data.medianPendingRatio ?? 0) * 1000) / 1000,
      direction: dirOfYy(data.medianPendingRatioYy),
      label:
        "SWFL median pending ratio (pending ÷ active listings) — the leading demand edge (rising = bullish)",
      variable_type: "intensive",
      units: "ratio",
      display_format: "ratio",
      source,
    },
    {
      metric: "market_heat_price_cut_share_swfl",
      value: pct(data.medianPriceCutShare),
      direction: dirOfYy(data.medianPriceCutShareYy),
      label:
        "SWFL median share of active listings with a price reduction — coincident context (rising = softening)",
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source,
    },
  ];

  // ── Per-ZIP detail table ─────────────────────────────────────────────────
  const sorted = [...data.scored].sort((a, b) => b.tilt - a.tilt);
  const detailRows: BrainOutputDetailRow[] = [
    ...sorted.map((z) => ({
      key: z.zip_code,
      label: z.zip_code,
      cells: {
        market_heat_score: Math.round(tiltToDisplayScore(z.tilt) * 10) / 10,
        active_listing_count: z.active_listing_count,
        inventory_yy: pct(z.active_yy),
        median_dom: z.median_dom,
        dom_yy: pct(z.dom_yy),
        pending_ratio: z.pending_ratio,
        pending_ratio_yy: pct(z.pending_ratio_yy),
        new_listing_count: z.new_listing_count,
        price_reduced_share: pct(z.price_reduced_share),
        hotness_score: z.hotness_score, // RELATIVE descriptor
        hotness_rank: z.hotness_rank, // RELATIVE descriptor
        month: z.month,
        suppressed_reason: null,
      },
    })),
    ...data.suppressed.map((z) => ({
      key: z.zip_code,
      label: z.zip_code,
      cells: {
        market_heat_score: null,
        active_listing_count: z.active_listing_count,
        inventory_yy: null,
        median_dom: null,
        dom_yy: null,
        pending_ratio: null,
        pending_ratio_yy: null,
        new_listing_count: null,
        price_reduced_share: null,
        hotness_score: z.hotness_score,
        hotness_rank: z.hotness_rank,
        month: z.month,
        suppressed_reason: z.reason,
      },
    })),
  ];

  const detail_tables: BrainOutputDetailTable[] = [
    {
      id: "market_heat_by_zip",
      title: `SWFL market heat by ZIP — ${data.latestMonth} (realtor.com list-side metrics)`,
      grain: "zip",
      columns: [
        {
          id: "market_heat_score",
          label: "Heat Tilt (0-100)",
          display_format: "raw",
          units: "score",
        },
        {
          id: "active_listing_count",
          label: "Active Listings",
          display_format: "count",
          units: "listings",
        },
        { id: "inventory_yy", label: "Inventory Y/Y", display_format: "percent", units: "%" },
        { id: "median_dom", label: "Median DOM", display_format: "count", units: "days" },
        { id: "dom_yy", label: "DOM Y/Y", display_format: "percent", units: "%" },
        { id: "pending_ratio", label: "Pending Ratio", display_format: "ratio", units: "ratio" },
        {
          id: "pending_ratio_yy",
          label: "Pending Ratio Y/Y",
          display_format: "percent",
          units: "%",
        },
        {
          id: "new_listing_count",
          label: "New Listings",
          display_format: "count",
          units: "listings",
        },
        {
          id: "price_reduced_share",
          label: "Price-Cut Share",
          display_format: "percent",
          units: "%",
        },
        { id: "hotness_score", label: "Hotness (relative)", display_format: "raw", units: "score" },
        {
          id: "hotness_rank",
          label: "Hotness Rank (relative)",
          display_format: "count",
          units: "rank",
        },
        { id: "month", label: "Month" },
        { id: "suppressed_reason", label: "Suppressed" },
      ],
      rows: detailRows,
      source,
    },
    ...(data.regionTrend.length
      ? [
          {
            id: "market_heat_region_trend",
            title: "SWFL market heat — region monthly trend (realtor.com core inventory)",
            grain: "region-month",
            columns: [
              { id: "month", label: "Month" },
              {
                id: "region_median_active_listings",
                label: "Median Active Listings",
                display_format: "count",
                units: "listings",
              },
              {
                id: "region_median_dom",
                label: "Median DOM",
                display_format: "count",
                units: "days",
              },
              {
                id: "region_median_pending_ratio",
                label: "Median Pending Ratio",
                display_format: "ratio",
                units: "ratio",
              },
            ],
            rows: data.regionTrend.map((p) => ({
              key: p.month,
              label: p.month,
              cells: {
                month: p.month,
                region_median_active_listings: p.active,
                region_median_dom: p.dom,
                region_median_pending_ratio: p.pending,
              },
            })),
            source,
          } as BrainOutputDetailTable,
        ]
      : []),
  ];

  // ── Caveats ──────────────────────────────────────────────────────────────
  const caveats = [
    "List-side only — these are active-listing metrics; there are no closed/sold prices in this source. Sold-price reads come from the ATTOM lane.",
    "Hotness is a cross-sectional national rank, not an absolute cycle gauge — a SWFL ZIP can rank hot nationally while cooling locally. The directional call is driven by inventory/DOM/pending year-over-year, not by Hotness.",
    "~50% of SWFL transactions are all-cash (Lee County, ATTOM 2024) — national rate-sensitive thresholds are muted; read the YoY tightening, not absolute DOM cutoffs.",
    "Hurricane Ian (Sept 2022) is a labeled event — inventory/DOM dislocations Oct 2022–Mar 2023 are forced, not organic demand.",
    "Data provided by Realtor.com.",
  ];
  if (data.suppressed.length > 0) {
    caveats.push(
      `${data.suppressed.length} ZIP${data.suppressed.length > 1 ? "s" : ""} suppressed (insufficient signals or realtor quality_flag).`,
    );
  }
  if (data.falsifierWatchCount > 0) {
    caveats.push(
      `Falsifier watch: ${data.falsifierWatchCount} scored ZIP${data.falsifierWatchCount > 1 ? "s" : ""} currently show the bearish pattern (pending ratio falling 2+ months while inventory rises).`,
    );
  }

  // ── Conclusion (+ the [INFERENCE] forward thesis & falsifier) ────────────
  const topTight = sorted
    .slice(0, 3)
    .map((z) => `${z.zip_code} (${tiltToDisplayScore(z.tilt).toFixed(0)})`)
    .join(", ");
  const invPct = pct(data.medianActiveYy);
  const domPct = pct(data.medianDomYy);

  const headline =
    direction === "bullish"
      ? `SWFL market heat is tightening (bullish) at ${displayScore.toFixed(0)}/100. Inventory ${invPct <= 0 ? "down" : "up"} ${Math.abs(invPct).toFixed(1)}% Y/Y, DOM ${domPct <= 0 ? "down" : "up"} ${Math.abs(domPct).toFixed(1)}% Y/Y across ${data.scored.length} ZIPs. Tightest: ${topTight}.`
      : direction === "bearish"
        ? `SWFL market heat is loosening (bearish) at ${displayScore.toFixed(0)}/100. Inventory ${invPct >= 0 ? "up" : "down"} ${Math.abs(invPct).toFixed(1)}% Y/Y, DOM ${domPct >= 0 ? "up" : "down"} ${Math.abs(domPct).toFixed(1)}% Y/Y across ${data.scored.length} ZIPs.`
        : direction === "mixed"
          ? `SWFL market heat is mixed at ${displayScore.toFixed(0)}/100 — the tightening signals (inventory, DOM, pending) disagree across ${data.scored.length} ZIPs.`
          : `SWFL market heat is balanced (neutral) at ${displayScore.toFixed(0)}/100. Inventory, DOM, and pending ratio are tracking near year-ago levels across ${data.scored.length} ZIPs.`;

  const forward = ` [INFERENCE] Forward read anchors on the pending ratio (median ${(data.medianPendingRatio ?? 0).toFixed(2)}), the leading demand edge: a sustained rise points to firming prices. Falsified if the pending ratio falls for 2+ consecutive months while active inventory rises.`;

  return {
    conclusion: headline + forward,
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

export const marketHeatSwfl: PackDefinition = {
  id: BRAIN_ID,
  brain_id: BRAIN_ID,
  public_label: "Market Heat",
  domain: "real-estate",
  scope:
    "SWFL market-heat directional call per ZIP from realtor.com's free public-S3 market aggregates (Core Inventory + Market Hotness, monthly, ZIP grain). The vote is driven by absolute year-over-year time-series — active-listing count (falling = bullish), median days-on-market (falling = bullish), and pending ratio (rising = bullish) — so market tightening reads bullish. Market Hotness is used as a RELATIVE cross-sectional descriptor only, never the vote driver. List-side only: no closed/sold prices. All math deterministic; no LLM synthesis.",
  ttl_seconds: 35 * 24 * 60 * 60, // 35 days — realtor.com restates monthly (~first week)

  sources: [marketHeatCoreSource, marketHeatHotnessSource],
  input_brains: [],

  fitScore: () => 8,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: marketHeatCorpusSummary,
  outputProducer: marketHeatOutputProducer,

  preferences: [
    "Answer market-heat questions at ZIP grain using the detail_table. Do not invent a tilt for a suppressed ZIP.",
    "The pending ratio is the LEADING demand signal — lead with it when explaining direction.",
    "Hotness is a RELATIVE rank (a SWFL ZIP can rank hot nationally while cooling locally). Never read it as the directional call.",
    "This is list-side data — never imply a sold/closed price from it.",
  ],

  activeProject:
    "market-heat-swfl: deterministic ZIP-grain market-tightening call from realtor.com Core + Hotness Tier-1 parquets.",

  prompts: {
    triageContext:
      "Market-heat fragments from two realtor.com Tier-1 parquets (Core Inventory Metrics + Market Hotness, ZIP × month). Join on (zip_code, month) is done in TypeScript corpusSummary.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent=true). All math is deterministic: sign+magnitude normalization of the _yy deltas, per-ZIP tilt, region median, 0-100 display rescale.",
  },
};
