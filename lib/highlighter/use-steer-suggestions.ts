"use client";

import { useEffect, useState } from "react";
import { streamConverse, type ConverseInput } from "@/lib/assistant/converse";

const MAX_STEERS = 3;

export function buildSteerQuestion(span: string): string {
  return (
    `For this selected passage from a deliverable:\n"${span}"\n\n` +
    `Suggest up to ${MAX_STEERS} specific, one-line rebuild instructions. ` +
    `Example: "lead with the rent trend" or "add a risk callout for flood zone AA". ` +
    `One per line, no numbering, no extra prose.`
  );
}

/**
 * Split a streamed suggestion block into ≤3 one-line steers. Strips ONLY a genuine
 * list marker at the start of a line — `- `, `* `, `• `, `1. `, `2) ` — and requires
 * whitespace after it. A leading figure that is CONTENT (e.g. "2024 was the peak…")
 * is preserved; the earlier greedy `^[-•*\d.]+` ate it.
 */
export function parseSteerLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_STEERS);
}

export interface SteerContext {
  context?: "project" | "outside";
  projectId?: string;
  /** Plain-English "where the user is" (from `describePage`). String, matching the
   *  Layer-1 `ConverseInput.pageContext` — NOT `unknown`. */
  pageContext?: string;
  /** Customer-clean briefcase digest (from `briefcaseDigest`). String, see above. */
  briefcase?: string;
}

/**
 * Fires ONE project-grounded converse ask when `enabled` is true for a selection,
 * streams the response, and parses it into up to 3 one-line instruction strings. If
 * the user re-selects different text while the popup stays open, it re-fires for the
 * new span; toggling EDIT↔ASK does NOT re-fire (the answer is kept).
 *
 * Lint shape (both rules are build-blocking here): the armed span lives in STATE, not
 * a ref — so reading it during render is allowed (`react-hooks/refs`) — and the
 * reset + spinner are set via set-state-during-render (the `useProjectThread` idiom),
 * never synchronously in the effect (`react-hooks/set-state-in-effect`). Every result
 * mutation happens inside the deferred `streamConverse` handlers.
 */
export function useSteerSuggestions(
  span: string,
  ctx: SteerContext,
  enabled: boolean,
): { steers: string[]; loading: boolean; error: string | null } {
  const [steers, setSteers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The span we've kicked a request for (null = none yet / EDIT panel not active).
  const [firedSpan, setFiredSpan] = useState<string | null>(null);

  const target = enabled && span.trim() ? span : null;
  // Set-state-during-render: a new target span resets results + arms the spinner.
  // Converges immediately (firedSpan becomes target on the next render).
  if (target !== null && firedSpan !== target) {
    setFiredSpan(target);
    setSteers([]);
    setError(null);
    setLoading(true);
  }

  useEffect(() => {
    if (firedSpan === null) return;
    let acc = "";
    let cancelled = false;
    const input: ConverseInput = {
      context: ctx.context,
      projectId: ctx.projectId,
      pageContext: ctx.pageContext,
      briefcase: ctx.briefcase,
      question: buildSteerQuestion(firedSpan),
    };
    void streamConverse(input, {
      onText: (t) => {
        acc = t; // onText delivers the ACCUMULATED answer, so assign (not append).
      },
      onDone: () => {
        if (cancelled) return;
        setSteers(parseSteerLines(acc));
        setLoading(false);
      },
      onError: (m) => {
        if (cancelled) return;
        setError(m);
        setLoading(false);
      },
    });
    return () => {
      cancelled = true;
    };
  }, [firedSpan, ctx.context, ctx.projectId, ctx.pageContext, ctx.briefcase]);

  return { steers, loading, error };
}
