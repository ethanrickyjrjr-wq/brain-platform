# Email Lab — Insert Slot UX: Expanding Seam Design

**Date:** 2026-06-24  
**Status:** Approved for implementation  
**Files in scope:** `components/email-lab/BlockCanvas.tsx` (InsertSlot + BlockCanvas)

---

## Problem

The between-block insert slots in the Email Lab canvas are effectively invisible. The current implementation is a 12px (`h-3`) div with a `+` circle at `opacity-0` that only appears on `group-hover`. Users have to know to look for it. Competitor (RGE) uses persistent, visually prominent drop zones. Our gap is affordance, not feature scope.

---

## Solution: Expanding Seam (Approach A)

A thin branded seam is always visible between blocks. Hovering the slot expands it into a full-width insert target. Dragging a block illuminates the nearest landing slot as a magnetic drop zone.

Color palette: `#1BB8C9` (teal) — already used for selection rings and the existing `+` circle.

---

## Visual States

### At rest
- Height: `h-2` (8px) — small but hittable; current `h-3` (12px) is unchanged as a minimum, `h-2` is the target
- A 1px horizontal rule at `border-t border-[#1BB8C9]/25` — quiet hint that the seam exists
- No text, no button visible

### Hover (click-to-insert)
- Expands to `h-10` (40px) via `transition-all duration-150 ease-out`
- Background: `bg-[#1BB8C9]/10`
- Centered pill: `+ Add block` label, `text-[#1BB8C9]`, white bg with teal border
- Cursor: `cursor-pointer`
- Clicking opens `AddBlockPanel` (unchanged behavior)

### Drag active — drop indicator (`isDragTarget === true`)
- Expands to `h-10`, background: `bg-[#1BB8C9]/20` (slightly louder than hover)
- Full-width 2px `bg-[#1BB8C9]` bar (no text — different action from click-insert)
- `aria-label="Drop here"`

### `atEnd` slot
- Keeps dashed border + "Add block" text
- Updated to teal palette: `border-[#1BB8C9]/30`, `text-[#1BB8C9]`
- Gets same `h-10` hover expansion and `bg-[#1BB8C9]/10` hover fill
- No drag-indicator state needed (always the last position)

---

## Component Changes

### `InsertSlot` (inside `BlockCanvas.tsx`)

Add `isDragTarget: boolean` prop.

Remove:
- `opacity-0` + tiny `+` circle pattern
- `group` wrapper (hover is now on the slot div itself)

Add:
- `h-2` rest height with `border-t border-[#1BB8C9]/25`
- `hover:h-10 hover:bg-[#1BB8C9]/10` expansion
- When `isDragTarget`: `h-10 bg-[#1BB8C9]/20` + 2px bar, `aria-label="Drop here"`
- When hovered (not drag): centered `+ Add block` pill
- `transition-all duration-150 ease-out` on the slot container

### `BlockCanvas.tsx`

Add `dragOverId` state (`string | null`, default `null`).

Add `onDragOver` handler:
```ts
function handleDragOver(e: DragOverEvent) {
  setDragOverId(e.over?.id?.toString() ?? null);
}
```

Wire to `DndContext`:
```tsx
<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
  onDragCancel={() => setDragOverId(null)}
>
```

Derive slot index:
```ts
const dragOverIndex = dragOverId
  ? doc.blocks.findIndex((b) => b.id === dragOverId)
  : -1;
```

Pass to each `InsertSlot`:
```tsx
<InsertSlot
  isDragTarget={dragOverIndex === i}
  ...
/>
```

Clear on end: `handleDragEnd` already calls `onChangeDoc` — add `setDragOverId(null)` there too.

**Note on directionality:** `dragOverIndex === i` illuminates the slot above the hovered block. This is directionally approximate — dnd-kit's `verticalListSortingStrategy` already reshuffles blocks in real-time during drag (the precise position feedback). The slot glow is supplementary magnetism, not the source of truth. Do not over-engineer Y-position split logic.

### `CanvasBlock.tsx`
No changes.

### `AddBlockPanel.tsx`
No changes.

---

## Edge Cases

| Case | Behavior |
|---|---|
| Drag cancelled (pointer leaves canvas) | `onDragCancel` → `setDragOverId(null)` → all slots return to rest |
| Single block on canvas | Only `atEnd` slot visible; between-block slots don't render — no change |
| AddBlockPanel positioning | Panel anchors `absolute top-1` inside expanded slot — same as today, more room |
| Slot at index 0 (above first block) | Receives `isDragTarget` when dragging over `blocks[0]` — same treatment |

---

## Accessibility

- `button` element preserved — screen readers continue to read "Add block"
- `isDragTarget` state changes `aria-label` to `"Drop here"`
- No keyboard behavior changes

---

## Transition spec

```
transition-all duration-150 ease-out
```

150ms is above NNGroup's 100ms drag guideline but appropriate for a click-triggered expand. Fast enough to feel snappy, slow enough to read as intentional.

---

## What this does NOT change

- Row/column layout support — not on roadmap
- Mobile preview — not on roadmap
- `AddBlockPanel` block types or order
- Drag-to-reorder physics (dnd-kit handles that)
- The `atEnd` "Add block" button's core behavior

---

## Success criteria

1. A first-time user can find and use an insert slot between two existing blocks without instruction
2. During drag-to-reorder, the landing zone is visually obvious before the block is released
3. `bun test` passes unchanged
4. `bunx next build` clean
