"use client";

import { useHighlight, type SelectedFact } from "@/lib/highlighter/use-highlight";
import { useHighlighterContext } from "@/lib/highlighter/context";
import { suggestionsForSelection } from "@/lib/highlighter/suggestions";
import { HighlightPopup } from "./HighlightPopup";
import { FirstTouchHint } from "./FirstTouchHint";
import { DiscoveryTicker } from "./DiscoveryTicker";
import { AskAi } from "./AskAi";

/** One metric's dossier-carried, precomputed suggested questions, keyed by its
 *  human label (matched against the selected fact's row context). */
export interface MetricSuggestion {
  label: string;
  suggestions: string[];
  /** Provenance carried so the popup's "File this figure" can build a `metric`
   *  ProjectItem with its source + freshness pinned at save time. Optional so
   *  pre-lift brains and prose selections still type-check. */
  value?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  freshnessToken?: string;
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
export function resolveSuggestions(fact: SelectedFact, carried: MetricSuggestion[]): string[] {
  const ctx = fact.context?.trim().toLowerCase();
  if (ctx) {
    const hit = carried.find((m) => m.label.trim().toLowerCase() === ctx);
    if (hit && hit.suggestions.length > 0) return hit.suggestions;
  }
  // No carried metric match → type-aware chips. NEVER "What's driving <raw
  // value>" — that produced "What's driving 2026-06-09" and "What's driving our
  // freshness token". suggestionsForSelection routes token / date / place /
  // bare-number to sensible chips instead.
  return suggestionsForSelection(fact.text, fact.factType);
}

/**
 * Pick the full carried metric (value + provenance) for the selected fact by the
 * same row-context label match as `resolveSuggestions`. Returns null for prose
 * selections or values with no matching row label — the popup then falls back to
 * the raw selection text + the page freshness token when filing a figure.
 */
export function resolveMetric(
  fact: SelectedFact,
  carried: MetricSuggestion[],
): MetricSuggestion | null {
  const ctx = fact.context?.trim().toLowerCase();
  if (!ctx) return null;
  return carried.find((m) => m.label.trim().toLowerCase() === ctx) ?? null;
}

/**
 * The single mount point for the Highlighter on a /r/ report page. It is a
 * SIBLING of the report content (never a wrapper), so if anything in here
 * throws, the report itself is already painted and unaffected. It listens for
 * text selection (and FactChip taps, via the same `onActivate` shape) and shows
 * the popup anchored to the selection.
 *
 * chipFact state lives in HighlighterProvider (the ancestor context) so that
 * FactChip instances deeper in the tree (e.g. MetricsTable) can feed taps into
 * the same popup without prop-threading through server-component pages.
 */
export function HighlighterLayer({
  reportId,
  conclusion,
  freshnessToken,
  metricSuggestions = [],
}: LayerProps) {
  const { fact: selectedFact, clear } = useHighlight();
  // chipFact comes from context (set by FactChip taps via MetricsTable).
  const ctx = useHighlighterContext();
  const chipFact = ctx?.chipFact ?? null;
  const setChipFact = ctx?.setChipFact ?? null;

  const fact = chipFact ?? selectedFact;

  function close() {
    setChipFact?.(null);
    clear();
    // Don't clear the DOM selection here — user may want to copy the highlighted text.
    // The browser clears it naturally on the next click elsewhere.
  }

  // Always-on surfaces (coachmark, ambient ticker, Ask-AI dock) render as
  // siblings regardless of selection; the figure popup is conditional on a fact.
  return (
    <div className="print-hide">
      {fact && (
        <HighlightPopup
          reportId={reportId}
          fact={fact}
          // Prefer the dossier's precomputed suggestions for the matched metric;
          // fall back to the client generator for prose / unmatched selections.
          // (A "section" selection has its own chip set inside the popup.)
          suggestions={fact.mode === "section" ? [] : resolveSuggestions(fact, metricSuggestions)}
          // The matched metric's value + provenance, so "File this figure" pins a
          // sourced snapshot. Null for prose / unmatched selections.
          fileableMetric={fact.mode === "section" ? null : resolveMetric(fact, metricSuggestions)}
          conclusion={conclusion}
          freshnessToken={freshnessToken}
          onClose={close}
        />
      )}
      <FirstTouchHint used={!!fact} />
      <DiscoveryTicker />
      <AskAi reportId={reportId} conclusion={conclusion} freshnessToken={freshnessToken} />
    </div>
  );
}
