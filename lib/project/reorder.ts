import type { ProjectItem } from "@/lib/project/items";

/**
 * Reorder a filed item within its own KIND, swapping with the nearest same-kind
 * neighbor in the given direction. Because the item board groups by kind, this
 * keeps the grouping stable: a move only ever shuffles items inside their group
 * (different-kind items in between are skipped). Pure — returns a new array, or
 * the SAME array reference when nothing moves (unknown id / already at the edge).
 */
export function reorderWithinKind(items: ProjectItem[], id: string, dir: -1 | 1): ProjectItem[] {
  const idx = items.findIndex((it) => it.id === id);
  if (idx < 0) return items;
  const kind = items[idx].kind;
  let j = idx + dir;
  while (j >= 0 && j < items.length && items[j].kind !== kind) j += dir;
  if (j < 0 || j >= items.length) return items;
  const next = [...items];
  [next[idx], next[j]] = [next[j], next[idx]];
  return next;
}
