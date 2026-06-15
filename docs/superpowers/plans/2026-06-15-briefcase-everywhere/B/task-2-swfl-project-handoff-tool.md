# B-2 — `swfl_project_handoff` keyless MCP tool — **OPUS**

## Goal
Let a user's Claude mint a carry-back link from an **anonymous** conversation (no project key), so the
work it assembled can be claimed on the web.

## Files
- `app/api/mcp/project-tools.ts` — register the new tool alongside `swfl_project_add/build/list`.
  (Tool wiring lives here; `app/api/mcp/server.ts` registers the `buildMcpServer()` toolset.)

## Behaviour
- **Keyless.** Unlike `add/build/list`, `swfl_project_handoff` does **NOT** require `X-Project-Key`
  and must **NOT** call `authorize()` / `resolveProjectByKey()`. It writes only to `claim_tokens`.
- **Input:** content-only items, mirroring the existing `addItemInput` shape
  (`project-tools.ts:145-177`) — the caller (Claude) supplies item *content*, never server-owned
  fields. Plus optional `title`.
- **Server-stamp + validate:** run each item through `stamp()` (`project-tools.ts:118-126`) to add
  `id`/`added_at`/`origin:"mcp"`, **then** validate the array with `projectItemsSchema`
  (`lib/project/items.ts`). Do **not** copy `/api/projects/import`'s "validate raw body" pattern —
  that path receives already-stamped web items; this one must stamp first.
- **Guards (storage-amplification mitigation):** reject if item count > 50 (matches `DRAFT_CAP`) or
  `JSON.stringify(items)` > ~256 KB. Clear error text back to the model.
- **Mint + return:** `mintClaimToken(items, title)` → return text:
  `Continue on the web (sign in to claim): {resolveOrigin()}/claim?t=<token>`.
- **Beacon (observability ONLY, never a gate):** `recordUseForClient(<beaconId>, { action:
  "handoff_mint", report_id: null, reach: [] })`. There is no cookie in the MCP transport, so
  `<beaconId>` is an IP-hash (reuse the `hmac16` pattern) or the literal `"mcp:anon-handoff"` — it is
  a usage beacon, not identity. Do **not** derive a per-user identity here.

## Hard invariants
- **`swfl_fetch` is untouched.** No metering/gate/identity/write added to the read path. A `git diff`
  of the `swfl_fetch` tool + its helpers must be empty.
- No limit/gate logic in this tool either (it's plumbing). Rate-limiting is the existing `/api/mcp`
  IP burst guard (`middleware.ts:17-24`) + the WAF; this tool just adds the beacon for visibility.

## Acceptance test
- Call `swfl_project_handoff` over the MCP transport with **no** project key and a small item set →
  returns `{origin}/claim?t=<token>`; a `claim_tokens` row exists with `origin:"mcp"`-stamped items.
- Items come back stamped (`origin:"mcp"`, `id`, `added_at`); a payload of 51 items or >256 KB is
  rejected with a clear message and **no** row written.
- A `handoff_mint` beacon row appears in `usage_events`.
- `swfl_fetch` behaviour and code path are byte-identical to before (diff = empty).
