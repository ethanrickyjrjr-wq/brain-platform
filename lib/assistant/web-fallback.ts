// web-fallback.ts — the CONVERSATIONAL text-answer rung of the four-lane cascade.
//
// THE BUG THIS FIXES: the chart path already web-fetches a figure we don't hold
// (compose-chart.ts → fillExternalPoint), but the plain TEXT answer (stream.ts
// `streamAnswer`) is a bare `messages.stream` with NO tools — so when the dossier
// doesn't carry the asked-for number, the model can only DEFLECT ("which ZIP?") or
// INVENT. The contract (RULES_OF_ENGAGEMENT) promises lane 3 ("a named web source")
// and forbids refusal, but the text path had no way to execute it. This module is
// that way.
//
// THE CASCADE (lib RULE 0.7 / rules-of-engagement rule 1), for a figure the user
// asked for that is NOT in our lake and NOT in their uploads:
//   3. NAMED WEB SOURCE — fetch it live via the SAME moat-preserving primitive the
//      chart path uses (fillExternalPoint: a value is accepted ONLY when its digits
//      appear VERBATIM in a real cited span the web_search tool returned). Verified
//      figures are injected as grounding ("state ONLY these"); their sources ride in
//      the collapsed citation list, never inline.
//   4. ASK THE USER — a figure neither our data nor a reliable web source can supply
//      is NOT invented and NOT a dead-end: the model is told to ask the user for that
//      one number (and, for a recurring/scheduled email, to note it needs a source or
//      ongoing updates because it can't be auto-verified).
//
// THE MOAT is unchanged: we can now state a number we don't hold — but never one we
// can't trace to a real source. Invention stays structurally impossible.
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, TRIAGE_MODEL } from "@/refinery/agents/anthropic.mts";
import {
  fillExternalPoint,
  type ExternalPoint,
  type ExternalRequest,
} from "@/lib/assistant/gap-fill";

const MAX_FIGURES = 3; // cap live lookups per answer (cost/latency guard)
const PROBE_MAX_TOKENS = 400;
const HELD_SUMMARY_MAX = 8000; // bound the held-data context fed to the probe

export interface WebFallbackResult {
  /** Figures fetched live from a named source and verified against a cited span. */
  verified: ExternalPoint[];
  /** Labels we tried but could NOT verify — the model asks the user for these (lane 4). */
  unfound: string[];
}

/** Cheap pre-filter so the probe LLM call only fires when the message plausibly asks
 *  for a specific figure. A miss here just means a wasted probe (the probe still
 *  returns [] when held data answers it); a false-true is harmless. Errs permissive. */
const FIGURE_SIGNALS =
  /\b(how many|how much|active listings?|days on market|\bdom\b|inventory|absorption|months? of supply|median|average|avg|vacancy|asking rent|cap rate|mortgage rate|interest rate|price per|count of|number of|permits?|closings?|sales? volume|new listings?|pending|under contract|list price|sold price|\brate\b|how long)\b/i;

export function looksLikeFigureAsk(question: string): boolean {
  return FIGURE_SIGNALS.test(question || "");
}

/** Host of a citation URL for the small-print footnote (no scheme/path), e.g.
 *  "https://www.redfin.com/city/x" → "redfin.com". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Read the probe's forced-tool output into clean ExternalRequests: keep only entries
 *  with both a label and a search_query, cap at MAX_FIGURES. Pure — unit-tested. */
export function parseMissingFigures(raw: unknown): ExternalRequest[] {
  const missing = (raw as { missing?: unknown })?.missing;
  if (!Array.isArray(missing)) return [];
  return missing
    .map((m) => m as Record<string, unknown>)
    .filter((m) => typeof m?.label === "string" && typeof m?.search_query === "string")
    .slice(0, MAX_FIGURES)
    .map((m) => ({ label: m.label as string, search_query: m.search_query as string }));
}

// The forced probe tool. The model lists ONLY figures the user asked for that are NOT
// already in WHAT WE HOLD — a label + a focused web query, never a number itself.
const REQUEST_WEB_FIGURES_TOOL = {
  name: "request_web_figures",
  description:
    "List ONLY the specific figures the user explicitly asked for that are NOT already " +
    "present in WHAT WE HOLD (below) and that need a live web lookup. Return an EMPTY " +
    "array if our held data already answers the question, OR if the user did not ask for " +
    "a specific numeric figure. NEVER include a figure already shown in WHAT WE HOLD. " +
    "NEVER write a number yourself — only a short label and a focused web-search query " +
    "(no numbers in the query). Prefer authoritative, current sources.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      missing: {
        type: "array",
        description: "Figures to fetch live. Empty when held data already answers the ask.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: {
              type: "string",
              description: "Short figure label, e.g. 'Cape Coral median days on market'.",
            },
            search_query: {
              type: "string",
              description:
                "Focused query, e.g. 'Cape Coral FL median days on market 2026'. No numbers.",
            },
          },
          required: ["label", "search_query"],
        },
      },
    },
    required: ["missing"],
  },
} as const;

/** The gap-detection LLM call. Given the question + everything we hold, decides which
 *  asked-for figures are missing. Injectable for tests; the default runs Haiku. */
export type ProbeFn = (question: string, heldSummary: string) => Promise<ExternalRequest[]>;

