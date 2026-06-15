/**
 * lib/reconcile/slug-map.ts — Plan C, the Lane-2 label→slug resolver.
 *
 * A filed assertion carries a human `label` ("Median sale price"); the lake
 * keys metrics by `slug` ("median_sale_price"). This resolves one to the other
 * by case/whitespace normalization. Correctness-critical: a wrong match could
 * pass a different metric's number off as `verified`, so the rule is
 * never-guess — an unknown OR ambiguous label resolves to `null`.
 */

/** Lowercase, trim, and collapse internal whitespace for label comparison. */
function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolve a human `label` to a lake metric slug against a brain's metrics.
 * Exactly one normalized-label match → that slug; zero (unknown) or more than
 * one (ambiguous) → `null`. Never guesses.
 *
 * `report_id` is carried for signature symmetry with the lane bridge (and future
 * per-brain label overrides); matching is purely over `brainMetrics`.
 */
export function resolveMetricSlug(
  report_id: string,
  label: string,
  brainMetrics: ReadonlyArray<{ metric: string; label: string }>,
): string | null {
  void report_id;
  const want = normalizeLabel(label);
  const matches = brainMetrics.filter((m) => normalizeLabel(m.label) === want);
  return matches.length === 1 ? matches[0].metric : null;
}
