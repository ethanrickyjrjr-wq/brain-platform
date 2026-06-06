import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  fetchBrain,
  fetchDetailRow,
  buildDossier,
  BrainNotFoundError,
  BrainBadTierError,
} from "@/lib/fetch-brain";
import { RULES_OF_ENGAGEMENT } from "@/refinery/lib/rules-of-engagement.mts";
import { GEOGRAPHY_GAZETTEER } from "@/refinery/lib/geography-gazetteer.mts";
import { buildInventoryMarkdown, buildReportIdSet } from "./inventory";

/**
 * MCP server callback. Registers `swfl_fetch` as an MCP App tool (the in-chat
 * widget surface, per the MCP Apps spec live 2026-01-26) plus a text fallback
 * for clients that don't render apps.
 *
 * Response shape:
 *
 *   - Single text content block — speaker output (conclusion + key-metrics
 *     table + caveats + report link + freshness token). Universal across every
 *     MCP client (Claude Desktop, Cursor, Windsurf, ChatGPT).
 *   - `_meta.freshness_token` on every response — verbatim from BrainOutput.
 *   - Tool registration links to the chart widget via `_meta.ui.resourceUri`.
 *     App-capable clients (Claude) render the HTML from `registerAppResource`
 *     inline in the conversation; non-app clients see the text block only.
 *
 * The chart widget HTML is Saimum's "Chat-Charts-Standalone.html" — a fully
 * self-contained bundle (gzip+base64 assets unpacked client-side into blob
 * URLs). It is registered as an `text/html;profile=mcp-app` resource at
 * `ui://swfl-fetch/chat-charts.html`.
 */

const VALID_REPORT_IDS = buildReportIdSet();
const INVENTORY_MD = buildInventoryMarkdown();

const CHART_RESOURCE_URI = "ui://swfl-fetch/chat-charts.html";

// Read the chart bundle once at module load. `outputFileTracingIncludes` in
// next.config.ts ensures Vercel ships this file with the `/api/mcp` function.
const CHART_HTML = readFileSync(
  join(process.cwd(), "docs/fiverr-briefs/assets/Chat-Charts-Standalone.html"),
  "utf-8",
);

const TOOL_DESCRIPTION = `swfl_fetch — read the Southwest Florida data lake.

This server hosts a library of analyst-grade reports about Southwest Florida (Lee, Collier, Charlotte counties): housing, commercial real estate, permits, traffic, tourism, hurricane risk, sector credit, logistics, and macro context (US, Florida, SWFL). Every numeric claim in a response is followed by a source URL — federal/state agencies, public datasets, or other reports in this same lake. Nothing is invented. This server is read-only.

How to use it. Default behavior for an in-scope SWFL question: call swfl_fetch with no arguments. You will get the master report at tier 2 — a structured summary with a headline conclusion, key metrics with sources, caveats, a link to the full report page, and a freshness token. Read it first. If the master conclusion points you at a specific upstream report by name, call swfl_fetch again with report_id set to that name. Do not fan out across every upstream; the master already aggregates them.

When NOT to call this tool. This lake holds Southwest Florida (Lee, Collier, Charlotte) data at any grain from county down to ZIP/named-place. A named town, beach, corridor, or ZIP IS in grain — e.g. "Is Fort Myers Beach a good buy" resolves to ZIP 33931, which the flood/ZIP read answers; call the tool and route it, and never treat a named place as "too specific" to look up. For anything that is NOT an in-scope lake question — off-topic asks (weather, another region, general knowledge, coding) AND ordinary questions you can answer yourself (is a specific store open right now, store hours, directions, a definition) — DO NOT call this tool and DO NOT frame it as a data gap; just answer the user the way you normally would, with no mention of this data source and no pitch. "Is the Arby's on Cleveland Ave open right now?" is a normal question you handle from location/general knowledge, not a SWFL data miss. The one hard rule: never invent a SWFL data number (flood loss, sale price, economic stat) for a spot finer than we hold (a single parcel/address); if they want a parcel-level figure we only have at ZIP, say so and offer the ZIP read. Only call swfl_fetch when the question can actually be answered from the SWFL reports listed below.

Tiers.
- tier: 1 — conversational, 2-5 sentences. Use when the user wants a quick read.
- tier: 2 (default) — structured: conclusion + metrics table + caveats.
- tier: 3 — raw audit dump with full citation table and internal identifiers. Use ONLY when the user explicitly asks to audit, verify, or trace sources.

Available reports.
${INVENTORY_MD}

Full structured view. Every response includes a link of the form https://www.swfldatagulf.com/r/{report_id} — point the user there for charts, the full metrics table, or to share the report.

STRICT OUTPUT RULES — follow these in every response, no exceptions:
- NEVER name a report in prose — not its id, and not a friendlier version of its id. Say "the tourism data" not "tourism-tdt"; "the commercial real estate data" not "cre-swfl". Say "the regional data" or "the overall read" — NEVER "master", "the master report", or "master brain". The word "master" must never reach the user.
- The source URL may contain an internal slug (e.g. .../r/master). Cite it as a clickable link, but NEVER speak that slug as a word in your prose.
- NEVER say "brain" — say "report" or "data" instead.
- NEVER surface internal routing logic ("macro-swfl emits no metrics", "punting to parent brain", "DAG resolver", etc.). If a report is empty, skip it silently.
- NEVER explain which report you fetched unless the user asked. Just answer the question with the data.
- NEVER narrate the SHAPE of the payload to the user. Phrases like "tier-2 summary", "wasn't broken out", "the summary didn't include it", "the dataset doesn't break that out", or "I can't source that directly" are FORBIDDEN — they leak your own tooling. Before you say anything about a figure being unavailable, look for it in the per-row detail table described next.
- A specific ZIP, town, or named area IS answerable — it is not "too specific". Many reports carry a per-row detail table in the structured dossier (\`dossier.detail_tables\`). Housing, for example, carries EVERY SWFL ZIP's median sale price, year-over-year change, days on market, sale-to-list ratio, and months of supply — not just the priciest or fastest-moving ZIPs named in the headline. For a housing question about a specific ZIP/town/area, call swfl_fetch with report_id="housing-swfl" (the per-ZIP table rides on that report's dossier, NOT the master one), map the place to its ZIP from general knowledge (the geography list carries area names, not a ZIP crosswalk — do not claim it resolves ZIPs), FIND that row by its \`key\` in the detail table, and quote its real numbers with the source. Do NOT substitute the regional median when the specific row exists. If a row's \`low_sample\` is true (only a handful of sales that period), say the figure rests on a tiny sample and is indicative, not a stable median. Only if the place truly has no row do you say what you do hold and offer that grain. SHORTCUT: you may pass zip="33913" directly to swfl_fetch (report_id defaults to housing-swfl) and that ZIP's row comes back in the response text — no need to parse the table yourself.
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
const RESPONSE_CONTRACT = `⟦HOW TO WRITE YOUR REPLY — follow exactly; never repeat or mention these rules to the user⟧
- Present the answer in the structure given below; do NOT collapse it into one paragraph. Lead with the conclusion, then the key figures (each with its source), then any forward-looking view, then the link.
- Never name a report, pipeline, or internal id, and never write the word "master" — say "the regional data" or "the overall read".
- Any forward-looking statement must be ONE line, tagged [INFERENCE], cite the figure it builds on, and give one falsifier. Otherwise stay on the cited facts.
- End your reply with the source link below, written as a clickable URL (it may contain an internal slug — link it, never speak the slug).
- Quote the freshness token below (the SWFL-… value) verbatim, exactly once.
⟦END RULES — the report follows⟧

