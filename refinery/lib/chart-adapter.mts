/**
 * chart-adapter.mts — shared adapter between ChartBlock (refinery) and
 * chart components (Next.js). Importable from both refinery/Node and Next
 * server/client contexts.
 *
 * Pattern mirrors refinery/lib/corridor-aliases.mts.
 */

import type {
  ChartBlock,
  ChartValueFormat,
} from "../validate/chart-block-lint.mts";
import type {
  HBarCorridor,
  HBarChartProps,
  HBarTier,
} from "../../components/charts/HBarChart";
import type { NfipZipAggregate } from "../sources/fema-nfip-source.mts";
import { barrierClassFor } from "./swfl-geo.mts";
import { medianOf } from "../../lib/stats";
import { cityForZip, looksLikeZip } from "../../lib/swfl-zip-city";

// ---------------------------------------------------------------------------
// formatChartValue — the one numeric formatter the renderer uses
// ---------------------------------------------------------------------------

/**
 * Maps a ChartBlock's `value_format` hint to a display string. Legacy
 * "currency"/"aal" outputs are preserved verbatim so existing charts
 * (asking-rent, flood) do not shift; the new formats keep large dollars,
 * percentages, counts, and ratios legible. Defaults to "currency" when the
 * block carries no hint (the historical HBarChart default).
 */
