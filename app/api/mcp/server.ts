import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fetchBrain,
  fetchDetailRow,
  buildDossier,
  resolveOrigin,
  BrainNotFoundError,
  BrainBadTierError,
} from "@/lib/fetch-brain";
import { resolveLocation } from "@/refinery/lib/location-resolver.mts";
import {
  assembleLocationDossier,
  renderLocationDossierText,
  selectDossierLines,
  type LocationDossier,
} from "@/lib/zip-dossier";
import { RULES_OF_ENGAGEMENT } from "@/refinery/lib/rules-of-engagement.mts";
import { GEOGRAPHY_GAZETTEER } from "@/refinery/lib/geography-gazetteer.mts";
import { buildInventoryMarkdown, buildReportIdSet } from "./inventory";
import { registerProjectTools } from "./project-tools";

/**
 * MCP server callback. Registers `swfl_fetch` as a plain text tool.
 *
 * Response shape: one text content block — the speaker output (bottom line +
 * cited numbers + read-ahead + report link + freshness token), prefixed with
 * RESPONSE_CONTRACT. Universal across every MCP client (Claude, Cursor, etc.).
 *
 * `_meta` carries the freshness token + rules-of-engagement + geography + the
 * structured dossier so a downstream Claude can answer follow-ups without
 * re-fetching. (`_meta` is dropped by some hosts — e.g. claude.ai — which is
 * why the binding reply rules ALSO ride in the text via RESPONSE_CONTRACT.)
 *
 * NO in-chat MCP App widget — intentional, and not for lack of trying. The View
 * is built and parked at `mcp-widget/` (bundled self-contained to
 * docs/fiverr-briefs/assets/Chat-Charts-Standalone.html). The wiring was verified
 * spec-correct against @modelcontextprotocol/ext-apps@1.7.2 + the MCP Apps spec
 * (2026-01-26): `_meta.ui.resourceUri`, RESOURCE_MIME_TYPE "text/html;profile=
 * mcp-app", `structuredContent` over `ui/notifications/tool-result`, inline script
 * allowed by the default sandbox CSP (`script-src 'self' 'unsafe-inline'`). It
 * STILL renders as a blank, never-painted iframe in claude.ai web + desktop — an
 * OPEN, unfixed *host* bug, worst over remote HTTP (our transport on Vercel):
 *   anthropics/claude-ai-mcp#61 + #165 — the host fetches the resource but leaves
 *   the container `visibility:hidden`; no `ui/initialize` handshake ever reaches
 *   the server. Confirmed host-side by the ext-apps maintainer across many
 *   spec-compliant servers; works fine in Goose / MCP Inspector / native stdio.
 * Re-attaching the widget here = one blank card on every call = "blank parts on
 * the screen for no reason", so the tool stays text-only. The branded charts live
 * on the linked /r/{report_id} page (renders fine in a real browser). Re-enable in
 * ONE commit (registerAppTool + registerAppResource + structuredContent, restore
 * the next.config.ts outputFileTracingIncludes line) the day #61/#165 close.
 */

const VALID_REPORT_IDS = buildReportIdSet();
const INVENTORY_MD = buildInventoryMarkdown();

