"use client";
// components/email-lab/BlockCanvas.tsx (Card 33 + Card 50) — the right-hand canvas.
// CONTROLLED: the client owns doc + history + selection; this renders the 600px
// column, owns add/insert/delete/reorder doc-mutations, and reports selection.
// Drag-to-reorder via @dnd-kit (Card 50): a PointerSensor with an 8px activation
// distance so a click selects and only a real drag reorders (vendor-verified).
import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { BlockType, EmailDoc } from "@/lib/email/doc/types";
import { createBlock } from "@/lib/email/doc/default-docs";
import { CanvasBlock } from "./CanvasBlock";
import { AddBlockPanel } from "./AddBlockPanel";

export function BlockCanvas({
  doc,
  selectedId,
  onSelectBlock,
  onChangeDoc,
}: {
  doc: EmailDoc;
  selectedId: string | null;
  onSelectBlock: (id: string | null) => void;
  onChangeDoc: (next: EmailDoc) => void;
}) {
  // local UI state: which insert slot's palette is open (index), or null
  const [addAt, setAddAt] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function insert(type: BlockType, index: number) {
    const blocks = [...doc.blocks];
    blocks.splice(index, 0, createBlock(type));
    onChangeDoc({ ...doc, blocks });
    setAddAt(null);
  }

  function remove(id: string) {
    if (doc.blocks.length <= 1) return;
    onChangeDoc({ ...doc, blocks: doc.blocks.filter((b) => b.id !== id) });
    if (selectedId === id) onSelectBlock(null);
  }

  function handleDragOver(e: DragOverEvent) {
    setDragOverId(e.over?.id?.toString() ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setDragOverId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = doc.blocks.findIndex((b) => b.id === active.id);
    const newIndex = doc.blocks.findIndex((b) => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChangeDoc({ ...doc, blocks: arrayMove(doc.blocks, oldIndex, newIndex) });
  }

  const dragOverIndex = dragOverId ? doc.blocks.findIndex((b) => b.id === dragOverId) : -1;

  return (
    <div
      className="h-full overflow-y-auto bg-gray-100 px-4 py-8"
      onClick={() => onSelectBlock(null)}
    >
      <div className="mx-auto w-[600px] max-w-full" onClick={(e) => e.stopPropagation()}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragOverId(null)}
        >
          <SortableContext
            items={doc.blocks.map((b) => b.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
              {doc.blocks.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-gray-400">
                  Your email is empty — add a block below.
                </div>
              ) : (
                doc.blocks.map((block, i) => (
                  <div key={block.id}>
                    <InsertSlot
                      isDragTarget={dragOverIndex === i}
                      open={addAt === i}
                      onOpen={() => setAddAt(i)}
                      onClose={() => setAddAt(null)}
                      onAdd={(t) => insert(t, i)}
                    />
                    <CanvasBlock
                      block={block}
                      globalStyle={doc.globalStyle}
                      selected={block.id === selectedId}
                      onSelect={() => onSelectBlock(block.id)}
                      onDelete={() => remove(block.id)}
                    />
                  </div>
                ))
              )}
              <InsertSlot
                atEnd
                open={addAt === doc.blocks.length}
                onOpen={() => setAddAt(doc.blocks.length)}
                onClose={() => setAddAt(null)}
                onAdd={(t) => insert(t, doc.blocks.length)}
              />
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

function InsertSlot({
  open,
  onOpen,
  onClose,
  onAdd,
  atEnd = false,
  isDragTarget = false,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAdd: (type: BlockType) => void;
  atEnd?: boolean;
  isDragTarget?: boolean;
}) {
  if (atEnd) {
    return (
      <div className="relative">
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={onClose} />
            <div className="absolute left-1/2 top-1 z-20 -translate-x-1/2">
              <AddBlockPanel onAdd={onAdd} onClose={onClose} />
            </div>
          </>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center justify-center gap-1.5 border-t border-dashed border-[#1BB8C9]/30 py-3 text-sm text-[#1BB8C9] transition-all duration-150 ease-out hover:bg-[#1BB8C9]/10"
        >
          <span className="text-base leading-none">+</span> Add block
        </button>
      </div>
    );
  }

  return (
    <div
      className={[
        "group relative transition-all duration-150 ease-out",
        isDragTarget
          ? "h-10 bg-[#1BB8C9]/20"
          : open
            ? "h-10 bg-[#1BB8C9]/10"
            : "h-2 border-t border-[#1BB8C9]/25 hover:h-10 hover:bg-[#1BB8C9]/10",
      ].join(" ")}
    >
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} />
          <div className="absolute left-1/2 top-1 z-20 -translate-x-1/2">
            <AddBlockPanel onAdd={onAdd} onClose={onClose} />
          </div>
        </>
      )}
      {isDragTarget && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-[#1BB8C9]" />
      )}
      <button
        type="button"
        onClick={onOpen}
        aria-label={isDragTarget ? "Drop here" : "Add block"}
        className="flex h-full w-full items-center justify-center"
      >
        {!isDragTarget && (
          <span className="flex items-center gap-1 rounded-full border border-[#1BB8C9] bg-white px-3 py-1 text-sm text-[#1BB8C9] opacity-0 transition-opacity group-hover:opacity-100">
            + Add block
          </span>
        )}
      </button>
    </div>
  );
}
