// Pure value + date formatters for charts. Deliberately OUTSIDE the
// "use client" chart component so (a) it is unit-testable without pulling in
// recharts/motion, and (b) a Server Component can hand the chart a serializable
// TOKEN ("usd"|"rent"|"count") instead of a function — passing a function across
// the RSC boundary aborts `next build` at prerender. This separation is the fix
// for the 2026-06-13 build break (see app/_design/07-charts-and-dataviz.md §6).

export type ValueFormat = "usd" | "rent" | "count";

/** Y-axis + tooltip number formatting, chosen by a serializable token. */
export function formatChartValue(format: ValueFormat, value: number): string {
  switch (format) {
    case "usd":
      return value >= 1_000_000
        ? `$${(value / 1_000_000).toFixed(2)}M`
        : `$${Math.round(value).toLocaleString("en-US")}`;
    case "rent":
      return `$${Math.round(value).toLocaleString("en-US")}`;
    case "count":
      if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
      if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
      return `${Math.round(value)}`;
  }
}

/**
 * Compact Y-AXIS tick label — narrower than the tooltip value so it doesn't clip
 * on a phone. `usd` abbreviates to $k / $M (a $410,000 tick became "10,000" once
 * the left edge clipped the "$4"); `rent` stays full ($2,000 — short enough to
 * fit, and rounding to "$2k" would collide adjacent ticks); `count` is already
 * abbreviated. The tooltip still uses formatChartValue for full precision.
 */
export function formatAxisTick(format: ValueFormat, value: number): string {
  if (format === "usd") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1000) return `$${Math.round(value / 1000)}k`;
    return `$${Math.round(value)}`;
  }
  return formatChartValue(format, value);
}

/** "2026-04" → "Apr 2026" for the "as of" caption; passes anything unexpected through. */
export function formatAsOf(month: string | undefined): string | undefined {
  if (!month) return undefined;
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
