"use client";

import { useState } from "react";
import { useHighlight, type SelectedFact } from "@/lib/highlighter/use-highlight";
import { suggestionsForMetric } from "@/lib/highlighter/suggestions";
import { HighlightPopup } from "./HighlightPopup";
import { FirstTouchHint } from "./FirstTouchHint";
import { DiscoveryTicker } from "./DiscoveryTicker";
import { AskAi } from "./AskAi";

/** One metric's dossier-carried, precomputed suggested questions, keyed by its
 *  human label (matched against the selected fact's row context). */
export interface MetricSuggestion {
  label: string;
  suggestions: string[];
}

interface LayerProps {
  reportId: string;
  conclusion?: string;
  freshnessToken?: string;
  /**
   * Precomputed suggestions carried in the dossier and rendered into the page
   * (`DisplayMetric.suggestions`). The popup prefers these over the client
   * `suggestionsForMetric` fallback so the chips match what the build generated.
   * Optional/empty when the brain predates the suggestions type-lift.
   */
  metricSuggestions?: MetricSuggestion[];
}

/**
 * Pick the dossier-carried suggestions for the selected fact by matching its
 * row context (the table's metric label) to a carried metric label. Falls back
 * to the client `suggestionsForMetric` generator when there is no dossier match
 * (a prose selection, a pre-lift brain, or a value with no row label).
 */
export function resolveSuggestions(
  fact: SelectedFact,
  reportId: string,
  carried: MetricSuggestion[],
): string[] {
  const ctx = fact.context?.trim().toLowerCase();
  if (ctx) {
    const hit = carried.find((m) => m.label.trim().toLowerCase() === ctx);
    if (hit && hit.suggestions.length > 0) return hit.suggestions;
  }
  return suggestionsForMetric({ metric: fact.text, value: fact.text }, reportId);
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
  metricSuggestions = [],
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
          // Prefer the dossier's precomputed suggestions for the matched metric;
          // fall back to the client generator for prose / unmatched selections.
          // (A "section" selection has its own chip set inside the popup.)
          suggestions={
            fact.mode === "section" ? [] : resolveSuggestions(fact, reportId, metricSuggestions)
          }
          conclusion={conclusion}
          freshnessToken={freshnessToken}
          onClose={close}
        />
      )}
      <FirstTouchHint />
      <DiscoveryTicker />
      <AskAi reportId={reportId} conclusion={conclusion} freshnessToken={freshnessToken} />
    </>
  );
}
