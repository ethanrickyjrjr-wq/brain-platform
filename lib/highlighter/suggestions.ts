import type { MethodologyEntry } from "../../refinery/lib/methodology-registry.mts";
import type { FactType } from "./use-highlight";

/**
 * Client FALLBACK copy of `suggestionsForMetric` from
 * `refinery/stages/4-output.mts`.
 *
 * As of the dossier-suggestions type-lift, the build PRECOMPUTES each metric's
 * suggestions into `BrainOutputMetric.suggestions` and the page carries them to
 * `HighlighterLayer` via `DisplayMetric.suggestions`. The popup prefers those.
 * This client copy is now only the FALLBACK for selections the dossier can't
 * resolve — a prose phrase with no metric row, a value whose row label didn't
 * match, or a brain rendered before the lift. It is a verbatim copy of the
 * refinery body so the two stay identical; kept pure (no React/DOM) so it is
 * bun-testable.
 */
export function suggestionsForMetric(
  m: { metric: string; value: string | number },
  slug: string,
): string[] {
  const label = m.metric.replace(/_/g, " ");
  const out = [`What's driving ${label}?`, `How does ${label} here compare to other SWFL areas?`];
  if (slug === "housing-swfl") out.push(`How does flood risk affect ${label} in this ZIP?`);
  return out.slice(0, 3);
}

/** Span-aware chips. `value` present => offer to break the specific figure down.
 *  `place` present => offer a comparison + a find-the-missing-parts action.
 *  Never definitional ("What is X?") — the doctrine: don't assume the user doesn't know. */
export function suggestionsForSpan(args: {
  entry?: MethodologyEntry | null;
  value?: string | number;
  place?: string;
}): string[] {
  const { entry, value, place } = args;
  const label = entry?.label ?? "this";
  const out: string[] = [];
  if (value != null) out.push(`Break down the ${value}`);
  else out.push(`How is ${label.toLowerCase()} derived?`);
  if (place) out.push(`Compare to Naples`);
  const need = (entry?.components ?? []).filter((c) => c.role === "need");
  if (need.length)
    out.push(
      place
        ? `Find ${place}'s ${need[0].name.toLowerCase()}`
        : `Find the ${need[0].name.toLowerCase()}`,
    );
  else out.push(`How do you find this?`);
  return out.slice(0, 3);
}

/** The freshness token (e.g. "SWFL-7421-v5-20260607"). Detected so it never
 *  gets metric-style "What's driving…" chips — a token has no driver. */
export function isFreshnessToken(text: string): boolean {
  return /^SWFL-\d/i.test(text.trim());
}

/**
 * Type-aware starter chips for a FREE selection that did NOT resolve to a known
 * metric (no carried suggestions, no method entry). Keeps the chips relevant to
 * WHAT was highlighted instead of blindly asking "What's driving X?" — the bug
 * that produced "What's driving our freshness token". Never definitional.
 */
/** A date / year (e.g. "2026-06-09", "06/09/2026", "2026"). Detected so it gets
 *  recency chips, never metric "What's driving…" chips. classifyFact() treats a
 *  date as a "metric" (it strips the hyphens and sees digits), so this guard
 *  must run BEFORE the metric branch. */
export function isLikelyDate(text: string): boolean {
  const t = text.trim();
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(t) || // ISO 2026-06-09
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t) || // 06/09/2026
    /^(19|20)\d{2}$/.test(t) // a bare 4-digit year
  );
}

export function suggestionsForSelection(text: string, factType: FactType): string[] {
  if (isFreshnessToken(text)) {
    return ["What does this freshness stamp mean?", "How current is this data?"];
  }
  if (isLikelyDate(text)) {
    return ["How current is this data?", "How often is this updated?"];
  }
  if (factType === "place") {
    return [`What's the read on ${text}?`, `How does ${text} compare?`];
  }
  // A number with no metric label of its own — explain/compare the figure.
  return ["What does this number tell me?", "How does it compare across our areas?"];
}