const TOOL_DESCRIPTION = `swfl_fetch — read the Southwest Florida data lake.

This server hosts a library of analyst-grade reports about Southwest Florida (Lee, Collier, Charlotte counties): housing, commercial real estate, permits, traffic, tourism, hurricane risk, sector credit, logistics, and macro context (US, Florida, SWFL). Every numeric claim in a response is followed by a source URL — federal/state agencies, public datasets, or other reports in this same lake. Nothing is invented. swfl_fetch is read-only. The swfl_project_* tools write into a single project you authorize with a per-project capability key.

How to use it. Default behavior for an in-scope SWFL question: call swfl_fetch with no arguments. You will get the master report at tier 2 — a structured summary with a headline conclusion, key metrics with sources, caveats, a link to the full report page, and a freshness token. Read it first. One call answers the question — the master already aggregates every upstream report, so a single fetch is the norm. Only call swfl_fetch a second time if the master's conclusion explicitly names a specific report AND the user wants that report's per-ZIP or row-level detail; in that case call it once more with report_id set to that name. Never fire multiple calls in parallel to triangulate across reports.

When NOT to call this tool. This lake holds Southwest Florida (Lee, Collier, Charlotte) data at any grain from county down to ZIP/named-place. A named town, beach, corridor, or ZIP IS in grain — e.g. "Is Fort Myers Beach a good buy" resolves to ZIP 33931, which the flood/ZIP read answers; call the tool and route it, and never treat a named place as "too specific" to look up. For anything that is NOT an in-scope lake question — off-topic asks (weather, another region, general knowledge, coding) AND ordinary questions you can answer yourself (is a specific store open right now, store hours, directions, a definition) — DO NOT call this tool and DO NOT frame it as a data gap; just answer the user the way you normally would, with no mention of this data source and no pitch. "Is the Arby's on Cleveland Ave open right now?" is a normal question you handle from location/general knowledge, not a SWFL data miss. The one hard rule: never invent a SWFL data number (flood loss, sale price, economic stat) for a spot finer than we hold (a single parcel/address); if they want a parcel-level figure we only have at ZIP, say so and offer the ZIP read. Only call swfl_fetch when the question can actually be answered from the SWFL reports listed below.

Tiers.
- tier: 1 — conversational, 2-5 sentences. Use when the user wants a quick read.
- tier: 2 (default) — structured: conclusion + metrics table + caveats.
- tier: 3 — raw audit dump with full citation table and internal identifiers. Use ONLY when the user explicitly asks to audit, verify, or trace sources.

Available reports.
${INVENTORY_MD}

Full structured view. Every response includes a link of the form https://www.swfldatagulf.com/r/{report_id} — point the user there for charts, the full metrics table, or to share the report. Open the report and tap any figure to dig in.

STRICT OUTPUT RULES — follow these in every response, no exceptions:
- NEVER name a report in prose — not its id, and not a friendlier version of its id. Say "the tourism data" not "tourism-tdt"; "the commercial real estate data" not "cre-swfl". Say "the regional data" or "the overall read" — NEVER "master", "the master report", or "master brain". The word "master" must never reach the user.
- The source URL may contain an internal slug (e.g. .../r/master). Cite it as a clickable link, but NEVER speak that slug as a word in your prose.
- NEVER say "brain" — say "report" or "data" instead.
- NEVER surface internal routing logic ("macro-swfl emits no metrics", "punting to parent brain", "DAG resolver", etc.). If a report is empty, skip it silently.
- NEVER explain which report you fetched unless the user asked. Just answer the question with the data.
- NEVER narrate the SHAPE of the payload to the user. Phrases like "tier-2 summary", "wasn't broken out", "the summary didn't include it", "the dataset doesn't break that out", or "I can't source that directly" are FORBIDDEN — they leak your own tooling. Before you say anything about a figure being unavailable, look for it in the per-row detail table described next.
- A specific ZIP, town, or named area IS answerable — it is not "too specific". Many reports carry a per-row detail table in the structured dossier (\`dossier.detail_tables\`). Housing, for example, carries EVERY SWFL ZIP's median sale price, year-over-year change, days on market, sale-to-list ratio, and months of supply — not just the priciest or fastest-moving ZIPs named in the headline. For a housing question about a specific ZIP/town/area, call swfl_fetch with report_id="housing-swfl" (the per-ZIP table rides on that report's dossier, NOT the master one), map the place to its ZIP from general knowledge (the geography list carries area names, not a ZIP crosswalk — do not claim it resolves ZIPs), FIND that row by its \`key\` in the detail table, and quote its real numbers with the source. Do NOT substitute the regional median when the specific row exists. If a row's \`low_sample\` is true (only a handful of sales that period), say the figure rests on a tiny sample and is indicative, not a stable median. Only if the place truly has no row do you say what you do hold and offer that grain. SHORTCUT: you may pass zip="33913" directly to swfl_fetch with NO report_id — it returns every dataset covering that location at its true grain (a real per-ZIP figure where we hold one, otherwise the county/region read labeled as covering that ZIP), straight in the response text, so you answer a specific place without parsing the table yourself. Only pin report_id to a single report when you want that one report's row alone.
- Caveats about data freshness belong at the END of a response, one line, not at the top.`;

