# Grid Email: Canvas UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** ⚡ Sonnet — keywords: schema, architecture

**Goal:** Five canvas improvements to `GridCanvas` and `EmailLabGridShell`: (1) per-block overflow detection + "Fit content" button; (2) image drag-from-filesystem directly onto the canvas; (3) snap alignment guides drawn during drag; (4) double-click inline text editing overlay; (5) a block layers panel for drag-sorting without touching the canvas.

**Architecture:** All logic stays in `components/email-lab/GridCanvas.tsx` (overflow/drag-drop/snap/inline) and `components/email-lab/EmailLabGridShell.tsx` (new callbacks + layers panel). A new `components/email-lab/LayersPanel.tsx` extracts the sortable list. No new API routes. No new npm packages — `@dnd-kit/core` and `@dnd-kit/sortable` are already in `package.json`.

**Tech Stack:** React `useRef` / `useLayoutEffect`, `ResizeObserver`, react-grid-layout v2 `onDrag` / `onDragStart` / `onDragStop` callbacks, `@dnd-kit/core` + `@dnd-kit/sortable`, `bun:test`.

## Global Constraints

- `GRID_ROW_HEIGHT = 30` (`lib/email/grid-schema.ts`) — the pixel unit for grid row height.
- `GRID_WIDTH = 600`, `GRID_COLS = 12`, `GRID_MARGIN = [8, 8]` — used in pixel ↔ grid conversions.
- All new `GridCanvas` props are **optional** — no existing callers break.
- Blocks with inline text editing: `text` (field `content`), `hero` (field `headline`), `header` (field `title`), `signal` (field `label`). All other block types get no inline edit on double-click.
- Snap guide tolerance: ±0 — show guides only on exact column/row alignment (grid-unit equality).
- No `pointer-events` changes to `BlockRenderer` — the inline editor is an overlay, not a change to the renderer.
- `bun:test` pattern: `mock.module()` before imports, `beforeEach` resets scenario, `import` after mocks.

---

### Task 1: Resize-to-fit content

**Files:**
- 🔴 Modify: `components/email-lab/GridCanvas.tsx`
- 🔴 Modify: `components/email-lab/EmailLabGridShell.tsx`
- Create: `components/email-lab/GridCanvas.test.tsx` (overflow detection unit tests)

**Interfaces:**
- Consumes: `GRID_ROW_HEIGHT` from `lib/email/grid-schema.ts` (already imported)
- Produces:
  - New optional `GridCanvas` prop: `onFitBlock?: (id: string, newH: number) => void`
  - When content of a block overflows its cell, an "↕ Fit" badge appears in the action pill
  - Clicking "↕ Fit" calls `onFitBlock(id, newH)` where `newH = Math.ceil(scrollHeight / GRID_ROW_HEIGHT) + 1`

- [ ] **Step 1: Extract `GridBlock` component inside `GridCanvas.tsx`**

The current canvas renders blocks inline in `doc.blocks.map()`. Move each block's inner JSX into a new local component `GridBlock` so it can own its own `useLayoutEffect` and `ref`. Add this component definition before `export function GridCanvas(...)` in `GridCanvas.tsx`:

