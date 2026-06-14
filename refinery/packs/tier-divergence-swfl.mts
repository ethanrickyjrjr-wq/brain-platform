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
  tierDivergenceZipLatestSource,
  type TierDivergenceZipLatestRow,
} from "../sources/tier-divergence-zip-latest-source.mts";
import { env } from "../config/env.mts";

const BRAIN_ID = "tier-divergence-swfl";

// ── Scoring constants ────────────────────────────────────────────────────────
// DEADBAND = the widening-vs-compressing dead zone on the regional-median YoY
// signals, in percentage points. PROVISIONAL v1 (see SOURCED.md#tier-divergence-swfl-deadband —
// recalibrate to ~1 SD of tier_spread_yoy_pct across both-tier SWFL ZIPs over a baseline
// that EXCLUDES the 2020-2021 COVID boom, at the graduation gate / first live cycle). K-shape
// breakpoints are at 0 (natural — luxury non-negative AND starter negative), so
// they need no citation.
const DEADBAND = 1.0;
const TOP_N = 3;

const CAVEAT_RAW_NSA =
  "Zillow publishes the top/bottom ZHVI tiers RAW only (no seasonally-adjusted variant); " +
  "the spread LEVEL is a 3-month trailing average to tame that noise, while the YoY signals " +
  "use raw monthly values (YoY already cancels seasonality).";
const CAVEAT_CASH_BUYERS =
  "~50% of SWFL buyers (≈70% for condos) pay cash and insulate the luxury tier — a holding or " +
  "rising top tier is part of the K-shape, not a bullish signal on its own.";

// ── Domain types ─────────────────────────────────────────────────────────────

interface TierZipSnapshot {
  zip_code: string;
  metro: string | null;
  county_name: string | null;
  city: string | null;
  latest_period: string;
  top_tier_value_latest: number;
  bottom_tier_value_latest: number;
  top_tier_value_3m_avg: number;
  bottom_tier_value_3m_avg: number;
  /** 3m-avg top / 3m-avg bottom (smoothed level). */
  tier_spread_ratio: number;
  tier_spread_yoy_pct: number | null;
  bottom_tier_yoy_pct: number | null;
  top_tier_yoy_pct: number | null;
  /** Per-ZIP K-shape: luxury holding (≥0) while starter falls (<0). */
  kshape: boolean;
  /** Top-tier YoY % as of 1 month prior (T-1mo vs T-13mo). Null when either anchor absent. */
  top_tier_yoy_prior_month_pct: number | null;
  /** Bottom-tier YoY % as of 1 month prior (T-1mo vs T-13mo). Null when either anchor absent. */
  bottom_tier_yoy_prior_month_pct: number | null;
  /** K-shape as of 1 month prior — used to derive MoM direction of the intensity score. */
  kshape_prior_month: boolean;
}

