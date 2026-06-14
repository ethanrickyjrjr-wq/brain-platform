import { createMcpHandler } from "mcp-handler";
import { buildMcpServer } from "./server";
import { assertAuthorized } from "./auth";
import { buildReportIdList } from "./inventory";

/**
 * Remote Streamable HTTP MCP server for the SWFL Data Gulf.
 *
 * Transport: `mcp-handler` (Vercel's official Next.js wrapper). Stateless —
 * `createMcpHandler` defaults to per-request lifecycle, which is what we want
 * for a fetch-only server on ephemeral serverless functions.
 *
 * Routes:
 *  - GET    /api/mcp  → health-check JSON. Short-circuits before mcp-handler
 *                       so `curl` and uptime probes see something useful.
 *  - POST   /api/mcp  → MCP JSON-RPC over Streamable HTTP. Auth gate runs first.
 *  - DELETE /api/mcp  → session termination per MCP spec. Auth gate.
 *  - OPTIONS /api/mcp → explicit CORS preflight. Belt-and-suspenders in case
 *                       mcp-handler doesn't emit the headers on its own (the
 *                       v1 plan calls this out as a fallback).
 *
 * `nodejs` runtime is mandatory — `lib/fetch-brain.ts` reads brain `.md`
 * files from disk and Edge isolates have no `fs` access. `force-dynamic`
 * because brain outputs change on rebuild and Vercel mustn't cache.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `basePath: "/api"` is load-bearing. Without it, mcp-handler defaults
// `streamableHttpEndpoint` to "/mcp" and matches `url.pathname === "/mcp"`.
// Our route lives at `/api/mcp`, so the path comparison fails and the handler
// returns 404 for every POST. See mcp-handler/dist/index.mjs:194-228.
// SSE is disabled — we run stateless on Vercel functions and don't have Redis.
// Inline brand mark as a `data:` URI so the connector icon can NEVER fail to
// fetch — no network dependency, can't 404, survives a sandbox CSP. It is our
// three-wave gulf mark on a dark rounded tile. `data:` srcs are explicitly
// allowed by the MCP Icon spec. The hosted PNG rides as a higher-res second
// option for clients that prefer a sized raster.
const ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" rx="14" fill="#0b1620"/>` +
  `<g fill="none" stroke="#0a8078" stroke-width="6" stroke-linecap="round">` +
  `<path d="M10 22 q11 -10 22 0 t22 0"/>` +
  `<path d="M10 34 q11 -10 22 0 t22 0" opacity="0.85"/>` +
  `<path d="M10 46 q11 -10 22 0 t22 0" opacity="0.6"/>` +
  `</g></svg>`;
const ICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(ICON_SVG)}`;

const handler = createMcpHandler(
  buildMcpServer,
  {
    // Server identity + icon the client shows next to the connector name.
    // mcp-handler types `serverInfo` as { name, version } only, but forwards the
    // whole object to `new McpServer()`, whose SDK `Implementation` type DOES
    // carry `icons` (verified: ImplementationSchema.icons in the installed SDK).
    // The cast lets the icon survive compile and reach the initialize result so
    // a client renders OUR logo instead of its default triangle. Icon shape
    // verified live against the MCP 2025-11-25 schema:
    //   Icon { src, mimeType?, sizes?: string[], theme? }, MIME image/png.
    serverInfo: {
      name: "SWFL Data Gulf",
      version: "1.0.0",
      icons: [
        // Embedded — can't fail to fetch (answers "what if the logo doesn't
        // load"). If a client ignores connector icons entirely, it still shows
        // the server name "SWFL Data Gulf" as text.
        { src: ICON_DATA_URI, mimeType: "image/svg+xml", sizes: ["any"] },
        // Higher-res raster of the brand logo (public/logo.png, 512x512) for
        // clients that prefer a sized PNG. NOTE: claude.ai does not yet render
        // serverInfo icons at all — it shows a generic globe regardless of this
        // field (open enhancement: anthropics/claude-ai-mcp#152). So this only
        // takes effect in clients that already honor `serverInfo.icons`; it's
        // forward-looking for claude.ai. The embedded data: SVG above is the
        // primary (can't fail to fetch); this raster is the fallback.
        {
          src: "https://www.swfldatagulf.com/logo.png",
          mimeType: "image/png",
          sizes: ["512x512"],
        },
      ],
    } as unknown as { name: string; version: string },
  },
  { basePath: "/api", disableSse: true },
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

export async function GET(): Promise<Response> {
  return Response.json(
    {
      server: "SWFL Data Gulf",
      tool: "swfl_fetch",
      reports: buildReportIdList().length,
      status: "ok",
    },
    { headers: CORS_HEADERS },
  );
}

export async function POST(request: Request): Promise<Response> {
  await assertAuthorized(request);
  return handler(request);
}

export async function DELETE(request: Request): Promise<Response> {
  await assertAuthorized(request);
  return handler(request);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
