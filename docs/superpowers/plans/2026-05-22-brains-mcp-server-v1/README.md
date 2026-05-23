# SWFL Data Lake — MCP Server v1

_Planned 2026-05-22. Source-of-truth durable copy of the plan-mode draft at `~/.claude/plans/let-s-plan-this-out-declarative-conway.md`._

## Context

Today, the only way for someone's Claude to consume the data lake is to paste a multi-paragraph protocol block into their CLAUDE.md by hand. That protocol drifts the moment we change anything, and every new tester is a manual onboarding. Ontology doc §6.7 calls for an MCP server that replaces the copy-paste protocol with a tool the user's Claude can call directly. v1 ships **fetch only** — read access to the SWFL data lake through one tool. Write-back (/vault) is explicitly deferred; it needs multi-tenancy (`user_id` column + RLS) the current `personal_vault` schema is not set up for.

The wedge: hand a tester a URL (or eventually a click), and their Claude can answer SWFL questions with sourced numbers, without them needing to learn the underlying data structure.

## Locked decisions

- **Transport:** Remote Streamable HTTP at `https://brain-platform-amber.vercel.app/api/mcp`. Same Next.js app as `/api/b/[slug]`. No new project.
- **Tool shape:** One tool — `swfl_fetch(report_id?, tier?)`. Defaults: `report_id="master"`, `tier=2`. Master-first routing flow encoded in the tool description (matches today's CLAUDE.md protocol).
- **Auth:** Open, mirrors `/api/b`. Middleware hook stubbed so adding bearer-token gating later is a single-function edit.
- **Voice:** Plain language, "SWFL data lake" framing. No internal jargon in user-visible copy or tool description.
- **Install path:** Landing page at `/connect`. Lead CTA is a one-line `claude mcp add ...` snippet with a copy button. Manual JSON for Claude Desktop in a collapsed accordion. A `claude://`-style deep-link button is treated as progressive enhancement and only published after Ricky verifies it works on his machine — there is no public standard for that URI today.
- **Out of scope for v1 ship gate:** /vault write-back, OAuth, paywall. Anthropic Connectors directory: submit in parallel, do not gate the ship — but treat the submission as high priority, not an afterthought (see out-of-scope section and risks).

## Implementation

### New files

- `app/api/mcp/route.ts` — Next.js route handler built on `mcp-handler` (formerly `@vercel/mcp-adapter`). Exports `GET`, `POST`, `OPTIONS`, `DELETE` from `createMcpHandler(...)`. `runtime = "nodejs"`, `dynamic = "force-dynamic"`. Body: `await assertAuthorized(request)` runs first; the rest is `mcp-handler`'s wrapper around our `buildMcpServer()` callback. **`GET` short-circuits before `createMcpHandler` and returns the health check response (see GET health check section below).**
- `app/api/mcp/server.ts` — `buildMcpServer(server)` callback. Registers the `swfl_fetch` tool with a Zod schema (`report_id` validated via `z.string().refine(id => BRAIN_CATALOG.some(c => c.id === id))` — **note: `z.enum()` does not compile with a dynamic `string[]`; always use `z.string().refine()` for catalog-backed enums**), `tier` literal union over `1|2|3`, interpolates the inventory into the tool description at module load. Pure function — `mcp-handler` constructs and lifecycles the `McpServer` instance. **The tool handler must return `{ content: [...], isError: true }` on failure — never throw.**
- `app/api/mcp/inventory.ts` — `buildInventoryMarkdown()` and `buildReportIdList()` read from `refinery/packs/catalog.mts` (the leaf-only catalog — see below). Inventory grows when scaffold appends a new entry to the catalog; zero manual edits to the MCP code.
- `refinery/packs/catalog.mts` — **new leaf file, zero pack imports.** Static literal: `export const BRAIN_CATALOG: ReadonlyArray<{ id: string; scope: string; domain: BrainDomain; ttl_seconds: number }> = [...]`. Imports only the `BrainDomain` type from `refinery/types/pack.mts`. Source of truth for the MCP capability inventory. Hand-maintained by scaffold (see edits below); a unit test in `refinery/packs/catalog.test.mts` asserts `catalog.mts` entries match the pack IDs registered in `refinery/packs/index.mts` — **this test MUST be wired into CI; catalog drift cannot be a post-ship verification.**
- `lib/fetch-brain.ts` — internal helper. Same disk-read + speaker-render pipeline as `app/api/b/[slug]/route.ts:46-79`. Returns `{ text, freshness_token }`. **MANDATORY shared use** — both `/api/mcp` and `/api/b/[slug]` MUST import from here in this PR. Living under `lib/` (not `app/api/mcp/`) so the import direction stays sane.

  Add `CANONICAL_ORIGIN` at the top of this file:

  ```ts
  const CANONICAL_ORIGIN =
    process.env.BRAIN_PLATFORM_URL ??
    `https://${process.env.VERCEL_URL}` ??
    "https://brain-platform-amber.vercel.app";
  ```

  Thread into the `speak()` call. **Correctness fix: report links are `null` without this.**

- `app/api/mcp/auth.ts` — `assertAuthorized(req: Request): Promise<void>`. v1 returns immediately. Future bearer-token check goes here.
- `app/connect/page.tsx` — server component landing page. Ricky writes the body copy; the page imports the interactive components below.
- `app/connect/install-button.tsx` — client component. Renders the "copy `claude mcp add` command" button (clipboard) and the Claude Desktop manual-install accordion.
- `app/connect/waitlist-form.tsx` — client component. Email + interest checkboxes. POSTs to `/api/waitlist`. Inline success/error state.
- `app/api/waitlist/route.ts` — `POST` handler. Validates email shape, inserts into `public.waitlist`. Returns `{ ok: true }` on success; treats `unique(email)` violation as a clean `{ ok: true, already_subscribed: true }`. **No in-process rate limiting** — that's a Vercel WAF rule (see below).
- `docs/sql/20260522_waitlist.sql` — DDL for `public.waitlist`: `id uuid pk`, `email text not null`, `interests text[] not null default '{}'`, `source text` (e.g. `"connect"`), `created_at timestamptz default now()`, `unique(email)`. `GRANT INSERT ... TO service_role`. No RLS — write-only from the server.

### Edits

- `package.json` — add `mcp-handler` (Vercel's official Next.js wrapper). Add `@modelcontextprotocol/sdk` as a transitive peer (mcp-handler depends on it; keep an explicit dep so we can register tools against the same types). Add `@modelcontextprotocol/inspector` to `devDependencies` for verification.
- `middleware.ts:13` — add `/api/mcp` AND `/api/waitlist` to the matcher exclusion next to the existing `/api/b/` carve-out. Paste-ready regex:
  ```
  /((?!api/b/|api/mcp|api/waitlist|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)/
  ```
- `app/api/b/[slug]/route.ts:46-79` — switch to importing the shared pipeline from `lib/fetch-brain.ts`. No behavior change.
- `refinery/scaffold.mts` — extend the existing per-pack write to also append a row to `refinery/packs/catalog.mts`. Same atomic-write pattern as the existing `refinery/packs/index.mts` append (Brain Factory Decision E).
- **App nav** — add `/connect` link to the navigation (at minimum, the footer).

### Infrastructure (no code)

- **Vercel WAF rate-limit rule** on the project: `POST /api/waitlist`, 5 requests/minute per IP. Hobby plan includes 1 free rule — use it here. No in-memory rate limiting — it's a no-op on stateless serverless functions and would be false confidence.

### MCP transport pattern

**Primary path: `mcp-handler` (npm).** Default plan of record. Run **stateless** — `createMcpHandler` defaults to per-request lifecycle. The package handles the Fetch ↔ Node-stream shim, transport instantiation, and (per current docs) CORS preflight. Our code stays on one side of that boundary: `buildMcpServer(server)` registers tools, mcp-handler does the rest.

**Fallback (only after a 30-minute spike confirms mcp-handler blocks us):** drop to the raw `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` and write the Fetch-to-Node shim ourselves. The fallback is not the plan of record.

### GET health check

`GET /api/mcp` must return a 200 JSON response (not 405):

```json
{ "server": "SWFL Data Lake", "tool": "swfl_fetch", "reports": N, "status": "ok" }
```

Where `N` is `BRAIN_CATALOG.length`. `mcp-handler` handles `POST`; the `GET` path in `route.ts` must short-circuit before calling `createMcpHandler` and return this response.

### CORS

Verify mcp-handler's emitted headers in the first Inspector run (verification step 2). If preflight is not handled or the headers are missing, add an explicit `OPTIONS` export to `app/api/mcp/route.ts` returning 204 with:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization, Mcp-Session-Id`

Mirror those headers on every `POST` response. MCP Inspector runs in a browser; without CORS, verification fails on step 2. **If `mcp-handler` does not emit these headers automatically, `route.ts` MUST export `OPTIONS`.**

### `_meta` freshness token

Every MCP tool response must include `_meta: { freshness_token: "..." }` alongside the text content block. The freshness token comes from `lib/fetch-brain.ts`'s `{ text, freshness_token }` return value:

```ts
return {
  content: [{ type: "text", text }],
  _meta: { freshness_token },
};
```

### MCP App response format

`swfl_fetch` returns **two content blocks** on every response: a text block (consumed by all clients) and a structured data block (rendered as an MCP App widget in Claude). Non-Claude clients ignore the second block silently — no conditional branching in server code; always emit both.

**Data contract for `server.ts` (lock this shape before building):**

```ts
// Text block — all clients
{ type: "text", text }

// MCP App block — Claude renders this as an inline widget; other clients ignore it
{
  type: "resource",
  resource: {
    uri: `swfl://report/${report_id}`,
    mimeType: "application/vnd.anthropic.mcp-app+json",
    text: JSON.stringify({
      report_id:       string,          // e.g. "master"
      tier:            1 | 2 | 3,
      freshness_token: string,          // verbatim from BrainOutput
      conclusion:      string,          // BrainOutput.conclusion
      key_metrics:     Array<{
        label:      string;
        value:      string;
        source_url: string;
      }>,
      caveats:         string[],
      report_url:      string,          // CANONICAL_ORIGIN + "/r/" + report_id
    }),
  },
}
```

**Full response shape:**

```ts
return {
  content: [
    { type: "text", text },
    {
      type: "resource",
      resource: {
        uri: `swfl://report/${report_id}`,
        mimeType: "application/vnd.anthropic.mcp-app+json",
        text: JSON.stringify(mcpAppPayload),
      },
    },
  ],
  _meta: { freshness_token },
};
```

**Why lock this now:** Retrofitting the structured block after launch means a breaking change to any Claude session that parsed the first response shape. `server.ts` must emit both blocks from day one.

**Verify before building:** Confirm the `mimeType` value against current Anthropic MCP Apps documentation — `application/vnd.anthropic.mcp-app+json` is the design intent; the published spec is authoritative.

### Tool description (first draft, ~340 words)

> **swfl_fetch — read the Southwest Florida data lake.**
>
> This server hosts a library of analyst-grade reports about Southwest Florida (Lee, Collier, Charlotte counties): housing, commercial real estate, permits, traffic, tourism, hurricane risk, sector credit, logistics, and macro context (US, Florida, SWFL). Every numeric claim in a response is followed by a source URL — federal/state agencies, public datasets, or other reports in this same lake. Nothing is invented. This server is read-only.
>
> **How to use it.** Default behavior: call `swfl_fetch` with no arguments. You will get the `master` report at tier 2 — a structured summary with a headline conclusion, key metrics with sources, caveats, a link to the full report page, and a freshness token. Read it first. If the master conclusion points you at a specific upstream report by name, call `swfl_fetch` again with `report_id` set to that name. Do not fan out across every upstream; the master already aggregates them.
>
> **Tiers.**
>
> - `tier: 1` — conversational, 2–5 sentences. Use when the user wants a quick read.
> - `tier: 2` (default) — structured: conclusion + metrics table + caveats.
> - `tier: 3` — raw audit dump with full citation table and internal identifiers. Use **only** when the user explicitly asks to audit, verify, or trace sources.
>
> **Available reports.** `<inventory injected from BRAIN_CATALOG at boot>`
>
> **Full structured view.** Every response includes a link of the form `https://brain-platform-amber.vercel.app/r/{report_id}` — point the user there for charts, the full metrics table, or to share the report.