```tsx
function GridBlock({
  block,
  selected,
  locked,
  onSelect,
  onDuplicate,
  onRemove,
  onBlockAi,
  onEditPhoto,
  onFit,
}: {
  block: EmailBlock;
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
  onDuplicate?: () => void;
  onRemove: () => void;
  onBlockAi?: () => void;
  onEditPhoto?: () => void;
  onFit?: (newH: number) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    // scrollHeight > offsetHeight means content is clipped by the fixed cell height.
    const check = () => setOverflows(el.scrollHeight > el.offsetHeight + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [block]); // re-check whenever the block data changes

  const blockWidth = widthPresetLabel(block.layout?.w ?? GRID_COLS);

  return (
    <div
      onClick={onSelect}
      className={`group relative h-full w-full cursor-pointer overflow-hidden rounded-[3px] transition-shadow ${
        selected
          ? "ring-2 ring-inset ring-gulf-teal"
          : "ring-1 ring-inset ring-transparent hover:ring-gray-300"
      }`}
    >
      {/* width tag */}
      {selected && (
        <div className="pointer-events-none absolute -top-0 left-0 z-20 rounded-br-md rounded-tl-[3px] bg-gulf-teal px-2 py-0.5 text-[10px] font-semibold text-[#06222a]">
          ✦ Selected · {blockWidth} width
        </div>
      )}

      {/* drag handle */}
      <div
        role="button"
        aria-label="Drag to move"
        title={locked ? "Locked block" : "Drag to move"}
        onClick={(e) => e.stopPropagation()}
        className={`drag-handle absolute bottom-0 left-0 top-0 z-10 flex cursor-grab select-none items-center px-1 text-base leading-none active:cursor-grabbing ${
          locked ? "cursor-not-allowed text-gray-200" : "text-gray-300 hover:text-gray-600"
        }`}
      >
        ⠿
      </div>

      {/* action pill */}
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
          onClick={onBlockAi}
          className="px-1 text-sm leading-none text-gulf-teal hover:text-[#17a3b3]"
        >
          ✦
        </button>
        {/* Fit content badge — only shown when content overflows the cell */}
        {overflows && onFit && (
          <button
            type="button"
            aria-label="Resize to fit content"
            title="Resize cell to fit content"
            onClick={() => {
              const el = contentRef.current;
              if (!el) return;
              const newH = Math.ceil(el.scrollHeight / GRID_ROW_HEIGHT) + 1;
              onFit(newH);
            }}
            className="px-1 text-[11px] leading-none text-amber-500 hover:text-amber-700"
          >
            ↕ Fit
          </button>
        )}
        {(block.type === "image" || block.type === "listing") && onEditPhoto && (
          <button
            type="button"
            aria-label="Change photo"
            title="Change photo"
            onClick={onEditPhoto}
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
            onClick={onDuplicate}
            className="px-1 text-sm leading-none text-gray-400 hover:text-gulf-teal"
          >
            ⧉
          </button>
        )}
        <button
          type="button"
          aria-label="Delete block"
          title={locked ? "Required (unsubscribe)" : "Delete"}
          onClick={onRemove}
          className={`px-1 text-sm leading-none ${
            locked ? "cursor-not-allowed text-gray-200" : "text-red-400 hover:text-red-600"
          }`}
        >
          ✕
        </button>
      </div>

      {/* content — measured for overflow */}
      <div ref={contentRef} className="pointer-events-none h-full">
        <BlockRenderer block={block} globalStyle={{} as never} />
      </div>
    </div>
  );
}
```

Note: `BlockRenderer` currently receives `globalStyle` from `doc.globalStyle`. Pass it through — add `globalStyle: EmailDoc["globalStyle"]` to `GridBlock`'s props and thread it from `GridCanvas`.

- [ ] **Step 2: Update `GridCanvas` to use `GridBlock` and expose `onFitBlock`**

Add `onFitBlock?: (id: string, newH: number) => void` to `GridCanvas` props interface.

Replace the inline block JSX in the `ReactGridLayout` children map with:

```tsx
{doc.blocks.map((block) => {
  const selected = block.id === selectedId;
  const locked = block.type === "footer" && block.layout?.static === true;
  return (
    <div key={block.id}>
      <GridBlock
        block={block}
        selected={selected}
        locked={locked}
        globalStyle={doc.globalStyle}
        onSelect={() => onSelectBlock(block.id)}
        onDuplicate={onDuplicate ? () => onDuplicate(block.id) : undefined}
        onRemove={() => remove(block.id)}
        onBlockAi={onBlockAi ? () => onBlockAi(block.id) : undefined}
        onEditPhoto={onEditPhoto ? () => onEditPhoto(block.id) : undefined}
        onFit={
          onFitBlock
            ? (newH) => onFitBlock(block.id, newH)
            : undefined
        }
      />
    </div>
  );
})}
```

Also add `import { useState, useRef, useLayoutEffect } from "react"` (replace existing `import { useMemo } from "react"`).

- [ ] **Step 3: Wire `onFitBlock` in `EmailLabGridShell`**

In `EmailLabGridShell.tsx`, add a `fitBlock` handler near the other block ops functions:

```tsx
function fitBlock(id: string, newH: number) {
  commit({
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (b.id !== id) return b;
      const cur = ensureLayout(b, doc.blocks);
      return { ...b, layout: { ...cur, h: newH } };
    }),
  });
}
```

