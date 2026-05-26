# Upstream Review — MCP Server v1 vs current ecosystem

_Audited 2026-05-26 against live vendor sources. Scrapes saved to `.firecrawl/` (mcp-handler, vercel-mcp-starter, better-auth-nextjs-demo) but those are point-in-time — re-fetch the URLs below before acting on anything here._

## TL;DR

Shipped code (`app/api/mcp/{route,server,auth,inventory}.ts`) matches current upstream patterns. No fixes required. Three v2 candidates parked below.

## Verified against upstream (no action needed)

| What we shipped                                                                                                                                                    | Upstream confirms                                                                                                                | Source                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `mcp-handler ^1.1.0` + `@modelcontextprotocol/sdk ^1.29.0`                                                                                                         | Latest mcp-handler is v1.1.0 (Mar 24, 2026). SDK 1.26.0 is the security floor; we're above it.                                   | https://github.com/vercel/mcp-handler                         |
| `createMcpHandler(buildMcpServer)` pattern in `route.ts`                                                                                                           | Quickstart shows this exact shape. Stateless per-request lifecycle is the default.                                               | mcp-handler README quickstart                                 |
| `registerAppTool` + `registerAppResource` from `@modelcontextprotocol/ext-apps` with `RESOURCE_MIME_TYPE` (`text/html;profile=mcp-app`) and `_meta.ui.resourceUri` | Matches the MCP Apps spec (live 2026-01-26). This is what the corrected plan's "MCP App response format" section calls for.      | `@modelcontextprotocol/ext-apps/server` typed surface         |
| Belt-and-suspenders `OPTIONS` + per-response CORS headers in `route.ts`                                                                                            | mcp-handler does emit CORS, but the Vercel ChatGPT starter explicitly ships its own middleware doing the same thing. Defensible. | vercel-labs/chatgpt-apps-sdk-nextjs-starter — `middleware.ts` |
| GET health-check short-circuit before `createMcpHandler`                                                                                                           | Not in the README, but `mcp-handler` only owns `POST` (and internal session handling) by design. Free to attach GET.             | mcp-handler quickstart implies this                           |
| `runtime = "nodejs"` + `dynamic = "force-dynamic"`                                                                                                                 | Required for `fs` reads of brain `.md` files. Edge has no fs.                                                                    | Next.js docs                                                  |
| `outputFileTracingIncludes` shipping the chart HTML                                                                                                                | Standard Next.js pattern for static asset bundling into serverless functions.                                                    | Next.js docs                                                  |

## False alarm

**`assetPrefix` in `next.config.ts`** — The Vercel ChatGPT starter calls this critical: "prevents 404s on `/_next/` files in iframe." It does NOT apply to us. Our chart widget is a self-contained HTML bundle (gzip+base64 assets unpacked client-side into blob URLs per the plan). It does not hydrate Next.js inside the iframe and does not request `/_next/*`. `assetPrefix` only matters when a Next.js app renders inside an iframe and tries to load its own bundles.

## v2 candidates (do not ship now)

### 1. ChatGPT widget rendering (OpenAI Apps SDK metadata)

The Vercel `vercel-labs/chatgpt-apps-sdk-nextjs-starter` shows how to register a tool such that it renders a widget **in ChatGPT** (not just Claude Desktop):

```ts
{
  "openai/outputTemplate": widget.templateUri,
  "openai/toolInvocation/invoking": "Loading...",
  "openai/toolInvocation/invoked": "Loaded",
  "openai/widgetAccessible": false,
  "openai/resultCanProduceWidget": true
}
```

Today our widget renders in Claude Desktop (MCP Apps spec) only. Adding the `openai/*` metadata above to `registerAppTool` would unlock the same widget in ChatGPT's Connectors UI. Verify against https://developers.openai.com/apps-sdk/build/mcp-server before adding — these keys drift.

Worth it only if ChatGPT-via-Connectors becomes a real distribution channel. The text-block fallback already works there.

### 2. OAuth / bearer-token auth for /vault write-back

`mcp-handler` ships a dedicated authorization doc: https://github.com/vercel/mcp-handler/blob/main/docs/AUTHORIZATION.md. When /vault write-back lands (v2, gated on multi-tenant migration of `personal_vault.vault_fragments`), this doc is the starting point — not "build OAuth from scratch."

For the auth provider itself, `better-auth` (https://github.com/better-auth/better-auth) is a real, well-maintained Next.js auth library. Its Next.js demo (`demo/nextjs`) is what we'd reference for the integration pattern, but the demo's README does not show MCP-specific code — the value is the auth primitives (email/password, passkeys, rate-limiting, sessions, org/teams), not an MCP example. Pair `mcp-handler/docs/AUTHORIZATION.md` with better-auth's session API at v2 time.

### 3. mcp-handler advanced docs

For Nuxt support, dynamic routing patterns, and configuration knobs not in the quickstart: https://github.com/vercel/mcp-handler/blob/main/docs/ADVANCED.md. Not needed for v1; bookmark for when we add a second tool or change transports.

## Action items

None. The remaining v1 ship-gate items (Vercel WAF rule, Anthropic Connectors directory submission) are unchanged by this review.
