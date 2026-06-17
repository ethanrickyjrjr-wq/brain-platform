import type { ProjectItem } from "./items";

/**
 * The cross-project identity key for an item — "the same underlying data, wherever it's
 * filed." The digest stamps one key per item; the cross-project index calls a metric/
 * report/etc. a *reuse* when the same key appears in two projects. Lives in its own file
 * so the digest and the index can both import it without an import cycle.
 *
 * Kind-prefixed so a chart_id can never collide with a report slug. Optional fields
 * (`metric_slug`, `frame_id`, `metric_keys`) are null-coalesced so items filed before
 * those schema lifts still key stably. Frame keys fall back to the title when neither a
 * `frame_id` nor `metric_keys` is present — otherwise two auto-picked frames on the same
 * brain would collide (the trap flagged in the seam audit). `metric_keys` are sorted so
 * order doesn't change identity.
 */
export function identityKeyForItem(item: ProjectItem): string {
  switch (item.kind) {
    case "metric":
      return `metric:${item.metric_slug ?? item.label}@${item.report_id}`;
    case "report":
      return `report:${item.slug}`;
    case "table_slice":
      return `table_slice:${item.report_id}::${item.title}`;
    case "frame": {
      const seg =
        item.metric_keys && item.metric_keys.length
          ? [...item.metric_keys].sort().join(",")
          : item.title;
      return `frame:${item.brain_id}::${item.frame_id ?? "auto"}::${seg}`;
    }
    case "source":
      return `source:${item.table}::${item.url}`;
    case "qa":
      return `qa:${item.report_id}::${item.question}`;
    case "chart":
      return `chart:${item.chart_id}`;
    case "file":
      return `file:${item.storage_path}`;
    case "note":
      return `note:${item.text}`;
  }
}

/**
 * Deterministic one-liner title for a ProjectItem, used in project_feed.title.
 * Derived purely from item fields — no LLM, no invention. Capped at 120 chars
 * for free-text kinds (qa.question, note.text) to keep feed rows scannable.
 */
export function titleForItem(item: ProjectItem): string {
  switch (item.kind) {
    case "metric":
      return `Metric: ${item.label}`;
    case "report":
      return `Report: ${item.title ?? item.slug}`;
    case "table_slice":
      return `Table: ${item.title}`;
    case "frame":
      return `Frame: ${item.title}`;
    case "source":
      return `Source: ${item.label}`;
    case "qa":
      return `Q: ${item.question.slice(0, 120)}`;
    case "chart":
      return `Chart: ${item.title}`;
    case "file":
      return `File: ${item.caption ?? item.storage_path.split("/").pop() ?? item.storage_path}`;
    case "note":
      return `Note: ${item.text.slice(0, 120)}`;
  }
}