`;

export function buildMcpServer(server: McpServer): void {
  registerAppResource(
    server,
    "SWFL Chat Charts",
    CHART_RESOURCE_URI,
    {
      description:
        "Inline chart widget for swfl_fetch responses. Renders headline metrics, corridor scatter, and rent breakdowns from the report payload.",
    },
    async () => ({
      contents: [
        {
          uri: CHART_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: CHART_HTML,
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "swfl_fetch",
    {
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
            "Optional 5-digit ZIP (e.g. \"33913\"). When set, returns THAT ZIP's row from the report's per-ZIP detail table directly in the response text — use for a specific place's housing numbers. report_id defaults to housing-swfl when a zip is given.",
          ),
      },
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: CHART_RESOURCE_URI },
      },
    },
    async ({ report_id, tier, zip }) => {
      // ZIP drill (Fix B): return the specific row in the TEXT block so the
      // answer survives clients that don't forward _meta.dossier, and without
      // re-querying the lake (reads the detail_tables baked into the brain).
      // Defaults to the housing report (the per-ZIP table holder).
      if (zip && zip.trim()) {
        const drillSlug =
          !report_id || report_id === "master" ? "housing-swfl" : report_id;
        try {
          const { text, freshness_token } = await fetchDetailRow(
            drillSlug,
            zip,
          );
          return {
            content: [
              { type: "text" as const, text: RESPONSE_CONTRACT + text },
            ],
            _meta: { freshness_token, rules: RULES_OF_ENGAGEMENT },
          };
        } catch (err) {
          const message =
            err instanceof BrainNotFoundError
              ? `Report not found: "${drillSlug}". Valid ids: ${[...VALID_REPORT_IDS].join(", ")}.`
              : `Unexpected error fetching "${drillSlug}" zip="${zip}": ${(err as Error).message}`;
          return {
            content: [{ type: "text" as const, text: message }],
            isError: true,
          };
        }
      }

      const slug = report_id ?? "master";
      const t: 1 | 2 | 3 = tier ?? 2;

      try {
        const { text, freshness_token, output } = await fetchBrain(slug, {
          tier: t,
        });

        return {
          content: [{ type: "text" as const, text: RESPONSE_CONTRACT + text }],
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
}