Pass it to `GridCanvas`:

```tsx
<GridCanvas
  // ...existing props...
  onFitBlock={fitBlock}
/>
```

- [ ] **Step 4: Verify build**

```
bunx next build --no-lint 2>&1 | tail -10
```

Expected: build succeeds with no type errors.

- [ ] **Step 5: Manual smoke test**

Open `/email-lab/grid`. Add a text block with enough content to overflow the cell (make it short). Confirm the "↕ Fit" button appears and clicking it resizes the cell to show full content.

- [ ] **Step 6: Commit**

```bash
git add components/email-lab/GridCanvas.tsx components/email-lab/EmailLabGridShell.tsx
git commit -m "feat(email-lab): resize-to-fit content button on overflowing grid blocks"
```

---

### Task 2: Image drag-drop from filesystem to canvas

**Files:**
- 🔴 Modify: `components/email-lab/GridCanvas.tsx`
- 🔴 Modify: `components/email-lab/EmailLabGridShell.tsx`

**Interfaces:**
- Consumes: `uploadNewPhoto(file: File)` already in `EmailLabGridShell`
- Produces: New optional `GridCanvas` prop `onImageDrop?: (file: File) => void`; drag an image file from the OS onto the canvas to upload it

- [ ] **Step 1: Add drag-over visual + drop handler to `GridCanvas`**

Add `onImageDrop?: (file: File) => void` to `GridCanvas` props interface.

Add drag state and handlers inside `GridCanvas` function:

```tsx
const [dragOver, setDragOver] = useState(false);

function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
  if (!onImageDrop) return;
  const hasFile = Array.from(e.dataTransfer.types).includes("Files");
  if (!hasFile) return;
  e.preventDefault();
  setDragOver(true);
}

function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
  // Only clear if leaving the canvas entirely (not a child element)
  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
  setDragOver(false);
}

function handleDrop(e: React.DragEvent<HTMLDivElement>) {
  e.preventDefault();
  setDragOver(false);
  if (!onImageDrop) return;
  const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
  if (file) onImageDrop(file);
}
```

Attach to the outermost canvas `<div>`:

```tsx
<div
  className={`h-full overflow-y-auto bg-gray-100 px-4 py-8 transition-colors ${
    dragOver ? "bg-gulf-teal/10 outline-dashed outline-2 outline-gulf-teal/50" : ""
  }`}
  onClick={() => onSelectBlock(null)}
  onDragOver={handleDragOver}
  onDragLeave={handleDragLeave}
  onDrop={handleDrop}
>
```

- [ ] **Step 2: Wire into `EmailLabGridShell`**

Pass `onImageDrop` to `GridCanvas`:

```tsx
<GridCanvas
  // ...existing props...
  onImageDrop={(file) => void uploadNewPhoto(file)}
/>
```

`uploadNewPhoto` is already defined in the shell — no changes needed there.

- [ ] **Step 3: Verify build**

```
bunx next build --no-lint 2>&1 | tail -10
```

- [ ] **Step 4: Manual smoke**

Open `/email-lab/grid`. Drag an image file from Windows Explorer onto the canvas. Confirm the teal drop-zone highlight appears and, on drop, the image is uploaded and an image block is added to the grid.

- [ ] **Step 5: Commit**

```bash
git add components/email-lab/GridCanvas.tsx components/email-lab/EmailLabGridShell.tsx
git commit -m "feat(email-lab): drag image file from filesystem onto grid canvas"
```

---

### Task 3: Snap alignment guides during drag

**Files:**
- Create: `components/email-lab/SnapGuides.tsx`
- 🔴 Modify: `components/email-lab/GridCanvas.tsx`

**Interfaces:**
- Consumes: `GRID_WIDTH`, `GRID_COLS`, `GRID_ROW_HEIGHT`, `GRID_MARGIN` from `lib/email/grid-schema.ts`
- Produces: SVG overlay that draws green alignment lines when a dragged block's edges align with another block's edges (grid-unit equality)

