"use client";

import { useState } from "react";
import {
  useHighlight,
  type SelectedFact,
} from "@/lib/highlighter/use-highlight";
import { suggestionsForMetric } from "@/lib/highlighter/suggestions";
import { HighlightPopup } from "./HighlightPopup";
import { FirstTouchHint } from "./FirstTouchHint";
import { DiscoveryTicker } from "./DiscoveryTicker";
import { AskAi } from "./AskAi";

interface LayerProps {
  reportId: string;
  conclusion?: string;
  freshnessToken?: string;
}

/**
 * The single mount point for the Highlighter on a /r/ report page. It is a
 * SIBLING of the report content (never a wrapper), so if anything in here
 * throws, the report itself is already painted and unaffected. It listens for
 * text selection (and FactChip taps, via the same `onActivate` shape) and shows
 * the popup anchored to the selection.
 */
export function HighlighterLayer({
  reportId,
  conclusion,
  freshnessToken,
}: LayerProps) {
  const { fact: selectedFact, clear } = useHighlight();
  // A chip tap can override the text-selection fact; track it separately and
  // prefer it when present.
  const [chipFact, setChipFact] = useState<SelectedFact | null>(null);

  const fact = chipFact ?? selectedFact;

  function close() {
    setChipFact(null);
    clear();
    // Drop any lingering native selection so it can't immediately re-open.
    if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
  }

  // Always-on surfaces (coachmark, ambient ticker, Ask-AI dock) render as
  // siblings regardless of selection; the figure popup is conditional on a fact.
  return (
    <>
      {fact && (
        <HighlightPopup
          reportId={reportId}
          fact={fact}
          suggestions={suggestionsForMetric(
            { metric: fact.text, value: fact.text },
            reportId,
          )}
          conclusion={conclusion}
          freshnessToken={freshnessToken}
          onClose={close}
        />
      )}
      <FirstTouchHint />
      <DiscoveryTicker />
      <AskAi
        reportId={reportId}
        conclusion={conclusion}
        freshnessToken={freshnessToken}
      />
    </>
  );
}
