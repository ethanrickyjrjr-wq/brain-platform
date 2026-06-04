/**
 * MCP auth gate.
 *
 * - MCP_BEARER_TOKEN not set → open (v1 backward-compatible mode).
 * - MCP_BEARER_TOKEN set     → require `Authorization: Bearer <token>` to match.
 *   Throws a Response(401) so Next.js App Router returns it directly to the caller.
 *   POST and DELETE in route.ts need no changes — the thrown Response propagates.
 */
export async function assertAuthorized(request: Request): Promise<void> {
  const expected = process.env.MCP_BEARER_TOKEN;
  if (!expected) return;
  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ")
    ? auth.slice("Bearer ".length)
    : "";
  if (provided !== expected)
    throw new Response("Unauthorized", {
      status: 401,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, Mcp-Session-Id",
      },
    });
}
