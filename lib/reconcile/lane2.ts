/**
 * lib/reconcile/lane2.ts — Plan C, the Lane-2 assertion loader.
 *
 * Narrows a filed `ProjectItem` (B's carry-back / a live web project) into a
 * typed `LaneTwoAssertion`. Only the `metric` kind carries the single
 * (label, value, freshness_token) triple a single-metric verdict needs, so only
 * it produces an assertion; every other kind (note, source, chart, table_slice,
 * …) → `null`. Reuses the canonical `ProjectItem` shape — never re-declares it.
 *
 * `table_slice` is intentionally NOT reconciled here: it is a multi-cell table,
 * and cross-metric reconciliation is a Tier-3 follow-on (README). C is
 * single-brain / single-metric.
 */

import type { ProjectItem } from "../project/items";
import type { LaneTwoAssertion } from "./types";

export function toAssertion(item: ProjectItem): LaneTwoAssertion | null {
  if (item.kind !== "metric") return null;
  return {
    report_id: item.report_id,
    label: item.label,
    value: item.value,
    freshness_token: item.freshness_token,
    ...(item.source_url !== undefined ? { source_url: item.source_url } : {}),
    ...(item.source_label !== undefined ? { source_label: item.source_label } : {}),
    ...(item.metric_slug !== undefined ? { metric_slug: item.metric_slug } : {}),
    origin: item.origin, // base field — "mcp" (carry-back) | "web" (live project)
  };
}
