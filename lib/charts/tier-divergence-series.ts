import type { ChartRow } from "@/types/viz";

/**
 * Raw row from data_lake.tier_divergence_pivoted (only the columns the chart
 * selects). One row per month; `median_top_tier` / `median_bottom_tier` are the
 * regional median of each tier's raw ZHVI for that month. Either can be null for
 * a month with no both-tier ZIPs (defensive — in practice all 363 months carry
 * 107 ZIPs).
 */
export interface TierPivotedRow {
  month: string; // "YYYY-MM"
  median_top_tier: number | null;
  median_bottom_tier: number | null;
}

export interface TierIndexedSeries {
  /** Chart-ready rows, oldest → newest: { month, luxury_index, starter_index }. */
  entries: ChartRow[];
  /** Latest covered month ("YYYY-MM"), or undefined when nothing is renderable. */
  asOf?: string;
  /** The month both tiers were rebased to 100 (2019-01, or first available). */
  baseMonth: string;
}

/** Preferred rebase anchor — first January with both tiers (pre-COVID/pre-rate-shock). */
const BASE_MONTH = "2019-01";

/**
 * Maps monthly tier medians to two indexed lines, each rebased to 100 at a common
 * base month so the chart shows RELATIVE appreciation (luxury vs. starter) rather
 * than absolute dollars. Indexing can't mislead by magnitude — a reader sees the
 * gap between the lines, which is exactly the luxury/starter divergence signal.
 *
 * Base month is 2019-01 when present, else the first available month (so a future
 * re-cut of the view that starts later still renders). Rows missing either tier
 * are dropped; an empty/null input degrades to an empty chart instead of throwing.
 * Values round to 1dp (formatChartValue("index") then displays a whole number).
 */
export function mapTierIndexed(rows: TierPivotedRow[] | null | undefined): TierIndexedSeries {
  if (!rows || rows.length === 0) return { entries: [], baseMonth: BASE_MONTH };

  const sorted = rows
    .filter(
      (r): r is TierPivotedRow & { median_top_tier: number; median_bottom_tier: number } =>
        r.median_top_tier != null && r.median_bottom_tier != null && !!r.month,
    )
    .sort((a, b) => a.month.localeCompare(b.month));

  if (sorted.length === 0) return { entries: [], baseMonth: BASE_MONTH };

  // Prefer 2019-01; fall back to the first available month.
  const baseRow = sorted.find((r) => r.month === BASE_MONTH) ?? sorted[0];
  const baseTop = baseRow.median_top_tier;
  const baseBot = baseRow.median_bottom_tier;

  // Guard a degenerate base (zero/NaN would make every index Infinity/NaN).
  if (!baseTop || !baseBot) return { entries: [], baseMonth: baseRow.month };

  const entries: ChartRow[] = sorted.map((r) => ({
    month: r.month,
    luxury_index: Math.round((r.median_top_tier / baseTop) * 1000) / 10,
    starter_index: Math.round((r.median_bottom_tier / baseBot) * 1000) / 10,
  }));

  return { entries, asOf: sorted[sorted.length - 1].month, baseMonth: baseRow.month };
}

export interface TierYoYSeries {
  /** Chart-ready rows, oldest → newest: { month, luxury_yoy, starter_yoy }. */
  entries: ChartRow[];
  /** Latest covered month ("YYYY-MM"), or undefined when nothing is renderable. */
  asOf?: string;
}

/**
 * Derives 12-month year-over-year % change for each tier's regional median.
 * This is where the REAL luxury/starter divergence shows up: cumulative levels
 * (mapTierIndexed) converge over 30 years, but the annual RATES repeatedly trade
 * the lead — starter ran 6–8 pts hotter in the 2013–17 recovery, luxury held
 * firmer in the 2008 and 2023–25 downturns. The vertical gap between the two
 * lines IS the divergence, and it flips sign with the cycle.
 *
 * Mirrors mapPivotedCityYoY: drops any month missing a tier in the current or
 * prior-12 row, sorts ascending, anchors asOf to the newest complete month.
 * The monthly view is gap-free (363 continuous months), so index −12 is exactly
 * 12 calendar months. Tolerates null/empty → empty chart instead of throwing.
 */
export function mapTierYoY(rows: TierPivotedRow[] | null | undefined): TierYoYSeries {
  if (!rows || rows.length === 0) return { entries: [] };

  const sorted = [...rows].filter((r) => !!r.month).sort((a, b) => a.month.localeCompare(b.month));

  const entries: ChartRow[] = [];
  for (let i = 12; i < sorted.length; i++) {
    const cur = sorted[i];
    const prior = sorted[i - 12];
    if (
      cur.median_top_tier == null ||
      cur.median_bottom_tier == null ||
      prior.median_top_tier == null ||
      prior.median_bottom_tier == null ||
      prior.median_top_tier === 0 ||
      prior.median_bottom_tier === 0
    )
      continue;
    entries.push({
      month: cur.month,
      luxury_yoy:
        Math.round(((cur.median_top_tier - prior.median_top_tier) / prior.median_top_tier) * 1000) /
        10,
      starter_yoy:
        Math.round(
          ((cur.median_bottom_tier - prior.median_bottom_tier) / prior.median_bottom_tier) * 1000,
        ) / 10,
    });
  }

  const asOf = entries.length > 0 ? String(entries[entries.length - 1].month) : undefined;
  return { entries, asOf };
}