const defaultProbe: ProbeFn = async (question, heldSummary) => {
  const client = getAnthropic();
  const msg = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: PROBE_MAX_TOKENS,
    tools: [REQUEST_WEB_FIGURES_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "request_web_figures" },
    messages: [
      {
        role: "user",
        content:
          `The user asked: "${question}"\n\n` +
          `=== WHAT WE HOLD (our live SWFL data — treat as the complete set of figures we ` +
          `already have) ===\n${heldSummary.slice(0, HELD_SUMMARY_MAX)}\n\n` +
          `List the specific figures they asked for that are NOT in WHAT WE HOLD and need a ` +
          `web lookup. Empty array if our data already answers it.`,
      },
    ],
  });
  const tool = msg.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
  return parseMissingFigures(tool?.input);
};

export type FillFn = (req: ExternalRequest) => Promise<ExternalPoint | null>;

/** Turn STALE held figures into FORCED web lookups — the probe would never flag these
 *  (it sees we "hold" them), but their as-of is behind the source's publish cadence, so
 *  we refetch the current cited value to supersede the stale one. The query carries the
 *  label + source as guidance and NEVER a number (the model must read it from a citation,
 *  not echo ours). Freshness decides WHICH figures are stale (lib/assistant/freshness). */
export function staleFiguresToRequests(
  stale: { label: string; source?: string }[],
  placeHint?: string,
): ExternalRequest[] {
  // Anchor every query to the SCOPE place. Without it, a place-less label (e.g. "Home
  // value, year over year") drifts to the wrong geography (a live run pulled the metro YoY
  // for a ZIP) — replacing a ZIP figure with a metro figure is a provenance error.
  const place = (placeHint ?? "").trim() || "Southwest Florida";
  return stale.map((f) => ({
    label: f.label,
    search_query: [f.label, f.source, place, "current latest"].filter(Boolean).join(" "),
  }));
}

/**
 * Run the conversational web-fallback cascade for one question. Detects the asked-for
 * figures we don't hold (probe) PLUS any `forced` lookups (stale held figures the probe
 * won't flag), fetches each from a named source + verifies it against a cited span
 * (fill = fillExternalPoint), and partitions into web-verified (lane 3) vs unfound
 * (lane 4 — ask the user). Forced wins on a label collision (it's the deliberate refresh).
 * Never throws: any failure degrades to an empty result so the answer still streams.
 */
export async function webFallback(
  question: string,
  heldSummary: string,
  deps: { probe?: ProbeFn; fill?: FillFn; forced?: ExternalRequest[] } = {},
): Promise<WebFallbackResult> {
  const probe = deps.probe ?? defaultProbe;
  const fill = deps.fill ?? fillExternalPoint;
  const forced = deps.forced ?? [];

  let probed: ExternalRequest[] = [];
  try {
    probed = await probe(question, heldSummary);
  } catch {
    probed = []; // a probe failure must not drop the forced (stale-refresh) lane
  }

  // Merge forced + probed, dedup by label (forced wins — it's the deliberate refresh).
  const seen = new Set(forced.map((r) => r.label));
  const requests = [...forced, ...probed.filter((r) => !seen.has(r.label))];
  if (requests.length === 0) return { verified: [], unfound: [] };

  const settled = await Promise.all(
    requests.map((r) =>
      fill(r)
        .then((point) => ({ r, point }))
        .catch(() => ({ r, point: null as ExternalPoint | null })),
    ),
  );

  const verified: ExternalPoint[] = [];
  const unfound: string[] = [];
  for (const { r, point } of settled) {
    if (point) verified.push(point);
    else unfound.push(r.label);
  }
  return { verified, unfound };
}

/**
 * Render the cascade result as grounding text the answer model reads. Verified figures
 * become a "state ONLY these, cite the host, never invent" block; unfound figures become
 * an "ask the user, never fabricate" block carrying the recurring-email caveat. Returns
 * "" when there is no gap (callers append unconditionally).
 */
export function renderWebFallbackBlock(result: WebFallbackResult): string {
  const parts: string[] = [];

  if (result.verified.length > 0) {
    const lines = result.verified
      .map((v) => `- ${v.label}: ${v.value} — source: ${hostOf(v.url)}`)
      .join("\n");
    parts.push(
      "=== WEB-VERIFIED FIGURES (NOT in our SWFL lake — fetched live from a named public " +
        "source and verified against the quoted text; state ONLY these numbers, attribute " +
        "each to its source by name, never invent or round) ===\n" +
        lines,
    );
  }

  if (result.unfound.length > 0) {
    const labels = result.unfound.join("; ");
    const noun = result.unfound.length === 1 ? "that figure" : "those figures";
    parts.push(
      `=== COULD NOT VERIFY FROM A RELIABLE SOURCE: ${labels} ===\n` +
        `Do NOT invent ${noun}. Do NOT stall the whole answer over it — answer everything ` +
        `else you can. For the missing piece, ask the user to provide ${noun} so you can use ` +
        `it. If they are setting up a recurring or scheduled email, tell them a number that ` +
        `changes over time must come with a source or be kept updated — it cannot be ` +
        `scheduled on an unverifiable figure.`,
    );
  }

  return parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
}
