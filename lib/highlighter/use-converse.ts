"use client";

import { useCallback, useState } from "react";
import { streamConverse, type ConverseInput } from "./converse";

export interface UseConverse {
  /** Fire a grounded question; streams the answer into `answer`. */
  ask: (input: ConverseInput) => Promise<void>;
  answer: string;
  reach: string[];
  error: string | null;
  streaming: boolean;
  /** Clear answer/reach/error back to the empty state. */
  reset: () => void;
}

/**
 * React state wrapper around `streamConverse` (lib/highlighter/converse.ts).
 * Both the selection popup and the Ask-AI dock consume this so there is one
 * grounded-`/api/converse` implementation. The streaming/accumulation logic is
 * unit-tested in converse.test.ts; this hook only binds it to React state.
 */
export function useConverse(): UseConverse {
  const [answer, setAnswer] = useState("");
  const [reach, setReach] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  const reset = useCallback(() => {
    setAnswer("");
    setReach([]);
    setError(null);
    setStreaming(false);
  }, []);

  const ask = useCallback(async (input: ConverseInput) => {
    if (!input.question.trim()) return;
    setAnswer("");
    setReach([]);
    setError(null);
    setStreaming(true);
    await streamConverse(input, {
      onText: setAnswer,
      onReach: setReach,
      onError: (m) => setError(m),
    });
    setStreaming(false);
  }, []);

  return { ask, answer, reach, error, streaming, reset };
}
