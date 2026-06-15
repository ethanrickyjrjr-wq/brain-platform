# Plan B — Carry-Back Bridge

**Status:** planned 2026-06-15 (operator-approved). **Model:** OPUS on the security path, SONNET on
UI/glue. **Depends on:** nothing hard (can build in parallel with A); shares one identity with A's
Task 8.5. **Stops at:** "project sitting in the web editor under a real account." Paying for send =
A rung 2 / Tier-2.

## Why B exists

The MCP conversation evaporates. A user adds the SWFL MCP to their own Claude (rung 0, free), has a
great cited-data conversation, and… when it ends, nothing carries over to the web where they could
build/refine/send. B is the bridge: **handoff → claim → account**, and nothing more.

## The inversion finding (verified in-session — do not re-litigate)

The drafted plan assumed B must *bind* a separate MCP identity to a web account. **It does not:**

- MCP write tools resolve `X-Project-Key` → `projects.mcp_key` (UNIQUE) → `projects.user_id`
  (`app/api/mcp/project-tools.ts:77-88`), and `projects.user_id` is a real **`auth.uid`** (RLS
  `FOR ALL USING (auth.uid() = user_id)`, `docs/sql/20260612_projects.sql`).
- So a **project-key MCP user is already a logged-in account** — work already saved; the build tool
  already returns `Built. Share this link: {origin}/p/{id}` (`project-tools.ts:404`).
- The **genuinely-evaporating case is the anonymous `swfl_fetch` user** — bearer gate OFF
  (`app/api/mcp/auth.ts:9-25`), read-only, writes nothing (`app/api/mcp/server.ts:58`).
- `mcp:<owner_uid>` meter rows **already exist** for build/item_add (`project-tools.ts:350,399`), so
  "MCP-connected" is **derivable** — **the `mcp_account_links` binding table is unnecessary.**

## Five locked decisions (operator-confirmed 2026-06-15)

1. **Capture scope = explicit handoff.** New keyless `swfl_project_handoff` MCP tool. **`swfl_fetch`
   stays read-only and is COMPLETELY UNTOUCHED by B** — no metering, gate, identity, or write on the
   read path. (Hard invariant. Limits get added later via the RESPONSE_CONTRACT hook, not the tool.)
2. **Orphan-account resolution (Q4).** Handoff does **not** mint a credential-less account. It writes
   a `claim_tokens` row + returns a claim link. **The account is created at CLAIM time** via the
   existing passwordless email login carrying `next=/claim?t=<token>`. Return path = the same email
   login at `swfldatagulf.com`. No account is reachable only via the ephemeral AI-session token.
   *Note:* the live login is **OTP numeric code** (`app/login/login-form.tsx`), not a clickable magic
   link (magic-link was killed by scanner prefetch-expiry). Wire the real OTP flow; both it and the
   email-link fallback (`/auth/callback?next=`) honor `next`. Do not resurrect a magic-link path.
3. **Transport = short-TTL `claim_tokens` table.** Opaque single-use token → row holds `items` jsonb,
   ~15-min TTL, consume-once. NOT signed-payload-in-URL (2k URL cap, `table_slice` overflow,
   replayable, base64url-HMAC footgun).
   - **Consume = atomic `UPDATE claim_tokens SET consumed_at = now() WHERE token = $1 AND consumed_at
     IS NULL AND expires_at > now() RETURNING items, title, project_id`** — row-locked, no TOCTOU.
     **Label it the UPDATE-guarded consume.** It is **not** `lib/email/idempotency.ts:claimOnce` (that
     is the INSERT-ON-CONFLICT variant); build and name the primitive actually used.
   - **Write path:** anonymous handoff has no `auth.uid` → `claim_tokens` INSERT is **service-role**;
     RLS **denies** anon/auth client SELECT of token rows (consume only through a server endpoint).
     After login, insert the project in a **fresh authenticated request** via the **cookie client (RLS
     `WITH CHECK`)**, reusing `projectItemsSchema` + the `/api/projects/import` insert. **Never
     `exchangeCodeForSession` + write in one handler.** Land at `/project/{id}` (editor), not `/p/{id}`.
4. **Identity = derive, drop the binding table.** Do NOT build `mcp_account_links`.
   `isMcpConnected(authUid)` = has a project with non-null `mcp_key` AND a `usage_events` row
   `mcp:<authUid>`. **Blind spot (intentional):** pure `swfl_fetch` readers leave no server-side
   trace — only matters if A's discount must reward non-builders (it should not), so **no read-path
   emit.**
5. **Shared identity lock.** B's claim flow and A's Task 8.5 use ONE identity (`auth.uid`). No
   parallel scheme.

## The claim lifecycle

