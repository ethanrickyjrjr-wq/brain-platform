// The report-grounding path of the one assistant — the dock on a /r/* surface.
// Single-turn, report dossier + reach + authored method + a best-effort chart frame +
// the gap-log. Moved verbatim from the old /api/converse route; the question is now
// read from the last user message of the assistant contract.
//
// No-404 contract (#11): resolveReportGrounding degrades every miss to the master region
// read and NEVER throws, so this path always streams a real answer at the nearest grain —
// never "Request failed (404)", never a "we don't have that" dead-end.
import { resolveReportGrounding } from "@/lib/highlighter/report-grounding";
import { routeChart } from "@/lib/route-chart";
import { buildChartForIntent } from "@/lib/build-chart-for-intent.mts";
import { getAnthropic, TRIAGE_MODEL } from "@/refinery/agents/anthropic.mts";
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
import type { AssistantRequest } from "@/lib/assistant/contract";
import { extractText, sseMessage, SSE_STREAM_HEADERS } from "@/lib/assistant/stream";

const MAX_TOKENS = 760; // +60 over the answer budget for the short follow-ups tail.

// Cost guards — this path streams paid Haiku tokens on a public, unauthenticated surface
// (see middleware RATE_LIMITED_PREFIXES + lib/rate-limit.ts for the per-IP burst layer).
const MAX_QUESTION_CHARS = 2000;
const MAX_FACT_CHARS = 4000;
// Env-gated per-client weekly cap. capEnabled() is Boolean(HIGHLIGHTER_FREE_WEEKLY_CAP);
// the limit IS that env's numeric value (read live so it's tunable without redeploy).
// 0/unset → disabled (no behavior change).
function freeWeeklyCap(): number {
  return Number(process.env.HIGHLIGHTER_FREE_WEEKLY_CAP ?? "0");
}

/**
 * The report-grounding path. `request` is the raw Request (origin, client id, telemetry);
 * `req` is the parsed assistant contract (report_id + the question as the last user turn).
 * Returns the SSE Response. Moved from the old /api/converse POST body — behavior identical.
 */
export async function runReportPath(request: Request, req: AssistantRequest): Promise<Response> {
  const report_id = req.report_id;
  const { fact, slug, selection_type, is_realtime, from_chip } = req;
  // The dock sends a single user turn; the question is its content.
  const lastMsg = Array.isArray(req.messages) ? req.messages[req.messages.length - 1] : undefined;
  const question = lastMsg && lastMsg.role === "user" ? lastMsg.content : undefined;

  // Gate the PRIMARY report on "the brain exists" (resolveReportGrounding → 404 below),
  // NOT on MCP-catalog membership: if a user can view /r/<slug>, they can ask about it,
  // even if that brain isn't in BRAIN_CATALOG. Reach targets (R1) stay catalog-bound.
  if (!report_id || typeof report_id !== "string") {
    return Response.json({ error: "report_id required" }, { status: 400 });
  }
  if (!question || typeof question !== "string") {
    return Response.json({ error: "question required" }, { status: 400 });
  }
  // Bound inbound length BEFORE any model spend (per-field). Generous for a real
  // highlight-ask; breaks a token-burn loop.
  if (question.length > MAX_QUESTION_CHARS) {
    return Response.json({ error: "question too long" }, { status: 400 });
  }
  if (typeof fact === "string" && fact.length > MAX_FACT_CHARS) {
    return Response.json({ error: "fact too long" }, { status: 400 });
  }
  // Env-gated per-client weekly cap. Anonymous (no signed cid) callers are covered by the
  // per-IP burst limiter in middleware, not this per-client cap. Fail-open: weeklyCount
  // swallows DB errors and returns 0, so metering never blocks an answer.
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

  // R0: current report dossier. resolveReportGrounding decodes the surface kind
  // (brain | zip | corridor | method | source) and degrades every miss to the master
  // region read — it NEVER throws (#11). The catch is a paranoid backstop that degrades
  // to an ungrounded answer; it still never returns a user-facing 404.
  let grounding: Awaited<ReturnType<typeof resolveReportGrounding>>;
  try {
    grounding = await resolveReportGrounding(report_id, { origin });
  } catch {
    grounding = { blocks: [], method: null, freshnessToken: "" };
  }

  // R1: reach to other reports the question implies.
  const reachSlugs = resolveReachTargets(question, report_id);
  const reachBlocks = await fetchReachBlocks(reachSlugs, { origin });

  // Authored method: the highlighted metric's slug (popup path) wins; otherwise fall back
  // to the surface's own method (a /r/method/[metric] page). Drives both the injected
  // derivation (never-guess) and the deterministic gap-log.
  const method = (typeof slug === "string" ? resolveMethod(slug) : null) ?? grounding.method;
  const neededComponents = (method?.components ?? [])
    .filter((c) => c.role === "need")
    .map((c) => c.name);
  // answered=false means "we offered to find a named gap" (a tracked data request), NOT
  // "we failed to answer". A metric with `need` components is, by definition, a gap.
  const answered = neededComponents.length === 0;

  // The grounded system prompt — place-pin → format rule → grounding context → speak line
  // → follow-ups tail — is assembled by the shared core so the inbound auto-reply path
  // (Buyer-Intent Reply Sensor) grounds on the SAME engine. The follow-ups tail stays
  // gated on selection_type (popup yes, dock/email no).
  const system = buildGroundedSystemPrompt({
    fact,
    question,
    selectionType: selection_type,
    blocks: [...grounding.blocks, ...reachBlocks],
    method,
    surfaceNote: grounding.surfaceNote,
  });

  // Tell the model the SHAPE of what was grabbed so the answer (not just the follow-ups)
  // is tailored — e.g. a date/token reads differently than a metric.
  const typeHint =
    typeof selection_type === "string" && selection_type ? ` (a ${selection_type})` : "";
  const userMsg = fact ? `About this fact${typeHint}: "${fact}". ${question}` : question;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Best-effort chart frame — emitted before the text stream. Failure is silently
        // swallowed; a chart never blocks the answer.
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
        // Log the ask alongside the existing meter — both fire-and-forget. `answered` +
        // `needed_components` are computed deterministically from the resolved method
        // (above), not parsed from the answer text.
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

  return new Response(stream, { status: 200, headers: SSE_STREAM_HEADERS });
}
