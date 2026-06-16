import { fetchBrain, buildDossier, BrainNotFoundError } from "@/lib/fetch-brain";
import { routeChart } from "@/lib/route-chart";
import { buildChartForIntent } from "@/lib/build-chart-for-intent.mts";
import { getAnthropic, TRIAGE_MODEL } from "@/refinery/agents/anthropic.mts";
import { type GroundingBlock } from "@/lib/highlighter/grounding";
import { resolveReachTargets } from "@/lib/highlighter/reach";
import { fetchReachBlocks } from "@/lib/highlighter/fetch-reach";
import {
  recordUse,
  recordAsk,
  capEnabled,
  weeklyCount,
  clientIdFromRequest,
} from "@/lib/highlighter/meter";
import { resolveMethod } from "@/refinery/lib/methodology-registry.mts";
import { buildGroundedSystemPrompt } from "@/lib/grounded-answer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TOKENS = 760; // +60 over the answer budget for the short follow-ups tail.

// Cost guards — this route streams paid Haiku tokens on a public, unauthenticated
// surface (see middleware RATE_LIMITED_PREFIXES + lib/rate-limit.ts for the per-IP
// burst layer). These bound a single call's input and a single client's weekly volume.
const MAX_QUESTION_CHARS = 2000;
const MAX_FACT_CHARS = 4000;
// Env-gated per-client weekly cap. capEnabled() is Boolean(HIGHLIGHTER_FREE_WEEKLY_CAP);
// the limit IS that env's numeric value (read live so it's tunable without redeploy).
// 0/unset → disabled (no behavior change).
function freeWeeklyCap(): number {
  return Number(process.env.HIGHLIGHTER_FREE_WEEKLY_CAP ?? "0");
}

/** A minimal SSE Response carrying one text line + done — answers an over-cap
 *  request gracefully WITHOUT a model call (the whole point: zero token spend). */