**Column pixel math** (verified against react-grid-layout v2 source):
```
columnWidth = (GRID_WIDTH - (GRID_COLS + 1) * GRID_MARGIN[0]) / GRID_COLS
            = (600 - 13 * 8) / 12 = 496 / 12 ≈ 41.333
colToX(x)  = x * (columnWidth + GRID_MARGIN[0]) + GRID_MARGIN[0]
           = x * 49.333 + 8
rowToY(y)  = y * (GRID_ROW_HEIGHT + GRID_MARGIN[1]) + GRID_MARGIN[1]
           = y * 38 + 8
```

- [ ] **Step 1: Create `SnapGuides.tsx`**

```tsx
// components/email-lab/SnapGuides.tsx
import { GRID_COLS, GRID_MARGIN, GRID_ROW_HEIGHT, GRID_WIDTH } from "@/lib/email/grid-schema";

const COL_WIDTH = (GRID_WIDTH - (GRID_COLS + 1) * GRID_MARGIN[0]) / GRID_COLS;
const CELL_W = COL_WIDTH + GRID_MARGIN[0];
const CELL_H = GRID_ROW_HEIGHT + GRID_MARGIN[1];

function colToX(col: number) {
  return col * CELL_W + GRID_MARGIN[0];
}
function rowToY(row: number) {
  return row * CELL_H + GRID_MARGIN[1];
}

interface BlockBounds {
  id: string;
  x: number; // grid col
  y: number; // grid row
  w: number;
  h: number;
}

interface Props {
  dragging: BlockBounds; // the block being dragged
  others: BlockBounds[]; // all other blocks
  canvasHeight: number; // total scrollable canvas height in px (for line length)
}

export function SnapGuides({ dragging, others, canvasHeight }: Props) {
  const guides: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];

  const dLeft = dragging.x;
  const dRight = dragging.x + dragging.w;
  const dTop = dragging.y;
  const dBottom = dragging.y + dragging.h;

  for (const other of others) {
    if (other.id === dragging.id) continue;
    const oLeft = other.x;
    const oRight = other.x + other.w;
    const oTop = other.y;
    const oBottom = other.y + other.h;

    // Left edge aligns with other's left or right
    if (dLeft === oLeft) {
      const px = colToX(dLeft);
      guides.push({ key: `ll-${other.id}`, x1: px, y1: 0, x2: px, y2: canvasHeight });
    }
    if (dLeft === oRight) {
      const px = colToX(dLeft);
      guides.push({ key: `lr-${other.id}`, x1: px, y1: 0, x2: px, y2: canvasHeight });
    }
    // Right edge aligns
    if (dRight === oLeft) {
      const px = colToX(dRight);
      guides.push({ key: `rl-${other.id}`, x1: px, y1: 0, x2: px, y2: canvasHeight });
    }
    if (dRight === oRight) {
      const px = colToX(dRight);
      guides.push({ key: `rr-${other.id}`, x1: px, y1: 0, x2: px, y2: canvasHeight });
    }
    // Top edge aligns
    if (dTop === oTop || dTop === oBottom) {
      const py = rowToY(dTop);
      guides.push({ key: `tt-${other.id}`, x1: 0, y1: py, x2: GRID_WIDTH, y2: py });
    }
    // Bottom edge aligns
    if (dBottom === oTop || dBottom === oBottom) {
      const py = rowToY(dBottom);
      guides.push({ key: `bb-${other.id}`, x1: 0, y1: py, x2: GRID_WIDTH, y2: py });
    }
  }

  if (guides.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-30"
      width={GRID_WIDTH}
      height={canvasHeight}
      style={{ overflow: "visible" }}
    >
      {guides.map((g) => (
        <line
          key={g.key}
          x1={g.x1}
          y1={g.y1}
          x2={g.x2}
          y2={g.y2}
          stroke="#0ea5a5"
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.8}
        />
      ))}
    </svg>
  );
}
```

- [ ] **Step 2: Wire snap guides into `GridCanvas`**

Import `SnapGuides` and add dragging state to `GridCanvas`:

```tsx
import { SnapGuides } from "./SnapGuides";
import type { LayoutItem } from "react-grid-layout";

// Inside GridCanvas function, near other state:
const [draggingItem, setDraggingItem] = useState<LayoutItem | null>(null);
const canvasRef = useRef<HTMLDivElement>(null);
```

