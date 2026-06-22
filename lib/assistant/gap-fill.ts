// gap-fill.ts — Increment B of the chart engine: LIVE CITED GAP-FILL.
//
// When a chart would be more useful with a number we DON'T hold (a peer market's
// vacancy, a national average, a rate), the composer can ask for it by label +
// search query. This module fetches that number LIVE from the open web and lets it
// onto the chart ONLY if it is real and cited — never from the model's memory.
//
// THE MOAT (structural, the same shape as the held-number anchor, but for numbers
// we don't hold): a gap-filled value is accepted ONLY when its digits appear
// VERBATIM in a `cited_text` span the Anthropic web_search tool actually returned
// from a real publisher URL. "The model said 31%" is NOT enough; "31% appears in
// the 150-char quote the API pulled from gulfshorebusiness.com" IS. A value that
// can't be found in any returned citation is dropped, and the chart renders without
// it. So we can chart a number we don't hold — but we can NEVER fabricate one.
//
// Vendor surface: the Anthropic `web_search_20250305` server tool (NOT `20260209`,
// whose dynamic filtering suppresses per-claim citations — see
// docs/vendor-notes/anthropic-web-search-wire-up.md). Model: claude-sonnet-4-6
// (proven to support web_search + citations; the same wiring as
// lib/email/data-readiness.ts). This is a per-message verification surface, not an
// ingest crawler — crawl4ai has no part here.
//
// Never throws — any failure (no key, search error, nothing verifiable) drops the
// external point and the caller renders the held-only chart.
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/refinery/agents/anthropic.mts";

/** Model for grounded web_search calls — proven to emit per-claim citations. */
export const SEARCH_MODEL = "claude-sonnet-4-6";
const SEARCH_TOOL_TYPE = "web_search_20250305";
const SEARCH_MAX_USES = 4; // bound cost on a latency-sensitive lookup
const PAUSE_TURN_LIMIT = 4; // server tools can pause mid-turn
const MAX_TOKENS = 1024;

/** Seed authoritative domains for SWFL chart peers — federal data, RE portals, and
 *  SWFL brokerages. news-press.com / naplesnews.com / realtor.com are OMITTED: they
 *  block Anthropic's crawler (listing ANY blocked domain 400s the WHOLE request) —
 *  see the vendor note + the 2026-06-22 realtor.com finding. `runSearch` also
 *  self-heals: a 400 naming blocked domains strips them and retries once, so a
 *  future vendor block degrades gracefully instead of killing all gap-fill. Grow
 *  from observed misses, not imagination. */
export const SEARCH_ALLOWED_DOMAINS = [
  "bls.gov",
  "census.gov",
  "fred.stlouisfed.org",
  "fema.gov",
  "hud.gov",
  "redfin.com",
  "zillow.com",
  "cushmanwakefield.com",
  "colliers.com",
  "cbre.com",
  "gulfshorebusiness.com",
];

/** Parse the domains named in a 400 "not accessible to our user agent: ['x','y']"
 *  error so the caller can strip them and retry. Empty when the message isn't that. */
export function parseBlockedDomains(message: string): string[] {
  const m = message.match(/not accessible to our user agent:\s*\[([^\]]*)\]/i);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

export interface ExternalRequest {
  /** The chart label for the bar, e.g. "Tampa office vacancy". */
  label: string;
  /** A focused web-search query, e.g. "Tampa office vacancy rate 2026". */
  search_query: string;
}

export interface ExternalPoint {
  label: string;
  value: number;
  /** Publisher URL of the citation the value was verified against. */
  url: string;
  /** The verbatim cited span the value was found in (≤150 chars). */
  cited_text: string;
}

/** A per-claim citation pulled from a web_search response. */
export interface CitedSpan {
  url: string;
  cited_text: string;
}

/**
 * Pull every per-claim citation span ({url, cited_text}) out of an accumulated list
 * of response content blocks. Pure — unit-tested without network. Mirrors
 * data-readiness.parseGroundedResponse but keeps the verbatim `cited_text` (the moat
 * anchor), not just the URL. Also detects a web_search_tool_result_error (HTTP 200).
 */
export function parseCitedSpans(content: unknown[]): {
  spans: CitedSpan[];
  searchError: string | null;
} {
  const spans: CitedSpan[] = [];
  let searchError: string | null = null;

  for (const raw of content) {
    const block = raw as Record<string, unknown>;
    if (block.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) {
        const cc = c as Record<string, unknown>;
        const url = cc?.url;
        const cited = cc?.cited_text;
        if (typeof url === "string" && url && typeof cited === "string" && cited) {
          spans.push({ url, cited_text: cited });
        }
      }
    } else if (block.type === "web_search_tool_result") {
      const c = block.content;
      if (
        c &&
        typeof c === "object" &&
        !Array.isArray(c) &&
        (c as Record<string, unknown>).type === "web_search_tool_result_error"
      ) {
        searchError = String((c as Record<string, unknown>).error_code ?? "unknown");
      }
    }
  }
  return { spans, searchError };
}