### Landing page (`/connect`)

Install instructions are presented as **four client tabs** (accordions on mobile). Each tab shows only what's relevant to that client.

**Tab 1 — Claude (CLI)**

Primary CTA — copy-paste one-liner:

```
claude mcp add --transport http swfl https://brain-platform-amber.vercel.app/api/mcp
```

Helper text: "Run this in your terminal where Claude Code is installed."

Tertiary (gated on Ricky's verification): "Add to Claude" deep-link button. If the `claude://mcp/install?...` URI doesn't work on his machine, hide the button. No published spec for that URI exists today.

**Tab 2 — Claude Desktop**

Steps: Open Claude Desktop → Settings → Developer → Edit Config. Add to `mcpServers`. Save and restart.

```json
{
  "mcpServers": {
    "swfl": {
      "url": "https://brain-platform-amber.vercel.app/api/mcp",
      "transport": "http"
    }
  }
}
```

Config file paths:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Tab 3 — Cursor**

Steps: Cursor Settings → Features → MCP → Add server. Or paste directly into the config file:

- macOS/Linux: `~/.cursor/mcp.json`
- Windows: `%USERPROFILE%\.cursor\mcp.json`

```json
{
  "mcpServers": {
    "swfl": {
      "url": "https://brain-platform-amber.vercel.app/api/mcp",
      "transport": "http"
    }
  }
}
```

Reload Cursor after saving.

**Tab 4 — Windsurf**

Steps: Windsurf Settings → Cascade → MCP Servers → Add. Or paste directly into:

- macOS/Linux: `~/.codeium/windsurf/mcp_config.json`
- Windows: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`

```json
{
  "mcpServers": {
    "swfl": {
      "url": "https://brain-platform-amber.vercel.app/api/mcp",
      "transport": "http"
    }
  }
}
```

Reload Windsurf after saving.

**Note — ChatGPT Desktop:** Supports remote MCP via Settings → Connected Apps → Add MCP server. URL: `https://brain-platform-amber.vercel.app/api/mcp`. Exact UI path is subject to OpenAI updates — verify before publishing instructions.

#### Below the install — three short sections

**1. Get on the list.** Email capture form with checkbox interests. Final wording is Ricky's; suggested skeleton:

> **Be first in line.** Drop your email and pick what you want to hear about.
>
> - [ ] New data lakes (Tampa, Miami, statewide Florida)
> - [ ] Your own vault — save what your Claude figures out, so the next conversation builds on the last
> - [ ] Sharper numbers — new sources, tighter confidence math, contradiction surfacing
> - [ ] Delivered to Slack — your team sees the read without leaving the channel
> - [ ] Reports as documents — ask Claude for a sourced PDF or doc, get one
>
> One email per update. No spam, no resharing.

(Five checkboxes; tune wording to match Ricky's voice. The interest list is stored as `text[]` so we can segment when it's time to announce.)

**2. Need help?** No phone — async only.

> **Stuck on install or want a walkthrough?** Ping us in the support channel — usually answered same-day.
>
> - [Open Slack/Discord invite](#) ← Ricky fills in the actual URL, or swap for an email contact

Realistic v1: a Slack or Discord invite link Ricky controls. A real "Slackbot walkthrough agent" is a separate build (see parked plan `project_slack-brain-surface.md` in memory) — for now, the link points to a human. Phrase it as a support channel, not as "Ricky's DMs."

**3. Privacy line** (small, near the form):

> Your email and interests stay on our Supabase. We don't sell, share, or feed them to any third party. Unsubscribe by replying once.

Ricky owns the final wording on all three; the structure and what the form persists is locked.

## Expansion architecture

Single codebase, area parameterized via env vars. New area = new Vercel project + new catalog + these env vars:

| Env var         | SWFL v1                           | Example future area                |
| --------------- | --------------------------------- | ---------------------------------- |
| `AREA_NAME`     | `SWFL`                            | `Tampa Bay`                        |
| `AREA_SLUG`     | `swfl`                            | `tampa`                            |
| `AREA_COUNTIES` | `Lee, Collier, Charlotte`         | `Hillsborough, Pinellas, Pasco`    |
| `CATALOG_PATH`  | `refinery/packs/catalog-swfl.mts` | `refinery/packs/catalog-tampa.mts` |

Tool name derived from `${AREA_SLUG}_fetch`. Tool description auto-fills county names from `AREA_COUNTIES`. No hardcoded geographic strings in code.

## Critical files

- `app/api/b/[slug]/route.ts:26-88` — the existing endpoint being wrapped. Switches to `lib/fetch-brain.ts` in this PR; one code path, not two.
- `refinery/packs/index.mts:38-55` — `PER_PACK_REGISTRY`, the full pack tree. **Not** imported by `/api/mcp` — too heavy a transitive graph (pack files pull source connectors → DuckDB, dlt, etc.). The MCP route reads from `refinery/packs/catalog.mts` instead.
- `refinery/packs/catalog.mts` — new leaf catalog file, source of truth for the MCP capability inventory. Drift against `PER_PACK_REGISTRY` is caught by `refinery/packs/catalog.test.mts` — **must be in CI, not a post-ship verification**.
- `refinery/scaffold.mts` — must learn to append to the catalog file alongside `refinery/packs/index.mts`. Same Decision-E atomic-write pattern.
- `refinery/render/speaker.mts` — already produces LLM-safe text for tier 1/2 and the raw audit for tier 3. No changes needed.
- `middleware.ts:13` — matcher exclusion, must include `/api/mcp` and `/api/waitlist`.
- `app/r/[slug]/page.tsx` — heavy-detail report page that every MCP response links to.

## Verification

1. **Local dev.** `bun next dev` (or `npm run dev`). Server on `:3000`.
2. **MCP Inspector.** `npx @modelcontextprotocol/inspector` → UI on `localhost:6274`. Connect to `http://localhost:3000/api/mcp` with transport `Streamable HTTP`. Expect `tools/list` to return one tool (`swfl_fetch`). Call it with empty args; expect the tier-2 master payload as a text content block carrying the freshness token.
3. **Curl smoke test.** Raw JSON-RPC `initialize` → `tools/list` → `tools/call`. Confirms the transport without a client.
4. **Claude Code locally.** `claude mcp add --transport http swfl-local http://localhost:3000/api/mcp`. In a fresh session, ask "what does the SWFL data lake say about housing right now?" — confirm the tool fires and the response carries source URLs.
5. **Vercel preview deploy.** Push branch. Hit preview URL's `/api/mcp` with Inspector again. Confirm `Access-Control-Allow-Origin: *` and `force-dynamic` are present.
6. **Waitlist smoke test.** Submit the form against the preview deploy. Confirm the row lands in `public.waitlist` with the expected `interests` array. Resubmit the same email — expect a clean "already on the list" UI, not a 500.
7. **Production.** Final Inspector run against `brain-platform-amber.vercel.app/api/mcp` before pointing testers at `/connect`.

## Costs

- $0/mo on Vercel current setup (Hobby covers all expected v1 traffic).
- Optional ~$10–15/yr for a custom domain.
- User-Claude tokens are the user's bill, not ours.

## Risks to flag

- **`claude://mcp/install?...` deep-link spec** — no published standard. Treat as upside, not v1 dependency.
- **`mcp-handler` API surface** — confirm it exposes enough control over tool registration and response shape for our needs against the installed package. If it doesn't, the fallback is the raw SDK shim — flagged in the transport section but not the default plan of record.
- **CORS** — assumed handled by `mcp-handler`; verified in step 2 of verification. If missing, the explicit `OPTIONS` export is the fix.
- **Stateless transport is a conscious choice.** Vercel functions are ephemeral; stateful would need Redis. Read-only fetch doesn't need state.
- **Waitlist abuse vector.** The `unique(email)` constraint blocks duplicate floods. Unique-garbage floods are blocked by the Vercel WAF rule (5 req/min/IP). No in-process rate limit — it's a no-op on serverless and would be false confidence.
- **Catalog drift.** `refinery/packs/catalog.mts` is hand-maintained alongside `refinery/packs/index.mts`. A unit test guards parity. **The test must be wired into CI before merge — catalog drift cannot be a post-ship verification.**
- **`runtime = "nodejs"` is mandatory.** Disk reads (`fs`) are not available on Edge.
- **Tier 3 leaks internal pack IDs by design** (`speaker.mts:17-19`). Tool description tells the LLM to use tier 3 only on explicit audit requests; a determined model can still call it. Acceptable — the data is already public via `/api/b`.
- **Vault confusion.** Existing `/vault` is a single-tenant Claude Code slash command that writes to _Ricky's_ Supabase. Not shippable through the MCP server until a multi-tenant migration lands. Landing page should mention vault as "coming soon," not "available."
- **Anthropic directory: privacy policy is a hard gate.** Submission requires a live, complete `/privacy` page. Missing or incomplete privacy policies result in immediate rejection. Build the page before submitting — not after.

## Out of scope (parked for v2)

- /vault write-back (needs `user_id` + RLS migration on `personal_vault.vault_fragments`).
- Bearer-token auth, paywall, OAuth.
- **Anthropic Connectors directory listing** — submit in parallel; do not gate v1 ship. **Treat as high priority, not an afterthought:** the Suggested Connectors feature means Anthropic can proactively surface "SWFL Data Lake" to Claude users mid-conversation when SWFL context is relevant — that distribution is worth the submission queue. **Hard blocker: a live, complete privacy policy page is required for submission. Missing or incomplete privacy policies result in immediate rejection.**
- A second/third tool. One tool keeps the routing flow legible to the model.

---

## /connect — Design Brief

_This brief is for Claude.ai (web or desktop) artifact/UI prototyping. Not a spec for code. The engineer reads the sections above; this brief is the handoff to a design artifact session._

**Page name:** SWFL Data Lake

**Overall tone:** Professional, direct, no jargon. "SWFL Data Lake" framing throughout. No "Brains" anywhere on the page.

---

### Primary CTA block

**Headline:** Connect your AI to the SWFL Data Lake

**Subhead (one line):** Analyst-grade Southwest Florida data — housing, commercial real estate, permits, traffic, macro. Every number sourced to a federal or state dataset. Read-only.

**Install section — four tabs (or accordions on mobile):** Claude (CLI) | Claude Desktop | Cursor | Windsurf

**Tab: Claude (CLI)**

Large, centered monospace code block with a "Copy" button on the right:

```
claude mcp add --transport http swfl https://brain-platform-amber.vercel.app/api/mcp
```

Small helper text: "Run this in your terminal where Claude Code is installed."

Tertiary: "Add to Claude" deep-link button — hidden until Ricky verifies the `claude://` URI on his machine. If not verified, omit; the CLI snippet is sufficient.

**Tab: Claude Desktop**

1. Open Claude Desktop → Settings → Developer → Edit Config
2. Add to `mcpServers`:
   ```json
   {
     "mcpServers": {
       "swfl": {
         "url": "https://brain-platform-amber.vercel.app/api/mcp",
         "transport": "http"
       }
     }
   }
   ```
3. Save and restart.

Config file paths:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Tab: Cursor**

1. Cursor Settings → Features → MCP → Add server. Or paste into the config file:
   - macOS/Linux: `~/.cursor/mcp.json`
   - Windows: `%USERPROFILE%\.cursor\mcp.json`
2. Add to `mcpServers`:
   ```json
   {
     "mcpServers": {
       "swfl": {
         "url": "https://brain-platform-amber.vercel.app/api/mcp",
         "transport": "http"
       }
     }
   }
   ```
3. Reload Cursor.

**Tab: Windsurf**

1. Windsurf Settings → Cascade → MCP Servers → Add. Or paste into:
   - macOS/Linux: `~/.codeium/windsurf/mcp_config.json`
   - Windows: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`
2. Add to `mcpServers`:
   ```json
   {
     "mcpServers": {
       "swfl": {
         "url": "https://brain-platform-amber.vercel.app/api/mcp",
         "transport": "http"
       }
     }
   }
   ```
3. Reload Windsurf.

**Note — ChatGPT Desktop:** Supports remote MCP via Settings → Connected Apps → Add MCP server. URL: `https://brain-platform-amber.vercel.app/api/mcp`. Exact UI path subject to OpenAI updates — verify before publishing instructions.

---

### Section 1 — Waitlist form

**Heading:** Be first in line

**Copy:** Drop your email and pick what you want to hear about.

**Email input:** placeholder `your@email.com`, required.

**Checkboxes (5):**

1. New data lakes (Tampa, Miami, statewide Florida)
2. Your own vault — save what your Claude figures out, so the next conversation builds on the last
3. Sharper numbers — new sources, tighter confidence math, contradiction surfacing
4. Delivered to Slack — your team sees the read without leaving the channel
5. Reports as documents — ask Claude for a sourced PDF or doc, get one

**Submit button:** "Join the list"

**Success state (inline, no redirect):** "You're on the list."

**Already subscribed state (inline):** "You're already on the list."

**Privacy line (small text, below submit):** Your email and interests stay on our Supabase. We don't sell, share, or feed them to any third party. Unsubscribe by replying once.

---

### Section 2 — Support

**Heading:** Need help?

**Copy:** Stuck on install or want a walkthrough? Ping us in the support channel — usually answered same-day.

**Link:** [Open support channel](#) ← Ricky replaces `#` with the actual Slack or Discord invite URL, or an email contact address.

---

### Component order (top to bottom)

1. Nav — minimal. Logo + `/connect` link highlighted. No other nav items required in v1.
2. Primary CTA block — headline, subhead, install section (4 client tabs: Claude CLI, Claude Desktop, Cursor, Windsurf), ChatGPT note, optional deep-link button for Claude CLI tab.
3. Section 1 — Waitlist form (email input + 5 checkboxes + submit + privacy line).
4. Section 2 — Support link.
5. Footer — privacy line repeated or linked. No marketing copy.

No hero image. No pricing table. No testimonials in v1.
