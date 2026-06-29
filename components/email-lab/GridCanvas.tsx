"use client";
// components/email-lab/GridCanvas.tsx (Build G1 + G2 — operator track)
//
// The PAID-tier resizable/movable canvas: a true 2D grid built on
// react-grid-layout v2 (verified in-session via crawl4ai 06/28/2026 — npm
// react-grid-layout@2.2.3, README v2 + dist .d.ts). It is the SUPERSET sibling
// of the free-tier `BlockCanvas` (dnd-kit stacked reorder): same core props
// (`doc / selectedId / onSelectBlock / onChangeDoc`) so the grid shell mounts it
// for paid docs and keeps BlockCanvas for the free tier — nothing downgraded.
//
// G1 (done): drag moves a block, corner-drag resizes, the new position flows back
// into `block.layout`, the preview reflects the new columns.
// G2 (this build): the per-block toolbar is ALWAYS reachable — a visible drag
// handle, duplicate, and delete on hover/selection, a "Selected · ⅔ width" tag,
// and a "click to add here" tile so a block can be added straight on the grid.
// Per-block AI + field editing live in the shell's right panel (click selects →
// the inspector + AI re-target to that block), so they aren't duplicated here.
//
// NOTE — "wrap the existing CanvasBlock" (spec) is reinterpreted: `CanvasBlock`
// is hard-wired to dnd-kit `useSortable`, which only works inside a DndContext;
// nesting it under RGL would pit two drag systems against each other. So this
// renders the SAME pure block (`BlockRenderer`) with its own ring/handle/toolbar
// chrome, RGL-driven.
//
// KNOWN TENSION (surfaced, not solved): RGL cells are a fixed
// height = h × rowHeight, but email blocks are content-driven height. Content
// taller than the cell is clipped (`overflow-hidden` keeps the box truthful so
// the user resizes to fit). The shell normalizes author-engine heights on import.
import { useMemo } from "react";
import { toast } from "sonner";
import ReactGridLayout, {
  verticalCompactor,
  type Layout,
  type LayoutItem,
  type ResizeHandleAxis,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { BlockLayout, BlockType, EmailBlock, EmailDoc } from "@/lib/email/doc/types";
import {
  GRID_COLS,
  GRID_MARGIN,
  GRID_ROW_HEIGHT,
  GRID_WIDTH,
  widthPresetLabel,
} from "@/lib/email/grid-schema";
import { BlockRenderer } from "@/lib/email/blocks/BlockRenderer";

// Corner handles only (spec). ResizeHandleAxis ⊂ {s,w,e,n,sw,nw,se,ne}.
const RESIZE_HANDLES: ResizeHandleAxis[] = ["se", "sw", "ne", "nw"];

// Default row-spans (× rowHeight 30) for a block that arrives WITHOUT a `layout`.
// Used to render it on the grid AND (exported) by the shell to materialize a
// layout when the user resizes/duplicates/adds a block. Stacked compactly so
// RGL's mount-time vertical compaction is a no-op.
export const DEFAULT_H: Record<BlockType, number> = {
  header: 3,
  hero: 6,
  stats: 4,
  signal: 5,
  text: 5,
  image: 8,
  listing: 9,
  "multi-column": 5,
  "agent-card": 6,
  "agent-hero": 8,
  "social-icons": 2,
  button: 2,
  divider: 1,
  footer: 5,
};

/** Doc blocks → RGL layout. Blocks with `layout` pass through (constraints kept);
 *  blocks without get a full-width, vertically-stacked default (footer locked). */
function buildLayout(blocks: EmailBlock[]): LayoutItem[] {
  let cursorY = 0;
  return blocks.map((b) => {
    if (b.layout) {
      const { x, y, w, h, minW, maxW, minH, maxH, static: isStatic } = b.layout;
      return { i: b.id, x, y, w, h, minW, maxW, minH, maxH, static: isStatic };
    }
    const h = DEFAULT_H[b.type] ?? 4;
    const item: LayoutItem = {
      i: b.id,
      x: 0,
      y: cursorY,
      w: GRID_COLS,
      h,
      static: b.type === "footer",
    };
    cursorY += h;
    return item;
  });
}

export function GridCanvas({
  doc,
  selectedId,
  onSelectBlock,
  onChangeDoc,
  onDuplicate,
  onAddBlock,
  onBlockAi,
  onEditPhoto,
}: {
  doc: EmailDoc;
  selectedId: string | null;
  onSelectBlock: (id: string | null) => void;
  onChangeDoc: (next: EmailDoc) => void;
  /** Duplicate a block (shell mints the id + places the copy on the grid). */
  onDuplicate?: (id: string) => void;
  /** Click the "add here" tile → shell adds a block on the grid. */
  onAddBlock?: () => void;
  /** Per-block AI button → shell selects the block and focuses the AI panel. */
  onBlockAi?: (id: string) => void;
  /** Edit-photo button (image / listing) → shell opens the photos panel. */
  onEditPhoto?: (id: string) => void;
}) {
  // Stable layout identity → RGL doesn't recompact on unrelated re-renders
  // (e.g. a selection change). Also the BASELINE we diff writebacks against.
  const layout = useMemo(() => buildLayout(doc.blocks), [doc.blocks]);

  // RGL fires onLayoutChange once on mount (after compaction) and after every
  // drag/resize. Commit ONLY a real geometry change vs the baseline we fed in —
  // otherwise mount → writeback → recompact loops (and dirties a freshly loaded
  // doc / adds a bogus history entry). Synthesized defaults are compact already,
  // so the mount pass is a no-op and is never committed.
  function handleLayoutChange(next: Layout) {
    const baseline = new Map(layout.map((it) => [it.i, it]));
    let changed = false;
    const blocks = doc.blocks.map((b) => {
      const item = next.find((it) => it.i === b.id);
      const base = baseline.get(b.id);
      if (!item || !base) return b;
      if (item.x === base.x && item.y === base.y && item.w === base.w && item.h === base.h) {
        return b;
      }
      changed = true;
      // Take ONLY geometry from RGL; preserve constraints from the existing
      // layout (RGL's echo of minW/static is not authoritative for us).
      const nextLayout: BlockLayout = {
        ...(b.layout ?? {}),
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      };
      return { ...b, layout: nextLayout };
    });
    if (changed) onChangeDoc({ ...doc, blocks });
  }

  function remove(id: string) {
    if (doc.blocks.length <= 1) return;
    const target = doc.blocks.find((b) => b.id === id);
    if (target?.type === "footer") {
      const footerCount = doc.blocks.filter((b) => b.type === "footer").length;
      if (footerCount <= 1) {
        toast.error(
          "Unsubscribe link is required in all emails — move it anywhere, but it can't be removed.",
        );
        return;
      }
    }
    onChangeDoc({ ...doc, blocks: doc.blocks.filter((b) => b.id !== id) });
    if (selectedId === id) onSelectBlock(null);
  }

  return (
    <div
      className="h-full overflow-y-auto bg-gray-100 px-4 py-8"
      onClick={() => onSelectBlock(null)}
    >
      <div className="mx-auto w-[600px] max-w-full" onClick={(e) => e.stopPropagation()}>
        <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
          {doc.blocks.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-gray-400">
              Your email is empty — add a block to start.
            </div>
          ) : (
            <ReactGridLayout
              layout={layout}
              width={GRID_WIDTH}
              gridConfig={{ cols: GRID_COLS, rowHeight: GRID_ROW_HEIGHT, margin: GRID_MARGIN }}
              dragConfig={{ enabled: true, handle: ".drag-handle" }}
              resizeConfig={{ enabled: true, handles: RESIZE_HANDLES }}
              compactor={verticalCompactor}
              onLayoutChange={handleLayoutChange}
            >
              {doc.blocks.map((block) => {
                const selected = block.id === selectedId;
                const locked = block.type === "footer" && block.layout?.static;
                return (
                  // Direct child stays a plain div — RGL injects positioning
                  // style/className + ref + mouse/touch handlers + resize handles
                  // onto it. All of OUR chrome lives on the inner div so RGL never
                  // clobbers it.
                  <div key={block.id}>
                    <div
                      onClick={() => onSelectBlock(block.id)}
                      className={`group relative h-full w-full cursor-pointer overflow-hidden rounded-[3px] transition-shadow ${
                        selected
                          ? "ring-2 ring-inset ring-gulf-teal"
                          : "ring-1 ring-inset ring-transparent hover:ring-gray-300"
                      }`}
                    >
                      {/* width tag — only on the selected block (matches the mockup) */}
                      {selected && (
                        <div className="pointer-events-none absolute -top-0 left-0 z-20 rounded-br-md rounded-tl-[3px] bg-gulf-teal px-2 py-0.5 text-[10px] font-semibold text-[#06222a]">
                          ✦ Selected · {widthPresetLabel(block.layout?.w ?? GRID_COLS)} width
                        </div>
                      )}

                      {/* drag handle — always visible, left edge (G2: not opacity-0 at rest) */}
                      <div
                        role="button"
                        aria-label="Drag to move"
                        title={locked ? "Locked block" : "Drag to move"}
                        onClick={(e) => e.stopPropagation()}
                        className={`drag-handle absolute bottom-0 left-0 top-0 z-10 flex cursor-grab select-none items-center px-1 text-base leading-none active:cursor-grabbing ${
                          locked
                            ? "cursor-not-allowed text-gray-200"
                            : "text-gray-300 hover:text-gray-600"
                        }`}
                      >
                        ⠿
                      </div>

                      {/* action pill — visible on hover, pinned when selected */}
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className={`absolute right-1 top-1 z-20 flex items-center gap-0.5 rounded-md bg-white/95 px-1 py-0.5 shadow-sm ring-1 ring-gray-200 transition-opacity ${
                          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <button
                          type="button"
                          aria-label="AI: edit this block"
                          title="Ask AI to edit this block"
                          onClick={() =>
                            onBlockAi ? onBlockAi(block.id) : onSelectBlock(block.id)
                          }
                          className="px-1 text-sm leading-none text-gulf-teal hover:text-[#17a3b3]"
                        >
                          ✦
                        </button>
                        {(block.type === "image" || block.type === "listing") && onEditPhoto && (
                          <button
                            type="button"
                            aria-label="Change photo"
                            title="Change photo"
                            onClick={() => onEditPhoto(block.id)}
                            className="px-1 text-sm leading-none text-gray-400 hover:text-gray-700"
                          >
                            ◧
                          </button>
                        )}
                        {onDuplicate && !locked && (
                          <button
                            type="button"
                            aria-label="Duplicate block"
                            title="Duplicate"
                            onClick={() => onDuplicate(block.id)}
                            className="px-1 text-sm leading-none text-gray-400 hover:text-gulf-teal"
                          >
                            ⧉
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Delete block"
                          title={locked ? "Required (unsubscribe)" : "Delete"}
                          onClick={() => remove(block.id)}
                          className={`px-1 text-sm leading-none ${
                            locked
                              ? "cursor-not-allowed text-gray-200"
                              : "text-red-400 hover:text-red-600"
                          }`}
                        >
                          ✕
                        </button>
                      </div>

                      {/* pointer-events off so the wrapper owns the click/select */}
                      <div className="pointer-events-none h-full">
                        <BlockRenderer block={block} globalStyle={doc.globalStyle} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </ReactGridLayout>
          )}
        </div>

        {/* "click to add here" — adds a block straight onto the grid (the shell
            places it at the bottom; the user then drags/resizes/AI-fills it). */}
        {onAddBlock && (
          <button
            type="button"
            onClick={onAddBlock}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-white/60 py-4 text-sm font-medium text-gray-400 transition-colors hover:border-gulf-teal hover:text-gulf-teal"
          >
            <span className="text-lg leading-none">＋</span>
            Click to add a block — or ask the AI to drop one in
          </button>
        )}
      </div>
    </div>
  );
}