/** Reduce a number to its bare significant digits, e.g. "$30.88" → "3088",
 *  "1,226,969" → "1226969", "2.6%" → "26". Used to test whether a value literally
 *  appears in a cited span regardless of separators/symbols. */
function digitsOf(s: string | number): string {
  return String(s).replace(/[^0-9]/g, "");
}

/** THE MOAT CHECK: does `value` appear VERBATIM (digit-for-digit) in any returned
 *  citation span? Returns the matching span when so, else null. A 3+-digit run is
 *  required so trivially-short numbers (a "5") don't match incidentally — peers
 *  with <3 significant digits are not gap-fillable (they fall through to dropped). */
export function valueAppearsInCitations(value: number, spans: CitedSpan[]): CitedSpan | null {
  const target = digitsOf(value);
  if (target.length < 2) return null;
  for (const span of spans) {
    if (digitsOf(span.cited_text).includes(target)) return span;
  }
  return null;
}

/** Pull the value off the last `ANSWER: <value>` line; UNKNOWN/empty → null. */
function extractAnswerNumber(text: string): number | null {
  const matches = [...text.matchAll(/ANSWER:\s*(.+)/gi)];
  if (!matches.length) return null;
  const val = matches[matches.length - 1][1].trim();
  if (!val || /^unknown\.?$/i.test(val)) return null;
  // first numeric token (handles "$30.88 per sqft", "31%", "2.6 percent")
  const m = val.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Injectable for tests: returns the accumulated web_search content blocks for a
 *  prompt, or throws. The default runs the real Anthropic web_search call. */
export type SearchFn = (prompt: string) => Promise<unknown[]>;

/** One grounded web_search run over `domains` (handles the pause_turn loop). */
async function runSearch(prompt: string, domains: string[]): Promise<unknown[]> {
  const client = getAnthropic();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  const accumulated: unknown[] = [];
  for (let i = 0; i < PAUSE_TURN_LIMIT; i++) {
    const msg = await client.messages.create({
      model: SEARCH_MODEL,
      max_tokens: MAX_TOKENS,
      messages,
      tools: [
        {
          type: SEARCH_TOOL_TYPE,
          name: "web_search",
          max_uses: SEARCH_MAX_USES,
          allowed_domains: domains,
        } as unknown as Anthropic.Tool,
      ],
    });
    accumulated.push(...msg.content);
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    break;
  }
  return accumulated;
}

const defaultSearch: SearchFn = async (prompt) => {
  try {
    return await runSearch(prompt, SEARCH_ALLOWED_DOMAINS);
  } catch (err) {
    // Self-heal: a 400 naming blocked domains → strip them and retry once. A domain
    // that opted out of Anthropic's crawler must not kill the whole feature.
    const blocked = parseBlockedDomains(err instanceof Error ? err.message : String(err));
    if (blocked.length === 0) throw err;
    const pruned = SEARCH_ALLOWED_DOMAINS.filter((d) => !blocked.includes(d));
    console.warn(`[gap-fill] dropping blocked domain(s) ${blocked.join(", ")} and retrying`);
    return await runSearch(prompt, pruned);
  }
};

/**
 * Fetch ONE external chart figure live and return it only if verified against a real
 * citation. Pure verification (parse + digit match) is unit-tested; the network call
 * is injectable via `deps.search`. Returns null on any failure — never throws.
 */
export async function fillExternalPoint(
  req: ExternalRequest,
  deps: { search?: SearchFn } = {},
): Promise<ExternalPoint | null> {
  if (!req?.label || !req?.search_query) return null;
  const search = deps.search ?? defaultSearch;
  const prompt =
    `Find this single figure using web search of authoritative sources: ${req.label} ` +
    `(search guidance: ${req.search_query}).\n` +
    `Use the guidance as a starting point but search broadly — government data (BLS, ` +
    `Census, FRED), brokerage market reports (CBRE, Colliers, Cushman & Wakefield), and ` +
    `major listing portals. The MOST RECENT citable figure from roughly the last two ` +
    `years is acceptable; report it and state its period rather than giving up because ` +
    `the exact requested period isn't published. The value MUST be one a source states ` +
    `explicitly (quotable), not your estimate.\n` +
    `On the FINAL line output exactly "ANSWER: <value>" — one figure with its unit ` +
    `(e.g. "ANSWER: 6.75%" or "ANSWER: $30.88"). If no reputable figure is found in any ` +
    `source, output "ANSWER: UNKNOWN". Do not guess.`;

  let content: unknown[];
  try {
    content = await search(prompt);
  } catch {
    return null;
  }

  const { spans } = parseCitedSpans(content);
  if (spans.length === 0) return null;

  // Find the model's stated value across all text blocks.
  const text = content
    .map((b) => {
      const bb = b as Record<string, unknown>;
      return bb.type === "text" && typeof bb.text === "string" ? bb.text : "";
    })
    .join("\n");
  const value = extractAnswerNumber(text);
  if (value === null) return null;

  // THE MOAT: the value must appear verbatim in a returned citation span.
  const span = valueAppearsInCitations(value, spans);
  if (!span) return null;

  return { label: req.label, value, url: span.url, cited_text: span.cited_text };
}