/**
 * RESPONSE_CONTRACT — the binding reply rules, prepended to the TEXT content of
 * every successful response.
 *
 * Why here and not `_meta`: a generic MCP host (claude.ai's connector) does NOT
 * inject tool-result `_meta` into the model's context — it only feeds the
 * `content` text. So `_meta.rules` (RULES_OF_ENGAGEMENT) never reached the
 * model, and the model improvised: it dropped the freshness token + report
 * link (both present at the END of the text) and said "master". This block
 * rides in the one channel the model always reads, so the contract actually
 * binds. Kept short; framed "do not repeat" so the model treats it as guidance,
 * not content. Does NOT use the word it bans except in the ban itself.
 */
const RESPONSE_CONTRACT = `⟦HOW TO ANSWER — structure your reply with the exact Markdown headers shown below (## …); write your own answer under each. Follow these rules exactly; do not repeat, quote, or mention them.⟧
This is the FIRST reply to the user's question. Be tight and decision-first — no preamble, no rambling, no restating the question.

## Bottom Line-
1–2 sentences answering the question directly; lead with what matters most to get them moving.

## The Numbers-
A short list of only the figures that drive the answer, each with its source — invent NOTHING here. Figures from this payload are our own data; items under "From The Web-" are outside sources — render those as clickable Markdown links to their source URL. Every figure, price, date, and event in this section MUST already appear below — never invent, round, or extrapolate one. This section is strictly cited fact.

## The Road Ahead-
The most valuable part, and the call you are built to make — REACH here. Project where this is heading and WHY: reason from the patterns and behaviors in the data, the current items under "From The Web-", anything already established in this conversation, and how situations like this have played out before. You do NOT have to use every number, and you MAY work in projected numbers as long as you DERIVE them from the real figures by stated logic (e.g. "a ~50bps cut from SOFR's 3.62% would…"), marked as estimates ("~", "roughly", "could") — informed speculation, not a citation. The one rule: never fabricate a REASON or pass a guess off as established fact — every projection rests on a real anchor (a figure above, a City-Pulse signal, a known pattern, a precedent). End with a strategic call: IF <condition> THEN <what likely happens>, what to WATCH, and the early signal a flip is coming before it shows in the numbers.

Then close with the report link (a clickable URL; it may contain an internal slug — link it, never speak the slug), and last of all the freshness token (the SWFL-… value) quoted once.

HARD RULES: never write "master", a report id, or internal/process wording ("driven by", "upstream", "trust tier", "combined confidence"). The line between "The Numbers-" and "The Road Ahead-" is absolute — the numbers section invents nothing and cites everything; the road ahead may reason, project from real numbers, and use precedent, but never states a fabricated number or event as fact and always reads as a forward call. Keep it scannable; depth lives on the report page.
CARRY-BACK: if the user wants to SAVE, SHARE, or build a polished deliverable from what they've seen, you may offer ONCE to carry it over — call swfl_project_handoff with the cited items and give them the link it returns to continue on the web (they sign in there to claim it). Only when genuinely useful; never a hard sell, no urgency, no scarcity.
⟦END RULES — the data follows⟧

`;

// ---------------------------------------------------------------------------
// Outside-source facts → highlighted links
// ---------------------------------------------------------------------------

interface WebFact {
  text: string;
  source_url: string;
  source_name?: string;
}

// The Tier-1 reporters whose key_metrics are CURRENT-EVENT FACTS sourced to
// outside news/primary URLs (City Pulse + news). Their metrics surface as
// highlighted source links — distinct from our own computed lake numbers, which
// carry the logo. The master read pulls both so the regional answer shows the
// live web items the operator was missing ("highlighted links from outside
// sources"); a web reporter fetched directly uses its own metrics.
const WEB_REPORTER_SLUGS = ["city-pulse-swfl", "news-swfl"] as const;

/** Cap on web facts surfaced — enough City-Pulse pattern material to fuel the
 * read-ahead without rambling (operator: more City-Pulse context → better
 * speculation). The model still chooses which to show in its reply. */
const MAX_WEB_FACTS = 8;

