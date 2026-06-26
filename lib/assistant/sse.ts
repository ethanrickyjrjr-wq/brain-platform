/**
 * Pure SSE frame parser for the /api/converse stream.
 *
 * The route emits `text/event-stream` frames separated by a blank line
 * (`\n\n`). Each frame is a single `data: {…}` line whose payload is JSON:
 *   data: {"text":"…"}        (repeated)
 *   data: {"done":true,"reach":["env-swfl",…]}
 *   data: {"error":"…"}
 *
 * Network reads arrive in arbitrary chunks, so a frame can be split across two
 * reads. `parseSSEFrames` takes the accumulated buffer, returns every COMPLETE
 * event it can parse, and hands back the trailing incomplete chunk (`rest`) for
 * the caller to prepend to the next read. Malformed/non-`data:` lines are
 * skipped silently — a stray heartbeat never crashes the reader.
 */
export interface SSEEvent {
  text?: string;
  done?: boolean;
  reach?: string[];
  /** Server sets false when the answer signals a data gap (answered=false in data_requests). */
  answered?: boolean;
  error?: string;
  /** Best-effort chart emitted before the text stream. See buildChartForIntent. */
  chart?: unknown;
  /** Frame discriminator the conversation path uses for its typed prelude
   *  (`{type:"place", …}`). The highlighter only acts on `place` frames. */
  type?: string;
  /** Prelude `place` frame — the grounded SWFL location an OFF-report answer resolved
   *  to (`{zip,name}`); rides with `freshness_token`. Lets an off-report filed Q&A pin
   *  the same ZIP the answer was grounded on (parity with the pill's `placeRef`). */
  place?: { zip?: string; name?: string };
  /** Representative freshness token carried on the `place` frame. */
  freshness_token?: string;
}

export interface ParsedSSE {
  events: SSEEvent[];
  rest: string;
}

export function parseSSEFrames(buffer: string): ParsedSSE {
  const events: SSEEvent[] = [];
  // Split on the SSE record separator. The final element is whatever comes
  // after the last `\n\n` — an incomplete frame still mid-flight.
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";

  for (const frame of parts) {
    // A frame may carry multiple lines; we only consume `data:` lines.
    for (const rawLine of frame.split("\n")) {
      const line = rawLine.trimStart();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (!payload) continue;
      try {
        const obj = JSON.parse(payload) as SSEEvent;
        events.push(obj);
      } catch {
        // Non-JSON data line — skip, don't throw.
      }
    }
  }

  return { events, rest };
}