Add `onDragStart`, `onDrag`, `onDragStop` to `ReactGridLayout`:

```tsx
<ReactGridLayout
  // ...existing props...
  onDragStart={(_layout, _old, item) => setDraggingItem(item)}
  onDrag={(_layout, _old, item) => setDraggingItem({ ...item })}
  onDragStop={() => setDraggingItem(null)}
>
```

Wrap the `<div className="mx-auto w-[600px]...">` with a `ref` and add the overlay:

```tsx
<div ref={canvasRef} className="relative mx-auto w-[600px] max-w-full" onClick={(e) => e.stopPropagation()}>
  {draggingItem && (
    <SnapGuides
      dragging={draggingItem}
      others={layout.map((it) => ({ id: it.i, x: it.x, y: it.y, w: it.w, h: it.h }))}
      canvasHeight={canvasRef.current?.scrollHeight ?? 2000}
    />
  )}
  <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
    {/* ...ReactGridLayout and blocks... */}
  </div>
  {/* ...add block button... */}
</div>
```

- [ ] **Step 3: Write unit tests for SnapGuides alignment logic**

Create `components/email-lab/SnapGuides.test.tsx`:

```tsx
import { test, expect } from "bun:test";

// Test the pure alignment logic without rendering
// Extract the guide-computation logic to a pure function for testability

function computeGuides(
  dragging: { id: string; x: number; y: number; w: number; h: number },
  others: { id: string; x: number; y: number; w: number; h: number }[],
): string[] {
  const guides: string[] = [];
  const dLeft = dragging.x, dRight = dragging.x + dragging.w;
  const dTop = dragging.y, dBottom = dragging.y + dragging.h;
  for (const other of others) {
    if (other.id === dragging.id) continue;
    const oLeft = other.x, oRight = other.x + other.w;
    const oTop = other.y, oBottom = other.y + other.h;
    if (dLeft === oLeft) guides.push(`ll-${other.id}`);
    if (dLeft === oRight) guides.push(`lr-${other.id}`);
    if (dRight === oLeft) guides.push(`rl-${other.id}`);
    if (dRight === oRight) guides.push(`rr-${other.id}`);
    if (dTop === oTop || dTop === oBottom) guides.push(`tt-${other.id}`);
    if (dBottom === oTop || dBottom === oBottom) guides.push(`bb-${other.id}`);
  }
  return guides;
}

test("no guides when nothing aligns", () => {
  const dragging = { id: "a", x: 0, y: 0, w: 6, h: 4 };
  const others = [{ id: "b", x: 7, y: 5, w: 5, h: 4 }];
  expect(computeGuides(dragging, others)).toHaveLength(0);
});

test("left-left guide when left edges align", () => {
  const dragging = { id: "a", x: 0, y: 0, w: 6, h: 4 };
  const others = [{ id: "b", x: 0, y: 5, w: 4, h: 4 }];
  const guides = computeGuides(dragging, others);
  expect(guides).toContain("ll-b");
});

test("right-right guide when right edges align", () => {
  const dragging = { id: "a", x: 0, y: 0, w: 6, h: 4 }; // right = 6
  const others = [{ id: "b", x: 2, y: 5, w: 4, h: 4 }];  // right = 6
  expect(computeGuides(dragging, others)).toContain("rr-b");
});

test("top-top guide when tops align", () => {
  const dragging = { id: "a", x: 0, y: 3, w: 6, h: 4 };
  const others = [{ id: "b", x: 6, y: 3, w: 6, h: 4 }];
  expect(computeGuides(dragging, others)).toContain("tt-b");
});

test("skips self in others list", () => {
  const dragging = { id: "a", x: 0, y: 0, w: 6, h: 4 };
  const others = [{ id: "a", x: 0, y: 0, w: 6, h: 4 }];
  expect(computeGuides(dragging, others)).toHaveLength(0);
});
```

- [ ] **Step 4: Run tests**

```
bun test components/email-lab/SnapGuides.test.tsx 2>&1 | tail -10
```

Expected: all 5 tests pass.

- [ ] **Step 5: Build check**

```
bunx next build --no-lint 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add components/email-lab/SnapGuides.tsx components/email-lab/SnapGuides.test.tsx \
  components/email-lab/GridCanvas.tsx
git commit -m "feat(email-lab): snap alignment guides SVG overlay during block drag"
```