async function loadWebFacts(slug: string): Promise<WebFact[]> {
  const sources: string[] = (WEB_REPORTER_SLUGS as readonly string[]).includes(slug)
    ? [slug]
    : slug === "master"
      ? [...WEB_REPORTER_SLUGS]
      : [];

  const facts: WebFact[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    try {
      // Read the scrub-guaranteed DisplayBrain projection (never raw output) so
      // no internal token can leak into a link. Best-effort per reporter.
      const { display } = await fetchBrain(s, { tier: 2 });
      for (const m of display.metrics) {
        if (!m.sourceUrl || seen.has(m.sourceUrl)) continue;
        seen.add(m.sourceUrl);
        const text = m.value.length > 160 ? m.value.slice(0, 159).trimEnd() + "…" : m.value;
        facts.push({
          text,
          source_url: m.sourceUrl,
          source_name: m.sourceLabel,
        });
        if (facts.length >= MAX_WEB_FACTS) return facts;
      }
    } catch {
      // A missing/edge reporter never breaks the primary answer.
    }
  }
  return facts;
}

/** Markdown link block the model must surface as the "## From The Web-" section. */
function renderWebFactsBlock(facts: WebFact[]): string {
  if (!facts.length) return "";
  const lines = facts
    .map((f) => `- [${f.text}](${f.source_url})${f.source_name ? ` — ${f.source_name}` : ""}`)
    .join("\n");
  return `\n\n## From The Web-\n${lines}`;
}

/**
 * Insert a block just BEFORE the report-link / freshness footer so the freshness
 * token stays the very last thing (operator: "freshness token at bottom"). Falls
 * back to appending if neither footer marker is present.
 */
function injectBeforeFooter(text: string, block: string): string {
  if (!block) return text;
  const markers = ["\n\nFull audit →", "\n\nFull breakdown →", "\n\n_Freshness:_"];
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx !== -1) return text.slice(0, idx) + block + text.slice(idx);
  }
  return text + block;
}

/**
 * One representative freshness token for the multi-brain location dossier's
 * `_meta`. A fan-out has no single canonical token, so surface the token of the
 * FIRST selected line — true-ZIP answers rank first (`selectDossierLines`), so
 * this is the token for the read the user actually asked about. The full
 * per-brain map still rides in `_meta.dossier.freshness_tokens`. Undefined when
 * out-of-scope (no lines), so `_meta` simply omits it.
 */
function representativeFreshnessToken(dossier: LocationDossier): string | undefined {
  for (const line of selectDossierLines(dossier.lines, 3)) {
    const tok = dossier.freshness_tokens[line.brain_id];
    if (tok) return tok;
  }
  return undefined;
}