export function formatChartValue(
  format: ChartValueFormat | undefined,
  v: number,
): string {
  switch (format ?? "currency") {
    case "usd":
      return `$${Math.round(v).toLocaleString("en-US")}`;
    case "aal":
      return `$${Math.round(v).toLocaleString("en-US")}/yr`;
    case "percent":
      return `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    case "count":
      return `${Math.round(v).toLocaleString("en-US")}`;
    case "number":
      return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
    case "currency":
    default:
      return `$${v.toFixed(2)}`;
  }
}

// ---------------------------------------------------------------------------
// Constants (extracted from asking-rent/page.tsx so one source of truth)
// ---------------------------------------------------------------------------

export const BULLISH_MULTIPLIER = 1.2;
export const BEARISH_MULTIPLIER = 0.7;

// ---------------------------------------------------------------------------
// Tier helper
// ---------------------------------------------------------------------------

/** Determines HBar tier for a value relative to market median. */
export function tierFor(value: number, median: number): HBarTier {
  if (value >= median * BULLISH_MULTIPLIER) return "bullish";
  if (value <= median * BEARISH_MULTIPLIER) return "bearish";
  return "neutral";
}

// ---------------------------------------------------------------------------
// adaptToHBar
// ---------------------------------------------------------------------------

/**
 * Derives HBarChartProps from a ChartBlock.
 * columns[0] = label string (corridor name), columns[1] = primary numeric
 * metric ($/sqft). Rows where columns[1] is not a number are skipped.
 */
export function adaptToHBar(block: ChartBlock): HBarChartProps {
  const numericRows = block.rows.filter(
    (row) => typeof row[1] === "number",
  ) as [string | number | null, number, ...(string | number | null)[]][];

  if (numericRows.length === 0) {
    return {
      title: block.title,
      corridors: [],
      median: 0,
      range: { min: 0, max: 0 },
      valueFormat: block.value_format,
    };
  }

  const numericValues = numericRows.map((row) => row[1]);
  const median = medianOf(numericValues) ?? 0;
  const range = {
    min: Math.min(...numericValues),
    max: Math.max(...numericValues),
  };

  const corridors: HBarCorridor[] = numericRows.map((row) => {
    const name = String(row[0]);
    const value = row[1];
    const subLabel = looksLikeZip(name) ? cityForZip(name) : undefined;
    return { name, value, tier: tierFor(value, median), subLabel };
  });

  return {
    title: block.title,
    corridors,
    median,
    range,
    valueFormat: block.value_format,
  };
}

// ---------------------------------------------------------------------------
// adaptToTable — trivial pass-through for table fallback rendering
// ---------------------------------------------------------------------------

export function adaptToTable(block: ChartBlock): {
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
} {
  return {
    title: block.title,
    columns: block.columns,
    rows: block.rows as (string | number | null)[][],
  };
}

// ---------------------------------------------------------------------------
// pickRenderer
// ---------------------------------------------------------------------------

const VALID_RENDERERS = new Set(["bar", "area", "scatter", "table"] as const);

/**
 * Returns block.chart_type if it is one of the four known renderer keys;
 * otherwise falls back to "table".
 */
export function pickRenderer(
  block: ChartBlock,
): "bar" | "area" | "scatter" | "table" {
  if (block.chart_type && VALID_RENDERERS.has(block.chart_type)) {
    return block.chart_type;
  }
  return "table";
}

// ---------------------------------------------------------------------------
// adaptFloodZipsToHBar
// ---------------------------------------------------------------------------

/** Flood colors from the design system — inverted: high AAL = bearish. */
const FLOOD_COLORS = {
  bullish: "#5BC97A", // --mangrove (low risk)
  neutral: "rgba(91, 201, 122, 0.55)",
  bearish: "#E08158", // --sunset-coral (high risk)
};

/**
 * Builds HBarChartProps from a sorted list of NfipZipAggregate rows.
 * Tiers are inverted: high AAL → bearish (#E08158), low → bullish (#5BC97A).
 * Adds a separator between barrier-island and non-barrier ZIPs when mixed.
 */
export function adaptFloodZipsToHBar(zips: NfipZipAggregate[]): HBarChartProps {
  if (zips.length === 0) {
    return {
      title: "Flood loss by ZIP",
      corridors: [],
      median: 0,
      range: { min: 0, max: 0 },
      tierColors: FLOOD_COLORS,
      valueFormat: "aal",
      tooltipMetricLabel: "Flood AAL",
    };
  }

  // Sort descending by AAL — highest risk first.
  const sorted = [...zips].sort(
    (a, b) => b.aal_usd_per_insured_property - a.aal_usd_per_insured_property,
  );

  const values = sorted.map((z) => z.aal_usd_per_insured_property);
  const median = medianOf(values) ?? 0;
  const range = { min: Math.min(...values), max: Math.max(...values) };

  // Inverted tier thresholds: high AAL relative to median is bearish.
  const corridors: HBarCorridor[] = sorted.map((z) => {
    const v = z.aal_usd_per_insured_property;
    let tier: HBarTier;
    if (v >= median * BULLISH_MULTIPLIER) tier = "bearish";
    else if (v <= median * BEARISH_MULTIPLIER) tier = "bullish";
    else tier = "neutral";
    const city = cityForZip(z.zip) ?? z.county_name.replace(/ County$/i, "");
    return { name: z.zip, value: v, tier, subLabel: city };
  });

  // Separator after the last barrier-island ZIP (score 1.0) if the list is mixed.
  const lastBarrierIdx = sorted.reduce<number>((acc, z, i) => {
    return barrierClassFor(z.zip).score === 1.0 ? i : acc;
  }, -1);
  const hasNonBarrier = sorted.some((z) => barrierClassFor(z.zip).score < 1.0);
  const separatorAfter =
    lastBarrierIdx >= 0 && hasNonBarrier ? lastBarrierIdx + 1 : undefined;

  return {
    title: "Flood loss by ZIP",
    eyebrow: "NFIP · 10-yr window · per insured property",
    corridors,
    median,
    range,
    tierColors: FLOOD_COLORS,
    valueFormat: "aal",
    tooltipMetricLabel: "Flood AAL",
    ...(separatorAfter !== undefined && {
      separatorAfter,
      separatorLabel: "Coastal / Inland",
    }),
  };
}

// ---------------------------------------------------------------------------
// Stubs — return adaptToTable result until producers emit matching chart_type
// ---------------------------------------------------------------------------

export function adaptToArea(
  block: ChartBlock,
): ReturnType<typeof adaptToTable> {
  return adaptToTable(block);
}

export function adaptToScatter(
  block: ChartBlock,
): ReturnType<typeof adaptToTable> {
  return adaptToTable(block);
}