interface RegionalSnapshot {
  zips: TierZipSnapshot[];
  regional_latest_period: string;
  median_spread_ratio: number;
  median_spread_yoy_pct: number | null;
  median_bottom_yoy_pct: number | null;
  median_top_yoy_pct: number | null;
  kshape_zip_count: number;
  kshape_prior_month_zip_count: number;
  zips_covered: number;
  zips_with_yoy: number;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function medianOrNull(values: readonly (number | null)[]): number | null {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return finite.length > 0 ? median(finite) : null;
}

function isKshape(top_yoy: number | null, bottom_yoy: number | null): boolean {
  return (
    top_yoy !== null &&
    bottom_yoy !== null &&
    Number.isFinite(top_yoy) &&
    Number.isFinite(bottom_yoy) &&
    top_yoy >= 0 &&
    bottom_yoy < 0
  );
}

function buildSnapshotFromViewRows(rows: TierDivergenceZipLatestRow[]): RegionalSnapshot | null {
  if (rows.length === 0) return null;

  const zips: TierZipSnapshot[] = rows.map((v) => ({
    zip_code: v.zip_code,
    metro: v.metro,
    county_name: v.county_name,
    city: v.city,
    latest_period: v.latest_period,
    top_tier_value_latest: v.top_tier_value_latest,
    bottom_tier_value_latest: v.bottom_tier_value_latest,
    top_tier_value_3m_avg: v.top_tier_value_3m_avg,
    bottom_tier_value_3m_avg: v.bottom_tier_value_3m_avg,
    tier_spread_ratio: v.tier_spread_ratio,
    tier_spread_yoy_pct: v.tier_spread_yoy_pct,
    bottom_tier_yoy_pct: v.bottom_tier_yoy_pct,
    top_tier_yoy_pct: v.top_tier_yoy_pct,
    kshape: isKshape(v.top_tier_yoy_pct, v.bottom_tier_yoy_pct),
    top_tier_yoy_prior_month_pct: v.top_tier_yoy_prior_month_pct,
    bottom_tier_yoy_prior_month_pct: v.bottom_tier_yoy_prior_month_pct,
    kshape_prior_month: isKshape(v.top_tier_yoy_prior_month_pct, v.bottom_tier_yoy_prior_month_pct),
  }));

  zips.sort((a, b) => (a.zip_code < b.zip_code ? -1 : a.zip_code > b.zip_code ? 1 : 0));
  const regional_latest_period = zips
    .map((z) => z.latest_period)
    .sort()
    .reverse()[0];

  const spreadYoys = zips.map((z) => z.tier_spread_yoy_pct);

  return {
    zips,
    regional_latest_period,
    median_spread_ratio: median(zips.map((z) => z.tier_spread_ratio)),
    median_spread_yoy_pct: medianOrNull(spreadYoys),
    median_bottom_yoy_pct: medianOrNull(zips.map((z) => z.bottom_tier_yoy_pct)),
    median_top_yoy_pct: medianOrNull(zips.map((z) => z.top_tier_yoy_pct)),
    kshape_zip_count: zips.filter((z) => z.kshape).length,
    kshape_prior_month_zip_count: zips.filter((z) => z.kshape_prior_month).length,
    zips_covered: zips.length,
    zips_with_yoy: spreadYoys.filter((y) => y !== null && Number.isFinite(y)).length,
  };
}

// ── Polarity classifier (POLARITY AUDIT — top-tier rise casts NO bullish vote) ─

interface PolarityVerdict {
  direction: BrainOutputDirection;
  caveats: string[];
  magnitude: number;
}

export function classifyPolarity(
  median_spread_yoy_pct: number | null,
  median_bottom_yoy_pct: number | null,
): PolarityVerdict {
  if (median_spread_yoy_pct === null && median_bottom_yoy_pct === null) {
    return {
      direction: "neutral",
      caveats: ["No ZIP has a full 12-month look-back yet — divergence direction undefined."],
      magnitude: 0,
    };
  }
  const spread = median_spread_yoy_pct ?? 0;
  const bottom = median_bottom_yoy_pct ?? 0;
  const magnitude = Math.min(Math.abs(spread) / 10, 1);

  // BEARISH: spread widening past the deadband, OR the starter tier falling.
  if (spread > DEADBAND || bottom < -DEADBAND) {
    return {
      direction: "bearish",
      caveats: [
        "Tier spread widening / starter tier softening — the entry market is fracturing relative to luxury.",
      ],
      magnitude,
    };
  }
  // BULLISH: spread compressing AND the starter tier rising (the fracture healing).
  if (spread < -DEADBAND && bottom > DEADBAND) {
    return { direction: "bullish", caveats: [], magnitude };
  }
  // Top-tier movement deliberately does NOT enter the verdict.
  return { direction: "neutral", caveats: [], magnitude };
}

// ── Module-level state for corpusSummary -> outputProducer handoff ───────────

let lastSnapshot: RegionalSnapshot | null = null;
let lastFetchedAt: string | null = null;

function rowsFromFragments(fragments: RawFragment[]): TierDivergenceZipLatestRow[] {
  return fragments
    .map((f) => f.normalized as unknown as TierDivergenceZipLatestRow)
    .filter((r): r is TierDivergenceZipLatestRow => !!r && typeof r === "object");
}

function tierDivergenceCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  lastSnapshot = null;
  lastFetchedAt = null;