---

### Task 4: Double-click inline text editing

**Files:**
- Create: `components/email-lab/InlineTextEditor.tsx`
- 🔴 Modify: `components/email-lab/GridCanvas.tsx`
- 🔴 Modify: `components/email-lab/EmailLabGridShell.tsx`

**Interfaces:**
- Consumes: `block.props` field keyed by block type (see constraint table below)
- Produces: New optional `GridCanvas` prop `onInlineEdit?: (id: string, field: string, value: string) => void`; double-clicking a text-type block shows a `position: fixed` textarea overlay

**Inline-editable block fields:**

| `block.type` | `field`    | `block.props` key |
|--------------|------------|-------------------|
| `text`       | `content`  | `content`         |
| `hero`       | `headline` | `headline`        |
| `header`     | `title`    | `title`           |
| `signal`     | `label`    | `label`           |

Other types: double-click is a no-op (falls through to single-click select).

- [ ] **Step 1: Create `InlineTextEditor.tsx`**

```tsx
// components/email-lab/InlineTextEditor.tsx
"use client";

import { useEffect, useRef } from "react";

interface Props {
  value: string;
  rect: DOMRect; // position of the block in viewport coords
  onCommit: (newValue: string) => void;
  onClose: () => void;
}

export function InlineTextEditor({ value, rect, onCommit, onClose }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  function commit() {
    const val = ref.current?.value ?? value;
    onCommit(val);
    onClose();
  }

  return (
    <>
      {/* backdrop — click outside to commit */}
      <div className="fixed inset-0 z-40" onClick={commit} />
      <textarea
        ref={ref}
        defaultValue={value}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
          if (e.key === "Escape") { onClose(); }
        }}
        style={{
          position: "fixed",
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: Math.max(rect.height, 48),
          zIndex: 41,
        }}
        className="resize-none rounded border-2 border-gulf-teal bg-white px-3 py-2 text-sm text-gray-900 shadow-lg focus:outline-none"
      />
    </>
  );
}
```

- [ ] **Step 2: Add inline edit state + `onInlineEdit` prop to `GridCanvas`**

Import `InlineTextEditor` in `GridCanvas.tsx`.

Add to `GridCanvas` props:
```tsx
onInlineEdit?: (id: string, field: string, value: string) => void;
```

Add state inside `GridCanvas`:
```tsx
const [inlineEdit, setInlineEdit] = useState<{
  id: string;
  field: string;
  value: string;
  rect: DOMRect;
} | null>(null);
```

Define the editable field map:
```tsx
const INLINE_FIELDS: Partial<Record<string, string>> = {
  text: "content",
  hero: "headline",
  header: "title",
  signal: "label",
};
```

Add `onDoubleClick` to each block in the map. Inside the `<div key={block.id}>` RGL child, add a `onDoubleClick` on the inner wrapper (the one with `onSelect`). Update `GridBlock` to accept and forward an `onDoubleClick` prop:

In `GridBlock` props, add:
```tsx
onDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
```

Apply it to the root div of `GridBlock`:
```tsx
<div
  onClick={onSelect}
  onDoubleClick={onDoubleClick}
  className={`group relative h-full w-full ...`}
>
```

In the `GridCanvas` block map, pass:
```tsx
onDoubleClick={
  onInlineEdit && INLINE_FIELDS[block.type]
    ? (e) => {
        e.stopPropagation();
        const field = INLINE_FIELDS[block.type]!;
        const props = block.props as Record<string, unknown>;
        const currentValue = typeof props[field] === "string" ? (props[field] as string) : "";
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setInlineEdit({ id: block.id, field, value: currentValue, rect });
      }
    : undefined
}
```

Render the overlay after the `ReactGridLayout` close tag, inside the canvas container:
```tsx
{inlineEdit && (
  <InlineTextEditor
    value={inlineEdit.value}
    rect={inlineEdit.rect}
    onCommit={(newValue) => {
      onInlineEdit?.(inlineEdit.id, inlineEdit.field, newValue);
    }}
    onClose={() => setInlineEdit(null)}
  />
)}
```

- [ ] **Step 3: Wire `onInlineEdit` in `EmailLabGridShell`**

