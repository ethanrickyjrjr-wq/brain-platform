import { getAnthropic, TRIAGE_MODEL } from "@/refinery/agents/anthropic.mts";
import { recordWelcomeChat } from "@/lib/welcome/chat-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TOKENS = 500;
const MAX_HISTORY = 12;

const FORMAT_RULE =
  "CRITICAL: Respond in plain text ONLY. " +
  "NEVER use markdown — no asterisks (* or **), no # headers, no - bullet lists, no backticks (`), no > blockquotes. " +
  "Plain prose sentences only. If you use any markdown symbol the answer will be unreadable to the user.\n\n";

export const WELCOME_SYSTEM =
  "You are the assistant for SWFL Data Gulf — live, cited intelligence on Southwest Florida " +
  "(Lee, Collier, Charlotte, Glades, Hendry, Sarasota) real estate, building permits, flood risk, " +
  "freight, tourism, and the local economy, down to the ZIP and named-place level. You are talking to a " +
  "visitor who hasn't signed up yet. Explain plainly what the platform can do and how it would help their " +
  "work. Speak in illustrative ranges, never specific current statistics — for example, beachfront and " +
  "barrier-island ZIPs carry the region's steepest flood-loss estimates while inland corridors are far " +
  "lower; never a precise dollar figure. You do NOT have live data in this conversation. If asked for a " +
  "specific number (a flood loss, a sale price, a rate), do NOT make one up and do NOT guess — say that's " +
  'exactly what a project builds (a cited, branded one-pager) and steer them to sign up: "sign up and you ' +
  'can build it". Inventing a Southwest Florida number is the one thing you must never do. Be a ' +
  'knowledgeable, direct local expert, not a salesperson, and never use internal jargon (no "master", ' +
  '"brain", "payload", "grain", "dossier").';

/**
 * Yield text from the SDK MessageStream. Copied verbatim from
 * app/api/converse/route.ts:27-51 (SDK v0.69.0 has no .textStream on the real
 * stream; mocks/future SDKs may — check it first).
 */
async function* extractText(
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

export async function POST(request: Request): Promise<Response> {
  let body: { messages?: { role?: string; content?: string }[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const all = Array.isArray(body.messages) ? body.messages : [];
  const messages = all
    .filter(
      (m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"),
    )
    .slice(-MAX_HISTORY) as { role: "user" | "assistant"; content: string }[];

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "messages required (last must be user)" }, { status: 400 });
  }

  // Fire-and-forget telemetry — zero enforcement.
  void recordWelcomeChat(request, messages.length);

  const system = FORMAT_RULE + WELCOME_SYSTEM;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const client = getAnthropic();
        const ai = client.messages.stream({
          model: TRIAGE_MODEL, // claude-haiku-4-5
          max_tokens: MAX_TOKENS,
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

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
