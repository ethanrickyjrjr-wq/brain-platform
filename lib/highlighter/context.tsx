"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { SelectedFact } from "./use-highlight";

/**
 * Thin context that lets FactChip instances anywhere in the /r/ report tree
 * feed a chip-tap into the HighlighterLayer without prop-threading through
 * server-component pages.
 *
 * Usage:
 *   - Server page wraps its content in <HighlighterProvider> (exported below).
 *     The provider holds chipFact state and exposes onActivate via context.
 *   - HighlighterLayer reads chipFact from context instead of its own useState.
 *   - MetricsTable (client component) reads onActivate via useHighlighterContext
 *     and passes it to FactChip.
 *
 * When the Highlighter flag is off the provider is not rendered at all (the
 * flag gate lives in the server page), so FactChips won't be mounted.
 */
export interface HighlighterContextValue {
  chipFact: SelectedFact | null;
  setChipFact: (fact: SelectedFact | null) => void;
  onActivate: (fact: SelectedFact) => void;
}

export const HighlighterContext = createContext<HighlighterContextValue | null>(null);

/** Returns the context value, or null when no provider is in the tree. */
export function useHighlighterContext(): HighlighterContextValue | null {
  return useContext(HighlighterContext);
}

/**
 * Client-side state owner for the HighlighterLayer. Wrap the report content
 * (including both MetricsTable and HighlighterLayer) with this so both sides
 * share the same chipFact state and onActivate handler via context.
 *
 * In Next.js App Router, a server component CAN pass server-rendered children
 * to a client component — the children prop is serialized as an RSC payload.
 */
export function HighlighterProvider({ children }: { children: ReactNode }) {
  const [chipFact, setChipFact] = useState<SelectedFact | null>(null);
  const onActivate = useCallback((f: SelectedFact) => setChipFact(f), []);
  return (
    <HighlighterContext.Provider value={{ chipFact, setChipFact, onActivate }}>
      {children}
    </HighlighterContext.Provider>
  );
}
