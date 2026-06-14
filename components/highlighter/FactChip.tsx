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
  context,
  slug,
  onActivate,
}: {
  value: string;
  factType: FactType;
  /** Row-level label from the nearest metric row (e.g. "Unemployment Rate").
   *  Populates SelectedFact.context so the popup can show
   *  "Unemployment Rate — 3.2%" instead of the bare figure. */
  context?: string;
  /** Metric slug for this figure, when known — lets the converse server resolve
   *  the authored methodology entry. Undefined for chips with no documented method. */
  slug?: string;
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
          context,
          slug,
          mode: "fact",
        })
      }
      // py-1 ensures ≥44px tap target height on mobile (WCAG 2.5.5).
      className="cursor-pointer rounded-sm px-0.5 py-1 underline decoration-dotted decoration-[#0a8078]/50 underline-offset-2 transition-colors hover:bg-[#0a8078]/10 hover:decoration-[#0a8078] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0a8078]/60"
      title="Tap to ask about this"
    >
      {value}
    </button>
  );
}
