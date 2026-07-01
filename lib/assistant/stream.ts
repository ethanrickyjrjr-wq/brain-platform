// Shared SSE plumbing for the one assistant engine. Both legacy routes
// (/api/converse and /api/welcome/chat) duplicated extractText + the SSE headers
// verbatim; this is the one copy. The report path builds its own ReadableStream
// (it interleaves a chart frame + gap-log), so it reuses extractText + headers
// rather than streamAnswer.
import { getAnthropic, TRIAGE_MODEL } from "@/refinery/agents/anthropic.mts";
import type { WelcomeFrame } from "@/lib/welcome/frames";

export const SSE_STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store",
  Connection: "keep-alive",
} as const;

export const SSE_MESSAGE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store",
} as const;

/** A minimal SSE Response: one text line + done, NO model call (over-cap / honest-gap
 *  paths). The whole point is zero token spend. */
export function sseMessage(text: string): Response {
  const body =
    `data: ${JSON.stringify({ text })}\n\n` + `data: ${JSON.stringify({ done: true })}\n\n`;
  return new Response(body, { status: 200, headers: SSE_MESSAGE_HEADERS });
}

/**
 * Yield text from the SDK MessageStream. SDK v0.69.0 returns a MessageStream with no
 * .textStream property; mocks and future SDK versions may expose it — check it first.
 * The real-SDK branch pulls content_block_delta text (verified against @anthropic-ai/sdk
 * v0.69.0: content_block_delta → delta.type "text_delta" → delta.text).
 */
export async function* extractText(
  ai: AsyncIterable<unknown> & { textStream?: AsyncIterable<string> },
): AsyncIterable<string> {
  if (ai.textStream) {
    yield* ai.textStream;
    return;
  }
  for await (const event of ai) {
    const e = event as { type?: string; delta?: { type?: string; text?: string } };
    if (
      e.type === "content_block_delta" &&
      e.delta?.type === "text_delta" &&
      typeof e.delta.text === "string"
    ) {
      yield e.delta.text;
    }
  }
}

/**
 * Stream a Haiku answer for the given system prompt as SSE, optionally preceded by typed
 * prelude frames (place + grounded cards). The shared tail for the conversation path
 * (un-grounded explainer + grounded paths). Clients branch on frame `type` and ignore
 * unknown types, so the prelude is a backward-compatible extension of the SSE stream.
 */
export function streamAnswer(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  maxTokens: number,
  prelude: WelcomeFrame[] = [],
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (const frame of prelude) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        }
        const client = getAnthropic("assistant_stream");
        const ai = client.messages.stream({
          model: TRIAGE_MODEL, // claude-haiku-4-5
          max_tokens: maxTokens,
          system,
          messages,
        });
        for await (const text of extractText(ai)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      } catch (e) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200, headers: SSE_STREAM_HEADERS });
}
