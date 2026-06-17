"use client";

import { useState } from "react";
import type { ProjectItem } from "@/lib/project/items";
import { summarizeItem } from "@/lib/project/summarize-item";
import { ItemDetail } from "./ItemDetail";
import type { SavedChart } from "./types";

/**
 * One compact, click-to-expand card per filed item: a one-line `summarizeItem`
 * subtitle + origin badge + move/remove controls; clicking the row expands the
 * full `ItemDetail`. Cross-build contract: P2 hangs prompt affordances here, P4
 * hangs edit controls. Expand state is local (lazy useState, event-driven — never
 * a props→state effect).
 */
export function ItemCard({
  item,
  charts,
  fileUrls,
  localPreviews,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  item: ProjectItem;
  charts: Record<string, SavedChart>;
  fileUrls: Record<string, string>;
  localPreviews: Record<string, string>;
  isFirst: boolean;
  isLast: boolean;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-white/10 bg-[#0d1e2b]/80">
      <div className="flex items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-xs text-gray-500">{open ? "▾" : "▸"}</span>
          <span className="truncate text-sm text-white">{summarizeItem(item)}</span>
          {item.origin === "mcp" && (
            <span
              className="shrink-0 rounded-full border border-[#00d4aa]/40 px-1.5 py-0.5 text-[9px] font-medium text-[#00d4aa]"
              title="Filed by your connected AI"
            >
              via AI
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-2 text-xs text-gray-400">
          <button
            type="button"
            onClick={() => onMove(item.id, -1)}
            disabled={isFirst}
            className="disabled:opacity-30"
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(item.id, 1)}
            disabled={isLast}
            className="disabled:opacity-30"
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="text-red-400 hover:text-red-300"
            aria-label="Remove"
          >
            Remove
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-white/5 p-3">
          <ItemDetail
            item={item}
            charts={charts}
            fileUrls={fileUrls}
            localPreviews={localPreviews}
          />
        </div>
      )}
    </li>
  );
}
