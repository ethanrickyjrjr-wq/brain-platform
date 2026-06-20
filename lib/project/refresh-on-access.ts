/**
 * refresh-on-access — pure logic for refreshing metric/qa item values from the
 * current brain when the project is opened or an email blast fires.
 *
 * Pure: takes items + a brain-value map, returns patched items. No I/O, no DB.
 * The route / blast handler owns the DB read + write and the activity log.
 */

import type { ProjectItem } from "./items";
import { isConfirmed, type ConfirmedValues } from "@/lib/signals/confirmed-values";

export interface BrainValueMap {
  /** keyed by `${report_id}|${slug}|${scope_value ?? ""}` */
  [key: string]: { value: string; freshness_token: string } | undefined;
}

export interface RefreshResult {
  items: ProjectItem[];
  /** Count of items whose value or freshness_token changed. */
  refreshed: number;
  /** Human-readable summary for the activity log. */
  summary: string;
}

/**
 * Build the cache key used by both the refresh logic and brain-snapshot lookups
 * so the two callers never drift.
 */
export function refreshKey(report_id: string, slug: string, scope_value?: string): string {
  return `${report_id}|${slug}|${scope_value ?? ""}`;
}

/**
 * Walk `items`, patch any metric/qa item whose brain value has a newer freshness
 * token than the snapshot. Returns a new items array (original untouched) and a
 * count of what changed.
 *
 * Non-breaking: items without metric_slug fall back to `label` as the lookup key,
 * matching the brain-snapshot pattern. Items with no entry in `brainValues` are
 * left unchanged — one failed lookup doesn't revert the rest.
 */
export function applyRefresh(
  items: ProjectItem[],
  brainValues: BrainValueMap,
  confirmedValues?: ConfirmedValues,
): RefreshResult {
  let refreshed = 0;
  const next = items.map((item): ProjectItem => {
    if (item.kind !== "metric" && item.kind !== "qa") return item;

    // Phase F "A": never overwrite a value the user explicitly kept.
    if (item.kind === "metric" && isConfirmed(confirmedValues, item.id, item.value)) return item;

    const slug = item.kind === "metric" ? (item.metric_slug ?? item.label) : item.question;
    const scopeValue = item.scope_value;
    const key = refreshKey(item.report_id, slug, scopeValue);
    const brain = brainValues[key];

    if (!brain) return item; // brain lookup failed or not fetched — leave as-is

    // Only refresh if brain has a newer freshness token.
    const currentDay = dayKey(item.freshness_token);
    const brainDay = dayKey(brain.freshness_token);
    if (!brainDay || (currentDay && brainDay <= currentDay)) return item;

    refreshed++;
    if (item.kind === "metric") {
      return { ...item, value: brain.value, freshness_token: brain.freshness_token };
    }
    // qa: update the answer text + freshness_token
    return { ...item, answer: brain.value, freshness_token: brain.freshness_token };
  });

  const summary =
    refreshed === 0
      ? "No metric items needed refreshing"
      : `${refreshed} metric item${refreshed === 1 ? "" : "s"} refreshed with current brain data`;

  return { items: next, refreshed, summary };
}

/** Extract YYYYMMDD tail from a freshness token like `SWFL-7421-v5-20260619`. */
function dayKey(token: string | undefined): string | null {
  if (!token) return null;
  const m = token.match(/(\d{8})$/);
  return m ? m[1] : null;
}
