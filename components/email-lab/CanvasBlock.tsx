"use client";
// components/email-lab/CanvasBlock.tsx (Card 30 + Card 50)
// Client wrapper around a PURE block: selection ring + hover delete + drag
// handle. Drag is via @dnd-kit/sortable (Card 50); the handle carries the drag
// listeners so clicking the block body still selects. Must render inside the
// SortableContext that BlockCanvas provides.
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { EmailBlock, EmailGlobalStyle } from "@/lib/email/doc/types";
import { BlockRenderer } from "@/lib/email/blocks/BlockRenderer";

export function CanvasBlock({
  block,
  globalStyle,
  selected,
  onSelect,
  onDelete,
}: {
  block: EmailBlock;
  globalStyle: EmailGlobalStyle;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`group relative cursor-pointer transition-shadow ${
        selected
          ? "ring-2 ring-inset ring-[#1BB8C9]"
          : "ring-1 ring-inset ring-transparent hover:ring-gray-300"
      }`}
    >
      {/* drag handle — carries the dnd listeners so the body click still selects */}
      <div
        {...attributes}
        {...listeners}
        role="button"
        aria-label="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
        className="absolute left-1 top-2 z-10 cursor-grab select-none px-1 text-base leading-none text-gray-300 opacity-0 hover:text-gray-500 group-hover:opacity-100 active:cursor-grabbing"
      >
        ⠿
      </div>
      <button
        type="button"
        aria-label="Delete block"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="absolute right-2 top-2 z-10 rounded bg-white/90 px-1.5 py-0.5 text-sm leading-none text-red-500 opacity-0 shadow-sm hover:bg-white group-hover:opacity-100"
      >
        ✕
      </button>
      {/* pointer-events off on the pure block so the wrapper owns the click */}
      <div className="pointer-events-none">
        <BlockRenderer block={block} globalStyle={globalStyle} />
      </div>
    </div>
  );
}