export function buildMcpServer(server: McpServer): void {
  server.registerTool(
    "swfl_fetch",
    {
      // Card display name. SDK getDisplayName precedence is title →
      // annotations.title → name, so set BOTH: newer clients read the
      // top-level title, older ones read annotations.title — either way the
      // card reads "SWFL Data Gulf" instead of the humanized slug "Swfl fetch".
      title: "SWFL Data Gulf",
      description: TOOL_DESCRIPTION,
      inputSchema: {
        report_id: z
          .string()
          .refine((id) => VALID_REPORT_IDS.has(id), {
            message: `report_id must be one of: ${[...VALID_REPORT_IDS].join(", ")}`,
          })
          .optional()
          .describe(
            "Report to fetch. Omit for the master synthesis (recommended for first-call routing).",
          ),
        tier: z
          .union([z.literal(1), z.literal(2), z.literal(3)])
          .optional()
          .describe(
            "Output detail. 1 = conversational, 2 = structured (default), 3 = audit. Use 3 only when the user explicitly asks to verify or trace sources.",
          ),
        zip: z
          .string()
          .optional()
          .describe(
            'Optional 5-digit ZIP (e.g. "33913"). When set WITHOUT report_id (or with report_id="master"), returns every dataset covering that location at its true grain — a real per-ZIP number where we hold one, otherwise the county/region figure clearly labeled as covering that ZIP — directly in the response text. Pin report_id to a specific report to get only that report\'s per-ZIP detail row instead.',
          ),
      },
      annotations: { readOnlyHint: true, title: "SWFL Data Gulf" },
    },
    async ({ report_id, tier, zip }) => {
      // Location fan-out (§C / D1). A ZIP/location with NO pinned report (or
      // report_id="master") returns EVERY dataset covering that location at its
      // TRUE grain — a real per-ZIP number where we hold one, otherwise the
      // county/region figure LABELED as covering that ZIP so an aggregate can
      // never read as a ZIP-specific fact. Same resolver + dossier the
      // GET /api/z/{zip} and /api/where routes use, so the MCP reply matches
      // those endpoints. An explicit non-master report_id keeps today's
      // single-brain detail-row drill below (back-compat — Fix B).
      if (zip && zip.trim()) {
        const pinnedReport = report_id && report_id !== "master" ? report_id : null;

        if (!pinnedReport) {
          const t: 1 | 2 | 3 = tier ?? 2;
          try {
            const loc = await resolveLocation(zip.trim());
            // No request URL in the tool callback — Vercel's internal hostname
            // would leak — so use the env-derived canonical origin, as the
            // detail-row drill already does via resolveOrigin().
            const dossier = await assembleLocationDossier(loc, {
              origin: resolveOrigin(),
            });
            const repToken = representativeFreshnessToken(dossier);
            return {
              content: [
                {
                  type: "text" as const,
                  text: RESPONSE_CONTRACT + renderLocationDossierText(dossier, t),
                },
              ],
              _meta: {
                ...(repToken ? { freshness_token: repToken } : {}),
                rules: RULES_OF_ENGAGEMENT,
                geography: GEOGRAPHY_GAZETTEER,
                // The full multi-brain location dossier (every covering read +
                // per-brain freshness tokens) so a downstream Claude answers
                // follow-ups about this place without re-fetching.
                dossier,
              },
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Unexpected error resolving location "${zip}": ${(err as Error).message}`,
                },
              ],
              isError: true,
            };
          }
        }

        // Back-compat: an explicit non-master report_id returns ONLY that
        // report's per-ZIP detail row (the single-brain drill, Fix B) — the
        // row rides in the TEXT block so it survives clients that drop _meta.
        try {
          const { text, freshness_token } = await fetchDetailRow(pinnedReport, zip);
          return {
            content: [{ type: "text" as const, text: RESPONSE_CONTRACT + text }],
            _meta: { freshness_token, rules: RULES_OF_ENGAGEMENT },
          };
        } catch (err) {
          const message =
            err instanceof BrainNotFoundError
              ? `Report not found: "${pinnedReport}". Valid ids: ${[...VALID_REPORT_IDS].join(", ")}.`
              : `Unexpected error fetching "${pinnedReport}" zip="${zip}": ${(err as Error).message}`;
          return {
            content: [{ type: "text" as const, text: message }],
            isError: true,
          };
        }
      }

      const slug = report_id ?? "master";
      const t: 1 | 2 | 3 = tier ?? 2;

      try {
        const [{ text, freshness_token, output }, webFacts] = await Promise.all([
          fetchBrain(slug, { tier: t }),
          loadWebFacts(slug),
        ]);
        // Outside-source items ride in the TEXT (claude.ai drops _meta) as a
        // highlighted-link block, placed before the link + freshness footer.
        const bodyText = injectBeforeFooter(text, renderWebFactsBlock(webFacts));

        return {
          content: [{ type: "text" as const, text: RESPONSE_CONTRACT + bodyText }],
          _meta: {
            freshness_token,
            // The rules-of-engagement block + structured dossier travel with
            // every response so a Tier-3 Claude stays honest (cite / tag
            // inference / stop at grain) and can answer follow-ups from the
            // loaded bundle without re-fetching.
            rules: RULES_OF_ENGAGEMENT,
            // The areas we cover + a "map any real place to its pocket, never
            // reject" instruction, so a Tier-3 Claude resolves colloquial place
            // names ("Bonita Bay") itself instead of saying "not in our system".
            geography: GEOGRAPHY_GAZETTEER,
            dossier: buildDossier(output, freshness_token),
          },
        };
      } catch (err) {
        const message =
          err instanceof BrainNotFoundError
            ? `Report not found: "${slug}". Valid ids: ${[...VALID_REPORT_IDS].join(", ")}.`
            : err instanceof BrainBadTierError
              ? (err as Error).message
              : `Unexpected error fetching "${slug}": ${(err as Error).message}`;

        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }
    },
  );

  // Session 9 — the three capability-keyed project co-build WRITE tools.
  // Registered AFTER swfl_fetch so the read tool stays the primary card. Each
  // resolves a per-project key first; the bearer gate in auth.ts is untouched.
  registerProjectTools(server);
}
