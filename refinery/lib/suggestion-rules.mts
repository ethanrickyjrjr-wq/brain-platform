/**
 * Canonical chip/suggestion rules — shared by the refinery build (stamps
 * BrainOutputMetric.suggestions at build time) and the client highlighter
 * fallback (used when the dossier can't resolve a selection).
 *
 * Pure: no I/O, no DOM, no React. Bun-testable from both sides.
 */

/**
 * Returns a chart chip string for a metric slug, or null if no chart scope
 * maps to this slug. Kept in sync with routeChart() in lib/highlighter/.
 * Scopes flood-aal and vitals are excluded — buildChartForIntent returns null
 * for both until their data paths are live.
 */
export function chartChipForMetric(metricSlug: string): string | null {
  const s = metricSlug.toLowerCase();
  if (s.includes("rent") || s.includes("asking")) return "Chart asking rents across the corridors";
  if (s.includes("vacanc")) return "Chart vacancy rates across corridors";
  if (s.includes("zhvi") || s.includes("home_value") || s.includes("home_price"))
    return "Chart home values over time";
  return null;
}

/**
 * Generates 2–3 follow-up chip strings for a brain metric. Used at build time
 * (refinery stage 4) to stamp BrainOutputMetric.suggestions, and at runtime as
 * the client fallback when the dossier can't resolve a selection.
 *
 * Slice to 3 so the popup UI never overflows.
 */
export function suggestionsForMetric(
  m: { metric: string; value: string | number },
  slug: string,
): string[] {
  const chip = chartChipForMetric(m.metric);
  const label = m.metric.replace(/_/g, " ");
  const out = [`What's driving ${label}?`, `How does ${label} here compare to other SWFL areas?`];
  if (slug === "housing-swfl") out.push(`How does flood risk affect ${label} in this ZIP?`);
  if (chip) out.unshift(chip);
  return out.slice(0, 3);
}