Add a handler in `EmailLabGridShell`:

```tsx
function handleInlineEdit(id: string, field: string, value: string) {
  const block = doc.blocks.find((b) => b.id === id);
  if (!block) return;
  commit({
    ...doc,
    blocks: doc.blocks.map((b) =>
      b.id === id
        ? ({ ...b, props: { ...(b.props as Record<string, unknown>), [field]: value } } as EmailBlock)
        : b,
    ),
  });
}
```

Pass to `GridCanvas`:
```tsx
<GridCanvas
  // ...existing props...
  onInlineEdit={handleInlineEdit}
/>
```

- [ ] **Step 4: Build check**

```
bunx next build --no-lint 2>&1 | tail -10
```

- [ ] **Step 5: Manual smoke**

Open `/email-lab/grid`. Double-click a header or text block. Confirm the textarea overlay appears, pre-filled with current text. Edit and press Enter. Confirm the block updates and undo (⌘Z) reverts.

- [ ] **Step 6: Commit**

```bash
git add components/email-lab/InlineTextEditor.tsx components/email-lab/GridCanvas.tsx \
  components/email-lab/EmailLabGridShell.tsx
git commit -m "feat(email-lab): double-click inline text editing overlay on text/hero/header/signal blocks"
```

---

### Task 5: Block layers panel

**Files:**
- Create: `components/email-lab/LayersPanel.tsx`
- 🔴 Modify: `components/email-lab/EmailLabGridShell.tsx`

**Interfaces:**
- Consumes: `@dnd-kit/core`, `@dnd-kit/sortable` (already in `package.json`)
- Produces: "Layers" accordion in the right panel with a `DndContext`/`SortableContext` list; dragging reorders `doc.blocks`; clicking selects the block on the canvas

**dnd-kit API surface used:**
- `DndContext` (from `@dnd-kit/core`) — drag context with `onDragEnd`
- `SortableContext` (from `@dnd-kit/sortable`) — provides sortable list
- `useSortable` (from `@dnd-kit/sortable`) — per-item hook
- `verticalListSortingStrategy` (from `@dnd-kit/sortable`) — strategy
- `arrayMove` (from `@dnd-kit/sortable`) — reorders array

- [ ] **Step 1: Create `LayersPanel.tsx`**

```tsx
// components/email-lab/LayersPanel.tsx
"use client";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { EmailBlock } from "@/lib/email/doc/types";

const TYPE_ICONS: Partial<Record<EmailBlock["type"], string>> = {
  header: "◼",
  hero: "★",
  stats: "▦",
  signal: "◈",
  text: "¶",
  image: "▣",
  listing: "⌂",
  "multi-column": "⬛",
  "agent-card": "◉",
  "agent-hero": "◎",
  "social-icons": "⊕",
  button: "▶",
  divider: "—",
  footer: "◻",
};

const TYPE_LABELS: Partial<Record<EmailBlock["type"], string>> = {
  header: "Header",
  hero: "Big Number",
  stats: "Stats",
  signal: "Callout",
  text: "Text",
  image: "Image",
  listing: "Listing",
  "multi-column": "Columns",
  "agent-card": "Agent Card",
  "agent-hero": "Agent Feature",
  "social-icons": "Social Icons",
  button: "Button",
  divider: "Divider",
  footer: "Footer",
};

function SortableLayer({
  block,
  selected,
  onSelect,
}: {
  block: EmailBlock;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
        isDragging ? "opacity-50" : ""
      } ${
        selected
          ? "border-gulf-teal/60 bg-gulf-teal/10"
          : "border-white/8 bg-white/4 hover:bg-white/8"
      }`}
    >
      {/* drag handle */}
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab select-none text-white/25 hover:text-white/50 active:cursor-grabbing"
        title="Drag to reorder"
      >
        ⠿
      </span>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <span className="w-4 text-center text-[11px] leading-none text-white/35">
          {TYPE_ICONS[block.type] ?? "□"}
        </span>
        <span className="truncate text-[11px] font-medium text-white/65">
          {TYPE_LABELS[block.type] ?? block.type}
        </span>
      </button>
    </div>
  );
}

