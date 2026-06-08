"use client";

import type { FactType, SelectedFact } from "@/lib/highlighter/use-highlight";

/**
 * An inline, tappable figure or place. Looks tappable (dotted teal underline +
 * a faint hover background) so a phone user knows it's interactive — text
 * selection is the desktop affordance; this is the touch one. On click/tap it
 * hands the popup a synthetic SelectedFact built from its own bounding rect.
 */
export function FactChip({
  value,
  factType,
  onActivate,
}: {
  value: string;
  factType: FactType;
  onActivate: (fact: SelectedFact) => void;
}) {
  return (
    <button
      type="button"
      data-highlighter-chip=""
      onClick={(e) =>
        onActivate({
          text: value,
          rect: e.currentTarget.getBoundingClientRect(),
          factType,
          mode: "fact",
        })
      }
      className="cursor-pointer rounded-sm underline decoration-dotted decoration-[#00d4aa]/50 underline-offset-2 transition-colors hover:bg-[#00d4aa]/10 hover:decoration-[#00d4aa] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#00d4aa]/60"
      title="Tap to ask about this"
    >
      {value}
    </button>
  );
}
