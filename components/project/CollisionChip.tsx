"use client";
import type { SignificantChange } from "@/lib/signals/types";
import { collisionChipText } from "./collision-copy";

export function CollisionChip({
  change,
  confirming,
  onKeepMine,
}: {
  change: SignificantChange;
  confirming: boolean;
  onKeepMine: () => void;
}) {
  return (
    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200">
      <p>{collisionChipText(change)}</p>
      <button
        type="button"
        onClick={onKeepMine}
        disabled={confirming}
        className="mt-1 rounded border border-amber-400/40 px-2 py-0.5 text-amber-100 hover:bg-amber-400/10 disabled:opacity-50"
      >
        {confirming ? "Saving…" : "Keep mine"}
      </button>
    </div>
  );
}
