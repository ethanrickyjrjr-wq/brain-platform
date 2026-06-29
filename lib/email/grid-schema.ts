// lib/email/grid-schema.ts
//
// Grid constants + column↔pixel math for the PAID-tier resizable layout. The
// position TYPE (`BlockLayout`) lives in `doc/types.ts` (the pure contract that
// imports from no one); this module imports it and adds the helpers the engine
// (server-side position math) and `compile-grid` (positions → email columns) share.
//
// Units verified IN-SESSION via crawl4ai 06/28/2026 (react-grid-layout README v2
// example `{ cols: 12, rowHeight: 30 }`; 600px is the email canvas standard):
//   12 columns · 600px canvas · rowHeight 30 · margin [8,8].
// react-grid-layout v2's framework-agnostic `react-grid-layout/core` runs the SAME
// compaction the canvas uses, so the engine and the grid agree on every position.

import type { BlockLayout, EmailBlock } from "./doc/types";

export type { BlockLayout };

/** 12-column grid (RGL README v2 example). */
export const GRID_COLS = 12;
/** Email canvas width — the long-standing 600px standard. */
export const GRID_WIDTH = 600;
/** RGL example row height. Advisory in email (height is content-driven). */
export const GRID_ROW_HEIGHT = 30;
/** [horizontal, vertical] gutter. */
export const GRID_MARGIN: [number, number] = [8, 8];

/** Column span → email pixel width. `(w/12)*600`, gutter-aware. */
export function colSpanToPx(
  w: number,
  cols: number = GRID_COLS,
  width: number = GRID_WIDTH,
): number {
  const span = Math.max(1, Math.min(cols, Math.round(w)));
  return Math.round((span / cols) * width);
}

/** Column span → percent width (for the Cerberus fluid/hybrid email pattern). */
export function colSpanToPct(w: number, cols: number = GRID_COLS): number {
  const span = Math.max(1, Math.min(cols, Math.round(w)));
  return Math.round((span / cols) * 1000) / 10; // one decimal
}

/** The four width presets the UI surfaces so the user never counts columns
 *  ("you don't have to use them all"). 12-col grid is internal plumbing; these
 *  are the only widths a person picks. Full=12 · ⅔=8 · ½=6 · ⅓=4. */
export const WIDTH_PRESETS: { w: number; label: string }[] = [
  { w: 12, label: "Full" },
  { w: 8, label: "⅔" },
  { w: 6, label: "½" },
  { w: 4, label: "⅓" },
];

/** Column span → the friendly preset label (Full/⅔/½/⅓), else "w/12". */
export function widthPresetLabel(w: number): string {
  return WIDTH_PRESETS.find((p) => p.w === w)?.label ?? `${w}/12`;
}

/** True when ANY block carries a `layout` → the doc renders on the grid
 *  (`compile-grid`); otherwise it stacks via the free-tier `EmailDocRenderer`. */
export function isGridDoc(blocks: ReadonlyArray<Pick<EmailBlock, "layout">>): boolean {
  return blocks.some((b) => b.layout != null);
}
