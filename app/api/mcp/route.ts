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
const handler = createMcpHandler(
  buildMcpServer,
  {},
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
  const denied = await assertAuthorized(request);
  if (denied) return denied;
  return handler(request);
}

export async function DELETE(request: Request): Promise<Response> {
  const denied = await assertAuthorized(request);
  if (denied) return denied;
  return handler(request);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
