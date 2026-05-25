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
  BrainNotFoundError,
  BrainBadTierError,
} from "@/lib/fetch-brain";
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

How to use it. Default behavior: call swfl_fetch with no arguments. You will get the master report at tier 2 — a structured summary with a headline conclusion, key metrics with sources, caveats, a link to the full report page, and a freshness token. Read it first. If the master conclusion points you at a specific upstream report by name, call swfl_fetch again with report_id set to that name. Do not fan out across every upstream; the master already aggregates them.

Tiers.
- tier: 1 — conversational, 2-5 sentences. Use when the user wants a quick read.
- tier: 2 (default) — structured: conclusion + metrics table + caveats.
- tier: 3 — raw audit dump with full citation table and internal identifiers. Use ONLY when the user explicitly asks to audit, verify, or trace sources.

Available reports.
${INVENTORY_MD}

Full structured view. Every response includes a link of the form https://www.swfldatagulf.com/r/{report_id} — point the user there for charts, the full metrics table, or to share the report.

STRICT OUTPUT RULES — follow these in every response, no exceptions:
- NEVER use internal report IDs in prose. Say "the tourism data" not "tourism-tdt". Say "the commercial real estate data" not "cre-swfl". Say "the master report" not "master brain".
- NEVER say "brain" — say "report" or "data" instead.
- NEVER surface internal routing logic ("macro-swfl emits no metrics", "punting to parent brain", "DAG resolver", etc.). If a report is empty, skip it silently.
- NEVER explain which report you fetched unless the user asked. Just answer the question with the data.
- Caveats about data freshness belong at the END of a response, one line, not at the top.`;

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
      },
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: CHART_RESOURCE_URI },
      },
    },
    async ({ report_id, tier }) => {
      const slug = report_id ?? "master";
      const t: 1 | 2 | 3 = tier ?? 2;

      try {
        const { text, freshness_token } = await fetchBrain(slug, { tier: t });

        return {
          content: [{ type: "text" as const, text }],
          _meta: { freshness_token },
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
