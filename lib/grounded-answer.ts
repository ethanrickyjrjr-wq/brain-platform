/**
 * Shared grounded-answer core — the one place the SWFL grounding prompt is
 * assembled, reused by BOTH the streaming in-page `/api/converse` route and the
 * buffered inbound auto-reply (Buyer-Intent Reply Sensor). Extract, don't fork:
 * the same `buildGroundingContext` engine, the same place-pinning, the same
 * no-invent floor power both surfaces.
 *
 * `buildGroundedSystemPrompt` is the verbatim assembly lifted from
 * `app/api/converse/route.ts` so the streaming route keeps byte-identical
 * behavior (a golden snapshot test pins it). `generateGroundedAnswer` is the
 * buffered variant the webhook uses — no SSE, no chart frame, no follow-up tail.
 */
import { fetchBrain, buildDossier } from "@/lib/fetch-brain";
import { RULES_OF_ENGAGEMENT } from "@/refinery/lib/rules-of-engagement.mts";
import { GEOGRAPHY_GAZETTEER } from "@/refinery/lib/geography-gazetteer.mts";
import { getAnthropic, TRIAGE_MODEL } from "@/refinery/agents/anthropic.mts";
import { buildGroundingContext, type GroundingBlock } from "@/lib/highlighter/grounding";
import { buildPlaceContext } from "@/lib/place-context";
import type { MethodologyEntry } from "@/refinery/lib/methodology-registry.mts";

// GEOGRAPHY_GAZETTEER is an object; buildGroundingContext expects a string.
const GAZETTEER_STR = JSON.stringify(GEOGRAPHY_GAZETTEER, null, 2);

/** Plain-text-only directive (no markdown). Shared with the converse route. */
export const FORMAT_RULE =
  "CRITICAL: Respond in plain text ONLY. " +
  "NEVER use markdown — no asterisks (* or **), no # headers, no - bullet lists, no backticks (`), no > blockquotes. " +
  "Plain prose sentences only. If you use any markdown symbol the answer will be unreadable to the user.\n\n";

/** Closing voice line. Shared with the converse route. */
export const SPEAK_LINE =
  "\n\nSpeak like a knowledgeable friend. Give a real, useful answer from the data. No markdown. Never say 'master', 'brain', 'grounded data', 'payload', or 'grain'.";

/**
 * The follow-up-chips tail, gated on `selectionType` exactly as the popup does
 * (the report-level dock and the email auto-reply render no chips, so they spend
 * no tokens on a tail that would only be stripped).
 */
export function buildFollowupsDirective(selectionType?: string): string {
  return typeof selectionType === "string" && selectionType
    ? "\n\nAFTER your answer, on its very own final line, output exactly this marker " +
        "then 2-3 natural next questions separated by ' | ':\n" +
        "⟦FOLLOWUPS⟧ first question | second question | third question\n" +
        `Each must be a complete question (<= 12 words), grounded in the data you have, ` +
        `tailored to your answer and to what the user highlighted (a ${selectionType}). ` +
        "Do not number them. Write nothing after the last one. Keep them CLEAN — no internal " +
        "ids/slugs, never the words 'master', 'brain', 'payload', or 'grain'."
    : "";
}

export interface GroundedSystemPromptInput {
  question: string;
  fact?: string;
  selectionType?: string;
  blocks: GroundingBlock[];
  method?: MethodologyEntry | null;
  /** A one-line "the user is on the X report" pin from the report-grounding
   *  resolver (synthetic ZIP/corridor/method/source surfaces). Prepended so the
   *  model answers about that exact surface, not the SWFL-wide aggregate. */
  surfaceNote?: string;
}

/**
 * Assemble the grounded system prompt. Identical shape to the converse route's
 * historical inline assembly: place-pin → format rule → grounding context →
 * speak line → follow-ups tail. (When a `surfaceNote` is present it leads, so the
 * model is pinned to the synthetic surface before reading the data.)
 */
export function buildGroundedSystemPrompt(input: GroundedSystemPromptInput): string {
  const placeContext = buildPlaceContext(`${input.fact ?? ""} ${input.question}`);
  const followupsDirective = buildFollowupsDirective(input.selectionType);
  const surfacePin = input.surfaceNote ? input.surfaceNote + "\n\n" : "";
  return (
    surfacePin +
    placeContext +
    FORMAT_RULE +
    buildGroundingContext({
      rules: RULES_OF_ENGAGEMENT,
      gazetteer: GAZETTEER_STR,
      blocks: input.blocks,
      method: input.method ?? null,
    }) +
    SPEAK_LINE +
    followupsDirective
  );
}

/** Pull the concatenated text out of a buffered Anthropic message response. */
function messageText(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
}

export interface GroundedAnswer {
  text: string;
  freshnessToken: string;
}

/**
 * Produce a buffered, grounded answer to a free-text question — the inbound
 * auto-reply path. Fetches the report dossier, grounds the model on it, and
 * returns the plain-text answer plus the freshness token (quoted in the answer
 * and echoed to the agent's alert). Node runtime only (reads `brains/*.md`).
 */
export async function generateGroundedAnswer(args: {
  message: string;
  reportId?: string;
  origin?: string;
}): Promise<GroundedAnswer> {
  const reportId = args.reportId ?? "master";
  const { output, freshness_token } = await fetchBrain(reportId, {
    tier: 2,
    ...(args.origin ? { origin: args.origin } : {}),
  });
  // Customer-clean label (the recipient is the agent's client) — never the
  // internal report id. buildDossier keeps the real per-metric citations.
  const block: GroundingBlock = {
    label: "SWFL market data",
    dossier: buildDossier(output, freshness_token),
  };
  const system = buildGroundedSystemPrompt({ question: args.message, blocks: [block] });

  const client = getAnthropic();
  const res = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 700,
    system,
    messages: [{ role: "user", content: args.message }],
  });

  return { text: messageText(res), freshnessToken: freshness_token };
}