function sseMessage(text: string): Response {
  const body =
    `data: ${JSON.stringify({ text })}\n\n` + `data: ${JSON.stringify({ done: true })}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" },
  });
}
/**
 * Produce an async iterable of text strings from whatever the SDK stream
 * object exposes. SDK v0.69.0 returns a MessageStream from messages.stream()
 * that iterates MessageStreamEvent — no .textStream property. Mocks and
 * future SDK versions may expose .textStream directly; check for it first.
 */
async function* extractText(
  ai: AsyncIterable<unknown> & { textStream?: AsyncIterable<string> },
): AsyncIterable<string> {
  if (ai.textStream) {
    yield* ai.textStream;
    return;
  }
  // Real SDK path: iterate MessageStreamEvent, pull content_block_delta text.
  // The SDK's MessageStreamEvent union doesn't structurally narrow here, so we
  // assert the delta shape we care about (verified against @anthropic-ai/sdk
  // v0.69.0: content_block_delta → delta.type "text_delta" → delta.text).
  for await (const event of ai) {
    const e = event as {
      type?: string;
      delta?: { type?: string; text?: string };
    };
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
  let body: {
    report_id?: string;
    fact?: string;
    slug?: string;
    selection_type?: string;
    is_realtime?: boolean;
    from_chip?: boolean;
    question?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { report_id, fact, slug, selection_type, is_realtime, from_chip, question } = body;
  // Gate the PRIMARY report on "the brain exists" (fetchBrain → 404 below), NOT
  // on MCP-catalog membership: if a user can view /r/<slug>, they can ask about
  // it, even if that brain isn't in BRAIN_CATALOG (e.g. franchise-outcomes).
  // Reach targets (R1) stay catalog-bound inside resolveReachTargets.
  if (!report_id || typeof report_id !== "string") {
    return Response.json({ error: "report_id required" }, { status: 400 });
  }
  if (!question || typeof question !== "string") {
    return Response.json({ error: "question required" }, { status: 400 });
  }
  // Bound inbound length BEFORE any model spend (per-field — this route is not an
  // array). Generous for a real highlight-ask; breaks a token-burn loop.
  if (question.length > MAX_QUESTION_CHARS) {
    return Response.json({ error: "question too long" }, { status: 400 });
  }
  if (typeof fact === "string" && fact.length > MAX_FACT_CHARS) {
    return Response.json({ error: "fact too long" }, { status: 400 });
  }
  // Env-gated per-client weekly cap. Anonymous (no signed cid) callers are covered
  // by the per-IP burst limiter in middleware, not this per-client cap. Fail-open:
  // weeklyCount swallows DB errors and returns 0, so metering never blocks an answer.
  const cap = freeWeeklyCap();
  if (capEnabled() && cap > 0) {
    const clientId = clientIdFromRequest(request);
    if (clientId !== "anon" && (await weeklyCount(clientId)) >= cap) {
      return sseMessage(
        "You've reached this week's free-question limit. It resets next week — or reach out if you need more.",
      );
    }
  }

  const origin = new URL(request.url).origin;

  // R0: current report dossier (carries every-area detail_tables).
  let primary: GroundingBlock;
  try {
    const { output, freshness_token } = await fetchBrain(report_id, {
      tier: 2,
      origin,
    });
    primary = {
      label: report_id,
      dossier: buildDossier(output, freshness_token),
    };
  } catch (err) {
    const status = err instanceof BrainNotFoundError ? 404 : 500;
    return Response.json({ error: (err as Error).message }, { status });
  }

  // R1: reach to other reports the question implies.
  const reachSlugs = resolveReachTargets(question, report_id);
  const reachBlocks = await fetchReachBlocks(reachSlugs, { origin });

  // Authored method for the highlighted metric, when its slug resolved. Drives
  // both the injected derivation (never-guess) and the deterministic gap-log.
  const method = typeof slug === "string" ? resolveMethod(slug) : null;
  const neededComponents = (method?.components ?? [])
    .filter((c) => c.role === "need")
    .map((c) => c.name);
  // answered=false means "we offered to find a named gap" (a tracked data
  // request), NOT "we failed to answer". A metric with `need` components is, by
  // definition, a gap — deterministic, no answer-text parsing.
  const answered = neededComponents.length === 0;

  // The grounded system prompt — place-pin → format rule → grounding context →
  // speak line → follow-ups tail — is assembled by the shared core so the inbound
  // auto-reply path (Buyer-Intent Reply Sensor) grounds on the SAME engine. The
  // follow-ups tail stays gated on selection_type (popup yes, dock/email no).
  const system = buildGroundedSystemPrompt({
    fact,
    question,
    selectionType: selection_type,
    blocks: [primary, ...reachBlocks],
    method,
  });

  // Tell the model the SHAPE of what was grabbed so the answer (not just the
  // follow-ups) is tailored — e.g. a date/token reads differently than a metric.
  const typeHint =
    typeof selection_type === "string" && selection_type ? ` (a ${selection_type})` : "";
  const userMsg = fact ? `About this fact${typeHint}: "${fact}". ${question}` : question;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Best-effort chart frame — emitted before the text stream.
        // Failure is silently swallowed; a chart never blocks the answer.
        try {
          const intent = routeChart(question);
          if (intent) {
            const chart = await buildChartForIntent(intent);
            if (chart) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chart })}\n\n`));
            }
          }
        } catch {
          /* chart is best-effort */
        }

        const client = getAnthropic();
        const ai = client.messages.stream({
          model: TRIAGE_MODEL, // claude-haiku-4-5
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: "user", content: userMsg }],
        });
        for await (const text of extractText(ai)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
        }
        // Log the ask alongside the existing meter — both fire-and-forget.
        // `answered` + `needed_components` are computed deterministically from the
        // resolved method (above), not parsed from the answer text.
        void recordUse(request, { report_id, reach: reachSlugs });
        void recordAsk({
          report_id,
          fact,
          question,
          reach: reachSlugs,
          answered,
          needed_components: neededComponents,
          selection_type: selection_type ?? null,
          is_realtime: is_realtime === true,
          from_chip: from_chip === true,
        });
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ done: true, reach: reachSlugs, answered })}\n\n`,
          ),
        );
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
