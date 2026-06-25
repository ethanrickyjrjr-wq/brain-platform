"use client";
// components/email-lab/AddBlockPanel.tsx (Card 32) — the 10-type mini palette.
import type { BlockType } from "@/lib/email/doc/types";

const BLOCK_MENU: { type: BlockType; label: string; icon: string }[] = [
  { type: "header", label: "Header", icon: "▦" },
  { type: "hero", label: "Big Number", icon: "◆" },
  { type: "stats", label: "Stats", icon: "▣" },
  { type: "signal", label: "Callout", icon: "❖" },
  { type: "text", label: "Text", icon: "¶" },
  { type: "image", label: "Image", icon: "▢" },
  { type: "agent-card", label: "Agent Card", icon: "☻" },
  { type: "agent-hero", label: "Agent Feature", icon: "◧" },
  { type: "button", label: "Button", icon: "▭" },
  { type: "divider", label: "Divider", icon: "—" },
  { type: "footer", label: "Footer", icon: "▤" },
];

export function AddBlockPanel({
  onAdd,
  onClose,
}: {
  onAdd: (type: BlockType) => void;
  onClose?: () => void;
}) {
  return (
    <div className="grid w-56 grid-cols-2 gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
      {BLOCK_MENU.map((b) => (
        <button
          key={b.type}
          type="button"
          onClick={() => onAdd(b.type)}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
        >
          <span className="w-4 text-center text-gray-400">{b.icon}</span>
          {b.label}
        </button>
      ))}
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="col-span-2 mt-1 rounded px-2 py-1 text-center text-xs text-gray-400 hover:bg-gray-100"
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}
