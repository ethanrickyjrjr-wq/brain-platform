// Pure, framework-free engine for the in-page Highlighter chat. Both the
// selection popup and the "Ask AI" dock drive this one function so there is a
// single grounded-`/api/converse` implementation (no duplicated SSE loop).
//
// Kept React-free on purpose: the streaming/accumulation logic is unit-tested
// (see converse.test.ts) by injecting a fetch stub; the thin `useConverse` hook
// (use-converse.ts) only wires this to React state.

import { parseSSEFrames } from "./sse";

export interface ConverseInput {
  reportId: string;
  /** Optional fact context (the selected figure). Omitted for report-level chat. */
  fact?: string;
  question: string;
}

export interface ConverseHandlers {
  /** Called with the ACCUMULATED answer text on every delta. */
  onText: (accumulated: string) => void;
  /** Called once with the reach slugs the server pulled (on the done frame). */
  onReach?: (reach: string[]) => void;
  /**
   * Called once with the answered flag from the done frame.
   * false = the AI signalled it couldn't answer from the payload (data gap).
   */
  onAnswered?: (answered: boolean) => void;
  /** Called with a human-readable message on any failure. Terminal. */
  onError: (message: string) => void;
  /** Called once when the stream completes cleanly. */
  onDone?: () => void;
}

/**
 * POST the question to `/api/converse` and drive the handlers from the SSE
 * stream. Resolves when the stream ends (or an error/empty-question short-circuits).
 * `fetchImpl` is injectable for tests; defaults to the global `fetch`.
 */
export async function streamConverse(
  input: ConverseInput,
  handlers: ConverseHandlers,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const question = input.question.trim();
  if (!question) return;

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchImpl("/api/converse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        report_id: input.reportId,
        fact: input.fact,
        question,
      }),
    });
  } catch (e) {
    handlers.onError((e as Error).message || "Something went wrong.");
    return;
  }

  if (!res.ok || !res.body) {
    handlers.onError(`Request failed (${res.status})`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let acc = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSSEFrames(buffer);
      buffer = rest;
      for (const ev of events) {
        if (ev.error) {
          handlers.onError(ev.error);
          return;
        }
        if (typeof ev.text === "string") {
          acc += ev.text;
          handlers.onText(acc);
        }
        if (ev.done) {
          if (Array.isArray(ev.reach)) handlers.onReach?.(ev.reach);
          // answered defaults to true when absent (older server / test stub).
          handlers.onAnswered?.(ev.answered !== false);
          handlers.onDone?.();
        }
      }
    }
  } catch (e) {
    handlers.onError((e as Error).message || "Something went wrong.");
  }
}
