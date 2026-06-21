import type { MethodologyEntry } from "../../refinery/lib/methodology-registry.mts";
import type { FactType } from "./use-highlight";

/**
 * Returns a phrased chip that hits `routeChart` for a deliverable scope, or
 * null when no scope resolves for this metric slug (avoids dead chips).
 * Scopes flood-aal and vitals are intentionally excluded — buildChartForIntent
 * returns null for both until their data paths are live.
 */
function chartChipForMetric(metricSlug: string): string | null {
  const s = metricSlug.toLowerCase();
  if (s.includes("rent") || s.includes("asking")) return "Chart asking rents across the corridors";
  if (s.includes("vacanc")) return "Chart vacancy rates across corridors";
  if (s.includes("zhvi") || s.includes("home_value") || s.includes("home_price"))
    return "Chart home values over time";
  return null;
}

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
  const chip = chartChipForMetric(m.metric);
  const label = m.metric.replace(/_/g, " ");
  const out = [`What's driving ${label}?`, `How does ${label} here compare to other SWFL areas?`];
  if (slug === "housing-swfl") out.push(`How does flood risk affect ${label} in this ZIP?`);
  if (chip) out.unshift(chip);
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

/** The 5-way selection type passed to the converse server so it can tailor both
 *  the answer and the real-time follow-ups to WHAT was grabbed — not just the
 *  text. `factType` is only metric/place; this layers section (large selection) +
 *  token/date (which classifyFact() folds into "metric") back out, reusing the
 *  existing detectors. Pure so it is bun-testable. */
export type SelectionType = "section" | "token" | "date" | "place" | "metric";

export function deriveSelectionType(fact: {
  text: string;
  factType: FactType;
  mode: "fact" | "section";
}): SelectionType {
  if (fact.mode === "section") return "section";
  if (isFreshnessToken(fact.text)) return "token";
  if (isLikelyDate(fact.text)) return "date";
  return fact.factType;
}

/** A direction/sentiment badge — the report's overall read ("Mixed", "Bullish",
 *  "→ Bearish"), NOT a place. `classifyFact` only knows metric|place, so a
 *  non-numeric badge falls through to "place" and the popup asks "What's the
 *  read on Mixed?" / "How does Mixed compare?" — nonsense about a place named
 *  "Mixed". This guard (mirroring `isFreshnessToken`/`isLikelyDate`) routes the
 *  badge to sentiment-appropriate chips instead. Covers the master direction
 *  vocabulary + the leaf-metric trend words, with an optional leading arrow. */
export function isDirectionLabel(text: string): boolean {
  const t = text
    .trim()
    .replace(/^[↑↓→]\s*/, "")
    .toLowerCase();
  return /^(mixed|bullish|bearish|neutral|stable|rising|falling)$/.test(t);
}

export function suggestionsForSelection(text: string, factType: FactType): string[] {
  if (isFreshnessToken(text)) {
    return ["What does this freshness stamp mean?", "How current is this data?"];
  }
  if (isLikelyDate(text)) {
    return ["How current is this data?", "How often is this updated?"];
  }
  if (isDirectionLabel(text)) {
    // A sentiment badge, not a place — ask about the READ, never interpolate it
    // as an entity and never offer a place-only "Chart home values" chip.
    return [
      "What's driving this read?",
      "What would change this call?",
      "What's the strongest signal here?",
    ];
  }
  if (factType === "place") {
    return [
      "Chart home values over time",
      `What's the read on ${text}?`,
      `How does ${text} compare?`,
    ];
  }
  // A number with no metric label of its own — explain/compare the figure.
  return ["What does this number tell me?", "How does it compare across our areas?"];
}