interface Props {
  blocks: EmailBlock[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (blocks: EmailBlock[]) => void;
}

export function LayersPanel({ blocks, selectedId, onSelect, onReorder }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = blocks.findIndex((b) => b.id === active.id);
    const newIndex = blocks.findIndex((b) => b.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(blocks, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        <div className="mt-2 space-y-1">
          {blocks.map((block) => (
            <SortableLayer
              key={block.id}
              block={block}
              selected={block.id === selectedId}
              onSelect={() => onSelect(block.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
```

- [ ] **Step 2: Add the "Layers" accordion to `EmailLabGridShell` right panel**

Import `LayersPanel` at the top of `EmailLabGridShell.tsx`:
```tsx
import { LayersPanel } from "./LayersPanel";
```

Add `showLayers` state:
```tsx
const [showLayers, setShowLayers] = useState(false);
```

Add a `reorderBlocks` handler near other block ops:
```tsx
function reorderBlocks(reordered: EmailBlock[]) {
  commit({ ...doc, blocks: reordered });
}
```

Add the "Layers" accordion to the right panel JSX, BEFORE the "Add a block" section:

```tsx
{/* ── Layers ── */}
<div className="border-b border-white/8 px-4 pb-4 pt-3">
  <button
    onClick={() => setShowLayers((v) => !v)}
    className="flex w-full items-center justify-between py-1 text-[10px] uppercase tracking-[0.15em] text-white/35 hover:text-white/60"
  >
    <span>Layers</span>
    <span className={`transition-transform ${showLayers ? "rotate-180" : ""}`}>▾</span>
  </button>
  {showLayers && (
    <LayersPanel
      blocks={doc.blocks}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onReorder={reorderBlocks}
    />
  )}
</div>
```

- [ ] **Step 3: Build check**

```
bunx next build --no-lint 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Manual smoke**

Open `/email-lab/grid`. Open the "Layers" accordion. Confirm all blocks appear. Click a block in the list — confirm it becomes selected on the canvas. Drag a layer row to a new position — confirm the canvas reorders the blocks and undo (⌘Z) reverts.

- [ ] **Step 5: Commit**

```bash
git add components/email-lab/LayersPanel.tsx components/email-lab/EmailLabGridShell.tsx
git commit -m "feat(email-lab): block layers panel — drag-sortable list in right sidebar"
```

---

## Self-Review

**Spec coverage:**
- Resize-to-fit → Task 1 ✓
- Image drag-drop → Task 2 ✓
- Snap alignment guides → Task 3 ✓
- Inline text editing → Task 4 ✓
- Block layers panel → Task 5 ✓

**Placeholder scan:** None. All steps contain actual code.

**Type consistency:**
- `GridBlock` accepts `globalStyle: EmailDoc["globalStyle"]` in Task 1 — pass it from `GridCanvas` in all block renders ✓
- `onFitBlock?: (id: string, newH: number) => void` defined in Task 1, wired in shell in Task 1 ✓
- `onImageDrop?: (file: File) => void` defined in Task 2, wired in shell in Task 2 ✓
- `onInlineEdit?: (id: string, field: string, value: string) => void` defined in Task 4, wired in shell in Task 4 ✓
- `INLINE_FIELDS` uses `block.type` string keys — matches `EmailBlock["type"]` union ✓
- `LayersPanel` `onReorder: (blocks: EmailBlock[]) => void` matches `reorderBlocks` in shell ✓
- `DragEndEvent` imported from `@dnd-kit/core` — `active.id` and `over.id` are `UniqueIdentifier` (string | number); `block.id` is always string — comparison `active.id === over.id` is safe ✓

**Gap check:**
- `GridBlock` in Task 1 must receive `globalStyle` — add it to the `GridBlock` props and thread it through `GridCanvas`'s map call. This is noted in Task 1 Step 1 but must not be omitted during implementation.
- `import { useState, useRef, useLayoutEffect } from "react"` must replace `import { useMemo } from "react"` in `GridCanvas.tsx` — `useMemo` is still needed for `buildLayout`, so the final import is: `import { useState, useRef, useLayoutEffect, useMemo } from "react"`.

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 1, Task 2, Task 3, Task 4, Task 5 | `components/email-lab/GridCanvas.tsx`, `components/email-lab/EmailLabGridShell.tsx` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
