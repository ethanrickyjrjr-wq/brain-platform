import type { ProjectItem } from "@/lib/project/items";
import { itemTitle } from "./item-title";

/**
 * briefcaseDigest — render the saved draft items into a short, customer-clean
 * summary the chat receives so it knows what's already filed and stops
 * re-pitching it ("build on them; don't re-suggest saving"). Pure.
 *
 * Bounded twice (it rides on a paid-LLM call): at most `maxItems` items are
 * spelled out (with a "+N more" tail), and the whole string is clamped to
 * `maxChars`. Renders through the shared `itemTitle` so it stays customer-clean
 * (never an internal id / report_id).
 */
const KIND_LABEL: Record<ProjectItem["kind"], string> = {
  qa: "answer",
  metric: "metric",
  chart: "chart",
  frame: "chart",
  table_slice: "table",
  source: "source",
  report: "report",
  note: "note",
  file: "file",
};

export function briefcaseDigest(
  items: ProjectItem[],
  opts: { maxItems?: number; maxChars?: number } = {},
): string {
  if (!items || items.length === 0) return "";
  const maxItems = opts.maxItems ?? 10;
  const maxChars = opts.maxChars ?? 1000;

  const shown = items.slice(0, maxItems);
  const extra = items.length - shown.length;

  const lead =
    "The user has already saved these to their briefcase (build on them; " +
    "don't re-suggest saving what's already there): ";
  let body = shown.map((it) => `[${KIND_LABEL[it.kind]}] ${itemTitle(it)}`).join("; ");
  if (extra > 0) body += ` … (+${extra} more)`;

  const out = lead + body;
  if (out.length > maxChars) return out.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
  return out;
}
