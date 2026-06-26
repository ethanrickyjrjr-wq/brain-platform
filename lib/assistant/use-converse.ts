"use client";

import { useCallback, useState } from "react";
import { streamConverse, type ConverseInput } from "./converse";

export interface UseConverse {
  /** Fire a grounded question; streams the answer into `answer`. */
  ask: (input: ConverseInput) => Promise<void>;
  answer: string;
  reach: string[];
  /** Model-generated real-time follow-up chips for the just-finished answer.
   *  Empty when the tail was missing/malformed — the popup falls back to static. */
  followups: string[];
  /**
   * true = grounded answer; false = data gap (AI signalled it couldn't answer).
   * null = stream still in progress (no done frame yet).
   */
  answered: boolean | null;
  /** Best-effort chart payload emitted before the text stream. null until received. */
  chart: unknown;
  /** Grounded SWFL location from the OFF-report prelude `place` frame (null until one
   *  arrives, and on the report-grounding path which emits none). Lets an off-report
   *  filed Q&A pin the same ZIP the answer resolved to — parity with the pill. */
  groundedPlace: { zip?: string; name?: string } | null;
  /** Representative freshness token carried on that `place` frame, if any. */
  groundedToken: string | undefined;
  error: string | null;
  streaming: boolean;
  /** Clear answer/reach/answered/chart/place/error back to the empty state. */
  reset: () => void;
}

/**
 * React state wrapper around `streamConverse` (lib/assistant/converse.ts).
 * Both the selection popup and the Ask-AI dock consume this so there is one
 * grounded-`/api/assistant` implementation. The streaming/accumulation logic is
 * unit-tested in converse.test.ts; this hook only binds it to React state.
 */
export function useConverse(): UseConverse {
  const [answer, setAnswer] = useState("");
  const [reach, setReach] = useState<string[]>([]);
  const [followups, setFollowups] = useState<string[]>([]);
  const [answered, setAnswered] = useState<boolean | null>(null);
  const [chart, setChart] = useState<unknown>(null);
  const [groundedPlace, setGroundedPlace] = useState<{ zip?: string; name?: string } | null>(null);
  const [groundedToken, setGroundedToken] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  const reset = useCallback(() => {
    setAnswer("");
    setReach([]);
    setFollowups([]);
    setAnswered(null);
    setChart(null);
    setGroundedPlace(null);
    setGroundedToken(undefined);
    setError(null);
    setStreaming(false);
  }, []);

  const ask = useCallback(async (input: ConverseInput) => {
    if (!input.question.trim()) return;
    setAnswer("");
    setReach([]);
    setFollowups([]);
    setAnswered(null);
    setChart(null);
    setGroundedPlace(null);
    setGroundedToken(undefined);
    setError(null);
    setStreaming(true);
    await streamConverse(input, {
      onText: setAnswer,
      onReach: setReach,
      onFollowups: setFollowups,
      onAnswered: setAnswered,
      onChart: setChart,
      onPlace: (place, token) => {
        setGroundedPlace(place);
        if (token) setGroundedToken(token);
      },
      onError: (m) => setError(m),
    });
    setStreaming(false);
  }, []);

  return {
    ask,
    answer,
    reach,
    followups,
    answered,
    chart,
    groundedPlace,
    groundedToken,
    error,
    streaming,
    reset,
  };
}
