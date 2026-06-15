# B-4 — `isMcpConnected` derive helper — **SONNET**

## Goal
Give A's rung-2 discount (and any future MCP-connected logic) a single derive function — **no binding
table**, per the locked identity decision.

## Files
- **NEW** `lib/identity/mcp-connected.ts` — `isMcpConnected(authUid: string): Promise<boolean>`.
  Shared with **A Task 8.5** (uid-attribution) / the send-discount logic.

## Logic (derive only)
`true` iff BOTH hold for `authUid`:
1. the account owns a `projects` row with **non-null `mcp_key`** (they wired the MCP), AND
2. there is a `usage_events` row with `client_id = "mcp:" + authUid` (they actually *built/added* via
   MCP — these rows already exist from `project-tools.ts:350,399`).

Single query or two cheap existence checks; read via the appropriate client. No writes. No new table.

## Intentional blind spot (document in the file)
Pure `swfl_fetch` **readers** leave no server-side trace (the read path is unmetered and stays that
way — B does not touch it). So a user who only ever *read* via MCP and never built will derive
`false`. **That is correct:** the discount rewards builders, not anonymous readers. **Do NOT add a
read-path emit to make readers detectable** — it would violate the "fetch untouched" invariant for no
product reason.

## Invariants
- One identity: `auth.uid` (== `mcp:<uid>` == `projects.user_id`). No parallel scheme.
- Derive, never persist a binding. `mcp_account_links` must not exist.

## Acceptance test
- Account with a project carrying `mcp_key` + an `mcp:<uid>` build/item_add row → `true`.
- Web-only / email-only account (no `mcp_key`, no `mcp:<uid>` row) → `false`.
- Account with `mcp_key` but zero `mcp:<uid>` rows (wired but never built) → `false`.
- Grep confirms no `mcp_account_links` table and no new read-path emit were introduced.
