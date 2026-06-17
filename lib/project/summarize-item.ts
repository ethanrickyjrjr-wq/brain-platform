import type { ProjectItem } from "@/lib/project/items";

/**
 * One compact, customer-clean summary line per filed item — the card subtitle in
 * the project workspace (Piece 1 §C). Richer than `itemTitle`: it clips long text
 * and adds shape hints (table dims, file type) so a grouped card reads at a glance.
 *
 * Pure + deterministic (NO LLM). Piece 2 may later swap to AI summaries **behind
 * this exact signature** — call sites must not change (cross-build contract).
 */

const MAX = 80;

/** Clip to ≤MAX chars, appending an ellipsis when truncated. */
function clip(s: string): string {
  return s.length > MAX ? s.slice(0, MAX - 1) + "…" : s;
}

export function summarizeItem(item: ProjectItem): string {
  switch (item.kind) {
    case "qa":
      return clip(item.question);
    case "metric":
      return `${item.label}: ${item.value}`;
    case "chart":
    case "frame":
      return item.title;
    case "report":
      return item.title ?? item.slug;
    case "source":
      return item.label;
    case "note":
      return clip(item.text.split("\n")[0] ?? "");
    case "table_slice":
      return `${item.title} — ${item.columns.length}×${item.rows.length}`;
    case "file": {
      if (item.caption) return item.caption;
      const basename = item.storage_path.split("/").pop() ?? item.storage_path;
      const mimeShort = item.mime.split("/").pop() ?? item.mime;
      return `${basename} (${mimeShort})`;
    }
  }
}
