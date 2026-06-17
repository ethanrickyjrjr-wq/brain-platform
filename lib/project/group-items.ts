import type { ProjectItem } from "@/lib/project/items";

/**
 * Group filed items by kind into a stable, fixed-order list for the workspace
 * item board + project digests (Piece 1 §C; cross-build contract — P2/P4 consume
 * this exact shape). Only non-empty kinds are returned; input order is preserved
 * within each group. Pure + deterministic.
 */

type Kind = ProjectItem["kind"];

/** The display order for grouped cards — facts/answers first, attachments last. */
const KIND_ORDER: Kind[] = [
  "qa",
  "chart",
  "metric",
  "report",
  "source",
  "note",
  "table_slice",
  "file",
  "frame",
];

export interface ItemGroup {
  kind: Kind;
  items: ProjectItem[];
}

export function groupItemsByKind(items: ProjectItem[]): ItemGroup[] {
  const byKind = new Map<Kind, ProjectItem[]>();
  for (const item of items) {
    const bucket = byKind.get(item.kind);
    if (bucket) bucket.push(item);
    else byKind.set(item.kind, [item]);
  }
  return KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    items: byKind.get(kind)!,
  }));
}