```
[user's Claude, anonymous MCP]
  swfl_project_handoff({items, title?})
    └─ server: stamp(origin:"mcp") → projectItemsSchema → size/count guard
       → mintClaimToken(items,title)  [service-role INSERT, 15-min TTL, opaque token]
       → returns text: "Continue on the web: {origin}/claim?t=<token>"

[browser, logged OUT] GET /claim?t=<token>
  └─ server component reads token via service-role (PEEK, no consume)
     → renders read-only preview (title, item kinds/count) + "Sign in to claim"
     → /login?next=%2Fclaim%3Ft%3D<token>   (existing OTP login)

[OTP login completes] → fresh request → GET /claim?t=<token> [logged IN]
  └─ <ClaimOnLogin token=…/> (client) → POST /api/claim {token}
        ├─ cookie client auth.getUser()  (401 if none)
        ├─ consumeClaimToken(token)  [atomic UPDATE…RETURNING]
        │     ├─ won  → insert project (cookie client, RLS WITH CHECK, deterministic id,
        │     │          projectItemsSchema) → attachProjectId(token,id) → recordUse(action:"claim")
        │     └─ lost/already-consumed → compute id = hash(token).slice(0,12) DIRECTLY → return it
        │          (loser lands via the SAME formula — NEVER a row.project_id read)
        └─ → router.replace(`/project/${id}`)   (editor; immediately rebuildable via RLS)
```

**Race-proofing (operator fix):** the project insert uses a **deterministic token-derived
`projects.id`** (`hash(token).slice(0,12)`) → double-claim computes the same PK → idempotent (PK
conflict = no-op). **The loser computes that id DIRECTLY in `/api/claim` (same formula as the winner)
and navigates to it — it must NOT read `row.project_id`**, because `attachProjectId` is written
*after* the winner's insert and a concurrent loser may read it as null. `attachProjectId` is
winner-side observability/cleanup only.

## Components (small, isolated units)

| Unit | Responsibility | Mirror / reuse |
|---|---|---|
| `docs/sql/20260615_claim_tokens.sql` | the table; service-role ALL, no anon/auth SELECT | idempotent migration pattern |
| `lib/claim/claim-store.ts` | the ONLY module touching `claim_tokens` (`mintClaimToken`, `consumeClaimToken`, `attachProjectId`) | service-role client |
| `swfl_project_handoff` (in `app/api/mcp/project-tools.ts`) | keyless tool: stamp + schema + guard + mint + beacon | `addItemInput` shape, `stamp()` |
| `app/api/claim/route.ts` | consume + project insert (cookie client) | `app/api/projects/import/route.ts` |
| `app/claim/page.tsx` + `_components/ClaimOnLogin.tsx` | preview + POST-on-login | `app/project/_import/ImportDraftOnLogin.tsx` |
| `lib/identity/mcp-connected.ts` | `isMcpConnected(authUid)` derive helper (shared w/ A) | reads `projects` + `usage_events` |

## Security invariants (must hold — checked in B-6)

- `swfl_fetch` path is **byte-for-byte unchanged** by B.
- `claim_tokens` rows are never client-readable (service-role only; consume via server endpoint).
- Project insert bound to `auth.uid` **by the database** (cookie client + RLS `WITH CHECK`), never a
  hand-set `user_id` on a service-role write.
- Two-request flow: login redirect → fresh `/claim` request. No `exchangeCodeForSession` + write in
  one handler.
- Any HMAC (none strictly required — token is opaque-random): compare decoded digest Buffers with
  `timingSafeEqual`; tamper-tests corrupt **decoded bytes**, never the trailing base64url char.

## Task index

| File | Task | Model |
|---|---|---|
| `task-1-claim-tokens-migration-and-store.md` | table + `claim-store.ts`; run migration directly | OPUS |
| `task-2-swfl-project-handoff-tool.md` | keyless MCP tool; mint + beacon; fetch untouched | OPUS |
| `task-3a-claim-consume-and-insert-route.md` | `/api/claim` consume + RLS insert + deterministic id | OPUS |
| `task-3b-claim-page-and-hydration-ui.md` | `/claim` preview + `ClaimOnLogin` | SONNET |
| `task-4-mcp-connected-derivation.md` | `isMcpConnected` derive helper (shared w/ A 8.5) | SONNET |
| `task-5-response-contract-nudge.md` | contract nudge so Claude offers handoff; no fetch gate | SONNET |
| `task-6-tests-and-ship.md` | tests, green build, ledgers, push (operator-approved) | SONNET |

## Verification (end-to-end — when B is built)

See each task's acceptance test; the integrated flow:

1. `bun test` green; `tsc`; `eslint` clean.
2. `claim_tokens` exists; anon/auth direct SELECT denied; service-role works; `expires_at` indexed.
3. Anonymous `swfl_project_handoff` (no project key) → returns `{origin}/claim?t=<token>`,
   `handoff_mint` beacon row appears, oversize rejected, **`swfl_fetch` diff = empty.**
4. `/claim?t=<token>` logged-out → preview (no consume) → OTP login `next=/claim?t=…` → project under
   `auth.uid` → lands `/project/{id}` (editable, rebuildable).
5. **Two simultaneous claims on one token → both land on the same `/project/{id}`, no null-project
   error, no duplicate row.** Expired (>15 min) → friendly "link expired".
6. Sign out → revisit site → OTP same email → claimed project is in the editor. (Front-door UX = A.)
7. `isMcpConnected` true for `mcp_key` + `mcp:<uid>` row; false for web-only; **no
   `mcp_account_links` table; no read-path emit added.**