  const rows = rowsFromFragments(allFragments);
  if (rows.length === 0) return [];

  const snap = buildSnapshotFromViewRows(rows);
  if (!snap) return [];

  lastSnapshot = snap;
  lastFetchedAt = allFragments[0]?.fetched_at ?? new Date().toISOString();

  const syoy =
    snap.median_spread_yoy_pct === null ? "n/a" : `${snap.median_spread_yoy_pct.toFixed(2)}%`;
  return [
    {
      topic: "corpus_overview",
      fact: "Zillow ZHVI tier-divergence SWFL corpus",
      value: `${snap.zips_covered} both-tier ZIPs through ${snap.regional_latest_period}. Median spread (luxury/starter) = ${snap.median_spread_ratio.toFixed(2)}x, median spread YoY = ${syoy}, ${snap.kshape_zip_count} ZIPs in K-shape.`,
      source_fragment_ids: [],
    },
  ];
}

// ── outputProducer ──────────────────────────────────────────────────────────

function buildSourceMeta(fetched_at: string): BrainOutputMetricSource {
  const citation =
    env.source === "fixture"
      ? "Zillow ZHVI tier split — top vs bottom latest-per-ZIP (fixture: tier-divergence-zip-latest.sample.json)."
      : "Zillow ZHVI tier split, ZIP-level all-homes: top-tier (0.67-1.0, luxury) vs bottom-tier (0.0-0.33, starter), RAW (not seasonally adjusted). Source: Zillow Research (files.zillowstatic.com); Tier 2 cache: data_lake.tier_divergence_zip_latest.";
  return {
    url: "https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.67_1.0_month.csv",
    fetched_at,
    tier: 3,
    citation,
  };
}

function metricDirection(delta: number | null): "rising" | "falling" | "stable" {
  if (delta === null) return "stable";
  if (delta > 0.1) return "rising";
  if (delta < -0.1) return "falling";
  return "stable";
}

function fmtPct(v: number | null): string {
  return v === null ? "n/a" : `${v.toFixed(2)}%`;
}

function tierDivergenceOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snap = lastSnapshot;
  const fetched_at = lastFetchedAt ?? new Date().toISOString();

  if (!snap) {
    return {
      conclusion: "tier-divergence-swfl could not load any Zillow ZHVI tier rows this build.",
      key_metrics: [],
      caveats: [
        "Zero rows from the tier-divergence view. Verify ingest ran + data_lake.tier_divergence_zip_latest has rows.",
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
  const verdict = classifyPolarity(snap.median_spread_yoy_pct, snap.median_bottom_yoy_pct);

  // Widest fractures = ZIPs whose spread is widening fastest (highest spread YoY).
  const ranked = snap.zips
    .filter((z) => z.tier_spread_yoy_pct !== null && Number.isFinite(z.tier_spread_yoy_pct))
    .sort((a, b) => (b.tier_spread_yoy_pct ?? 0) - (a.tier_spread_yoy_pct ?? 0));
  const widest = ranked.slice(0, TOP_N);

  const key_metrics: BrainOutputMetric[] = [];

  // 1. Regional median spread YoY — the headline polarity driver.
  key_metrics.push({
    metric: "tier_spread_yoy_pct_swfl",
    value:
      snap.median_spread_yoy_pct === null ? "n/a" : Number(snap.median_spread_yoy_pct.toFixed(2)),
    direction: metricDirection(snap.median_spread_yoy_pct),
    label: "SWFL regional median luxury/starter spread YoY % (widening = entry market fracturing)",
    variable_type: snap.median_spread_yoy_pct === null ? "categorical" : "intensive",
    ...(snap.median_spread_yoy_pct === null
      ? {}
      : { units: "percent", display_format: "percent" as const }),
    source,
  });

  // 2. Regional median spread ratio (luxury / starter, ×).
  key_metrics.push({
    metric: "tier_spread_ratio_swfl",
    value: Number(snap.median_spread_ratio.toFixed(2)),
    direction: "stable",
    label: `SWFL regional median tier spread (luxury ÷ starter, ×) at ${snap.regional_latest_period}`,
    variable_type: "intensive",
    units: "ratio",
    source,
  });

  // 3. Regional median bottom (starter) tier YoY — bearish driver when negative.
  key_metrics.push({
    metric: "tier_bottom_yoy_pct_swfl",
    value:
      snap.median_bottom_yoy_pct === null ? "n/a" : Number(snap.median_bottom_yoy_pct.toFixed(2)),
    direction: metricDirection(snap.median_bottom_yoy_pct),
    label: "SWFL regional median starter-tier (bottom) ZHVI YoY %",
    variable_type: snap.median_bottom_yoy_pct === null ? "categorical" : "intensive",
    ...(snap.median_bottom_yoy_pct === null
      ? {}
      : { units: "percent", display_format: "percent" as const }),
    source,
  });

  // 4. Regional median top (luxury) tier YoY — INFORMATIONAL ONLY (no polarity vote).
  key_metrics.push({
    metric: "tier_top_yoy_pct_swfl",
    value: snap.median_top_yoy_pct === null ? "n/a" : Number(snap.median_top_yoy_pct.toFixed(2)),
    direction: metricDirection(snap.median_top_yoy_pct),
    label:
      "SWFL regional median luxury-tier (top) ZHVI YoY % (context; not a standalone bull signal)",
    variable_type: snap.median_top_yoy_pct === null ? "categorical" : "intensive",
    ...(snap.median_top_yoy_pct === null
      ? {}
      : { units: "percent", display_format: "percent" as const }),
    source,
  });

  // 5. Count of ZIPs in K-shape (luxury holding, starter falling).
  key_metrics.push({
    metric: "tier_kshape_zip_count_swfl",
    value: snap.kshape_zip_count,
    direction: "stable",
    label: `SWFL ZIPs in K-shape (luxury ≥0 YoY, starter <0 YoY) of ${snap.zips_covered} both-tier ZIPs`,
    variable_type: "extensive",
    units: "count",
    display_format: "count",
    source,
  });

  // 5b. K-shape intensity — normalized 0–100 score (% of both-tier ZIPs in K-shape).
  // Direction derived from MoM delta: prior-month K-shape count uses the same ±7d
  // window logic as the YoY columns (T-1mo vs T-13mo anchors, added to view B).
  const kshapeIntensity =
    snap.zips_covered > 0 ? Math.round((snap.kshape_zip_count / snap.zips_covered) * 100) : 0;
  const kshapePriorIntensity =
    snap.zips_covered > 0
      ? Math.round((snap.kshape_prior_month_zip_count / snap.zips_covered) * 100)
      : 0;
  const kshapeDirection: "rising" | "falling" | "stable" =
    kshapeIntensity > kshapePriorIntensity
      ? "rising"
      : kshapeIntensity < kshapePriorIntensity
        ? "falling"
        : "stable";
  key_metrics.push({
    metric: "tier_kshape_intensity_swfl",
    value: kshapeIntensity,
    direction: kshapeDirection,
    label: `K-shape intensity: ${snap.kshape_zip_count} of ${snap.zips_covered} SWFL both-tier ZIPs with luxury holding, starter falling (${kshapeIntensity}/100)`,
    variable_type: "intensive",
    units: "percent",
    display_format: "percent",
    source,
  });

  // 6. Per-ZIP widest fractures — resolved through the patterns hook (raw_slug_patterns).
  for (const z of widest) {
    if (z.tier_spread_yoy_pct === null) continue;
    key_metrics.push({
      metric: `tier_spread_yoy_pct_zip_${z.zip_code}`,
      value: Number(z.tier_spread_yoy_pct.toFixed(2)),
      direction: metricDirection(z.tier_spread_yoy_pct),
      label: `Tier spread YoY % - ZIP ${z.zip_code}${z.city ? " (" + z.city + ")" : ""}, ${z.latest_period}`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source,
    });
    key_metrics.push({
      metric: `tier_spread_ratio_zip_${z.zip_code}`,
      value: Number(z.tier_spread_ratio.toFixed(2)),
      direction: "stable",
      label: `Tier spread (luxury ÷ starter, ×) - ZIP ${z.zip_code}${z.city ? " (" + z.city + ")" : ""}, ${z.latest_period}`,
      variable_type: "intensive",
      units: "ratio",
      source,
    });
  }

  // ── Caveats ──
  const caveats: string[] = [...verdict.caveats, CAVEAT_RAW_NSA, CAVEAT_CASH_BUYERS];
  caveats.push(
    `Covers ${snap.zips_covered} SWFL ZIPs holding BOTH a starter and a luxury tier; ZIPs lacking one tier are excluded from the divergence.`,
  );
  if (snap.zips_with_yoy < snap.zips_covered) {
    const missing = snap.zips_covered - snap.zips_with_yoy;
    caveats.push(
      `${missing} of ${snap.zips_covered} ZIPs lack a 12-month look-back; YoY medians exclude them.`,
    );
  }
  if (snap.zips_covered < 10) {
    caveats.push(
      `Only ${snap.zips_covered} both-tier SWFL ZIPs this build — regional medians are thin.`,
    );
  }

  // ── Conclusion prose ──
  const widestList =
    widest
      .map(
        (z) =>
          `${z.zip_code} (${fmtPct(z.tier_spread_yoy_pct)}, ${z.tier_spread_ratio.toFixed(1)}x)`,
      )
      .join(", ") || "none";
  const conclusion = [
    `SWFL price tiers read ${verdict.direction} at ${snap.regional_latest_period} — luxury ${fmtPct(snap.median_top_yoy_pct)} YoY vs starter ${fmtPct(snap.median_bottom_yoy_pct)} YoY, a median spread of ${snap.median_spread_ratio.toFixed(2)}x moving ${fmtPct(snap.median_spread_yoy_pct)} YoY.`,
    `${snap.kshape_zip_count} of ${snap.zips_covered} ZIPs are in a K-shape (luxury holding, starter falling). Widest fractures: ${widestList}.`,
  ].join(" ");

  // ── Per-ZIP detail table ──
  const zipDetailRows = snap.zips.map((z) => ({
    key: z.zip_code,
    label: z.zip_code,
    cells: {
      metro: z.metro ?? null,
      county_name: z.county_name ?? null,
      city: z.city ?? null,
      latest_period: z.latest_period,
      top_tier_value: Number(z.top_tier_value_latest.toFixed(0)),
      bottom_tier_value: Number(z.bottom_tier_value_latest.toFixed(0)),
      spread_ratio: Number(z.tier_spread_ratio.toFixed(2)),
      spread_yoy_pct:
        z.tier_spread_yoy_pct === null || !Number.isFinite(z.tier_spread_yoy_pct)
          ? null
          : Number(z.tier_spread_yoy_pct.toFixed(2)),
      bottom_yoy_pct:
        z.bottom_tier_yoy_pct === null || !Number.isFinite(z.bottom_tier_yoy_pct)
          ? null
          : Number(z.bottom_tier_yoy_pct.toFixed(2)),
      top_yoy_pct:
        z.top_tier_yoy_pct === null || !Number.isFinite(z.top_tier_yoy_pct)
          ? null
          : Number(z.top_tier_yoy_pct.toFixed(2)),
      kshape: z.kshape,
    } as Record<string, number | string | boolean | null>,
  }));

  return {
    conclusion,
    key_metrics,
    caveats,
    direction: verdict.direction,
    magnitude: verdict.magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    detail_tables:
      zipDetailRows.length > 0
        ? [
            {
              id: "tier_divergence_by_zip",
              title: `SWFL luxury/starter tier divergence by ZIP — latest period ${snap.regional_latest_period}`,
              grain: "zip",
              columns: [
                { id: "metro", label: "Metro area" },
                { id: "county_name", label: "County" },
                { id: "city", label: "City" },
                { id: "latest_period", label: "Latest period" },
                {
                  id: "top_tier_value",
                  label: "Luxury value (USD)",
                  display_format: "currency" as const,
                  units: "USD",
                },
                {
                  id: "bottom_tier_value",
                  label: "Starter value (USD)",
                  display_format: "currency" as const,
                  units: "USD",
                },
                { id: "spread_ratio", label: "Spread (luxury÷starter)", units: "ratio" },
                {
                  id: "spread_yoy_pct",
                  label: "Spread YoY %",
                  display_format: "percent" as const,
                  units: "percent",
                },
                {
                  id: "bottom_yoy_pct",
                  label: "Starter YoY %",
                  display_format: "percent" as const,
                  units: "percent",
                },
                {
                  id: "top_yoy_pct",
                  label: "Luxury YoY %",
                  display_format: "percent" as const,
                  units: "percent",
                },
                { id: "kshape", label: "K-shape" },
              ],
              rows: zipDetailRows,
              source,
              note: "One row per SWFL ZIP holding both a starter (0.0-0.33) and luxury (0.67-1.0) Zillow ZHVI tier. Spread ratio = 3-month-trailing-average luxury value ÷ 3-month-trailing-average starter value; the YoY columns are raw monthly and null when a 12-month look-back is unavailable. RAW (not seasonally adjusted) index — read YoY, not the level, for direction. top_tier_value / bottom_tier_value are the raw latest month.",
            },
          ]
        : undefined,
  };
}

// ── Pack definition ─────────────────────────────────────────────────────────

export const tierDivergenceSwfl: PackDefinition = {
  id: BRAIN_ID,
  brain_id: BRAIN_ID,
  public_label: "Tier Divergence",
  domain: "real-estate",
  scope:
    "SWFL ZIP-level luxury-vs-starter price divergence (Zillow ZHVI top-tier 0.67-1.0 vs bottom-tier 0.0-0.33), monthly — the K-shaped market signal: regional median spread + spread YoY (widening = entry market fracturing), per-tier YoY, count of ZIPs in K-shape, and per-ZIP detail. RAW index; YoY-based. Standalone leaf.",
  ttl_seconds: 86400 * 35, // monthly cadence + one publish-cycle of slack
  sources: [tierDivergenceZipLatestSource],
  input_brains: [],
  fitScore: () => 10,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: tierDivergenceCorpusSummary,
  outputProducer: tierDivergenceOutputProducer,
  preferences: [
    "The headline is the luxury-vs-starter divergence: a widening spread with a falling starter tier is bearish for the entry market; a rising luxury tier is NOT a bullish signal on its own (cash insulates the top).",
    "YoY is the read, not raw price levels — the tier index is not seasonally adjusted.",
    "The K-shape count and the widest-fracture ZIPs are the operational cuts to surface in the conclusion.",
  ],
  activeProject:
    "tier-divergence-swfl: track the K-shaped split between SWFL's luxury and starter price tiers as the segment axis complementing seller-stress's churn axis.",
  prompts: {
    triageContext:
      "A tier row is decision-relevant when the ZIP carries both a starter and luxury ZHVI tier in a tracked SWFL MSA. The pack runs deterministically — no LLM triage is invoked.",
    synthesisContext:
      "Produce a luxury-vs-starter divergence read using the locked polarity table: spread widening or starter falling = bearish; never treat a rising luxury tier as bullish. Quote the K-shape count and widest-fracture ZIPs. Never infer absolute price levels from this RAW index.",
  },
};
