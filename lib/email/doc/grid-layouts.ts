// lib/email/doc/grid-layouts.ts
//
// A block-shell doc carries no `layout`; the grid canvas renders nothing
// without one (GRID_SEEDS filters on it). This synthesizes view-time layouts —
// stack full-width under existing grid content — WITHOUT rewriting the saved
// doc (cockpit D2: the toggle never converts). Heights come from the caller
// (the client passes GridCanvas's DEFAULT_H) so this stays test-importable.
import { GRID_COLS } from "@/lib/email/grid-schema";
import type { BlockLayout, BlockType, EmailBlock, EmailDoc } from "@/lib/email/doc/types";

export function hasGridLayouts(doc: EmailDoc): boolean {
  return doc.blocks.every((b) => b.layout != null);
}

export function ensureGridLayouts(
  doc: EmailDoc,
  heights: Partial<Record<BlockType, number>> = {},
): EmailDoc {
  if (hasGridLayouts(doc)) return doc;
  let y = doc.blocks.reduce((m, b) => (b.layout ? Math.max(m, b.layout.y + b.layout.h) : m), 0);
  const blocks = doc.blocks.map((b) => {
    if (b.layout) return b;
    const h = heights[b.type] ?? 4;
    const layout: BlockLayout = { x: 0, y, w: GRID_COLS, h };
    y += h;
    return { ...b, layout } as EmailBlock;
  });
  return { ...doc, blocks };
}
