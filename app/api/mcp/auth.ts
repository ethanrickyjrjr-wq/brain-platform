/**
 * MCP auth gate — willingness-to-pay (WTP) test scaffold.
 *
 * Behavior is governed by the `MCP_ACCESS_TOKENS` env var (comma-separated
 * allowlist of bearer tokens):
 *
 *  - **Unset / empty → OPEN.** Byte-identical to the v1 no-op: the public MCP
 *    keeps working exactly as before. Nothing flips on a live surface until the
 *    operator deliberately issues a token.
 *  - **Set → CLOSED.** Every POST/DELETE must carry
 *    `Authorization: Bearer <token>` whose value is in the allowlist. A missing
 *    or unknown token gets a real `401` (with `WWW-Authenticate: Bearer`), not
 *    a 500.
 *
 * This is the smallest paid path: the operator creates a Stripe Payment Link
 * (no code — see `app/pricing/page.tsx`), and on payment issues the buyer a
 * token by appending it to `MCP_ACCESS_TOKENS` in the Vercel env. No billing
 * code, no route-handler refactor — exactly the single-function edit the v1
 * stub was built to allow.
 *
 * Returns `null` when the request is authorized (or auth is disabled), or a
 * `Response` the caller should return verbatim when it is not.
 */

const UNAUTHORIZED_HEADERS = {
  "WWW-Authenticate": 'Bearer realm="SWFL Data Gulf"',
  "Access-Control-Allow-Origin": "*",
};

/** Parse + cache the allowlist once per module load (env is fixed per deploy). */
function allowedTokens(): Set<string> {
  const raw = process.env.MCP_ACCESS_TOKENS ?? "";
  return new Set(
    raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  );
}

export async function assertAuthorized(
  request: Request,
): Promise<Response | null> {
  const allowed = allowedTokens();

  // No tokens configured → auth disabled → open (v1 behavior, unchanged).
  if (allowed.size === 0) return null;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();

  if (token && allowed.has(token)) return null;

  return Response.json(
    {
      error: "unauthorized",
      message:
        "This MCP server requires an access token. Get one at https://www.swfldatagulf.com/pricing",
    },
    { status: 401, headers: UNAUTHORIZED_HEADERS },
  );
}
