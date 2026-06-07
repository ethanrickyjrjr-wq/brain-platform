/**
 * Pins the event-iteration branch of extractText() — the REAL production path
 * when @anthropic-ai/sdk v0.69.0 is installed (no .textStream on MessageStream).
 *
 * Kept in a separate file so its top-level mock.module() gets a fresh Bun
 * module registry, uncontaminated by route.test.ts's textStream mock.
 */
import { test, expect, mock } from "bun:test";

// Mock the anthropic module BEFORE importing route.
// Returns a stream object that is async-iterable over MessageStreamEvent
// shapes — no .textStream property — forcing extractText() into branch (2).
mock.module("@/refinery/agents/anthropic.mts", () => ({
  TRIAGE_MODEL: "claude-haiku-4-5",
  agentsAreMocked: () => false,
  getAnthropic: () => ({
    messages: {
      stream: () => ({
        // No .textStream property — branch (2) of extractText() activates.
        async *[Symbol.asyncIterator]() {
          yield { type: "content_block_start", index: 0 }; // ignored (no delta)
          yield {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Flood AAL " },
          };
          yield {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "is $30,074 [env-swfl]." },
          };
          yield { type: "message_stop" }; // ignored (no delta)
        },
      }),
    },
  }),
}));

mock.module("@/lib/highlighter/meter", () => ({
  recordUse: async () => 1,
  weeklyCount: async () => 0,
  capEnabled: () => false,
}));

const { POST } = await import("./route");

test("streams via the event-iteration branch (real SDK shape, no textStream)", async () => {
  const req = new Request("https://x/api/converse", {
    method: "POST",
    body: JSON.stringify({ report_id: "master", question: "flood risk?" }),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
  const body = await res.text();

  // Route wraps each yielded string in a `data: {"text":"..."}` SSE frame.
  // Extract all text values and concatenate — that is the "reconstructed" stream.
  const reconstructed = [...body.matchAll(/^data: (\{.*\})$/gm)]
    .map((m) => JSON.parse(m[1]))
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");

  // Both chunks arrive and reconstruct the full sentence.
  expect(reconstructed).toBe("Flood AAL is $30,074 [env-swfl].");

  // Non-text event types must NOT appear anywhere in the SSE body.
  expect(body).not.toContain("content_block_start");
  expect(body).not.toContain("message_stop");
});
