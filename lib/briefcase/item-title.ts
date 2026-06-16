import type { ProjectItem } from "@/lib/project/items";

/**
 * One customer-clean line per filed item (no internal ids / jargon). Extracted
 * from BriefcasePanel so both the panel's draft list AND the chat's briefcase
 * digest render saved items identically from ONE place. Pure.
 */
export function itemTitle(item: ProjectItem): string {
  switch (item.kind) {
    case "qa":
      return item.question;
    case "metric":
      return `${item.label}: ${item.value}`;
    case "chart":
    case "frame":
    case "table_slice":
      return item.title;
    case "source":
      return item.label;
    case "report":
      return item.title ?? item.slug;
    case "note":
      return item.text;
    case "file":
      return item.caption ?? "Attachment";
  }
}
