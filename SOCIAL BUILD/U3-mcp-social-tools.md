# U3 — MCP tools `swfl_social_list` + `swfl_social_schedule`

| | |
|---|---|
| **Model** | **Sonnet** (clone the `project-tools` MCP registration pattern) |
| **Stage** | USER-SIDE — build after **U2** (shared compose/validation lib) + backend **01** (+ **02** for preview) |
| **Runs in parallel with** | **U1** (no shared files) |
| **CANNOT run with** | **U2** while U2's `lib/social/{schedule-command,compose-caption}.ts` are unmerged (U3 imports them) |
| **Blocked by** | U2 (`validateSocialToolInput`, `composeCaptions`), 01 (`social_schedules`, `computeNextRunAt`, `claimOnce`), 02 (`renderSocialImage`, for `preview`) |
| **Files (new)** | `app/api/mcp/social-tools.ts`, `app/api/mcp/__tests__/social-tools.test.ts` |
| **Gate** | register the two tools on the existing `/api/mcp` server; no new deps |

## Goal
Expose the same schedule capability over MCP so a user's AI can list + create social schedules by X-Project-Key. Mirror `project-tools.ts` exactly: `authorize` → resolve project from the key → read/write `social_schedules`. Two tools, one read-only, one write. Reuse U2's compose/validation lib (DRY — no second caption engine).

## Verified anchors (2026-06-20 — cite the symbol, never a line number)
- `keyFromHeader(extra: ToolExtra | undefined): string | null` — `app/api/mcp/project-tools.ts`. Reads `x-project-key` (lowercased by transport); array-or-string; `null` if absent.
- `resolveProjectByKey(db, key): Promise<ProjectKeyRow | null>` — service-role lookup on `projects.mcp_key`; returns `{ id, user_id, title, items, branding }`.
- `authorize(db, extra): Promise<{ project: ProjectKeyRow } | { error }>` — every handler starts here; `NO_KEY` / `INVALID_KEY` error responses.
- `server.registerTool(name, { title, description, inputSchema, annotations: { title, readOnlyHint, destructiveHint, idempotentHint } }, async (args, extra) => {...})`; response helpers `text(s)` / `errText(s)` (`{ content: [{type:'text', text}], isError? }`); `recordUseForClient(client_id, { report_id, reach, action }, user_id?)` beacon. **Write target is `project.id` from the key ONLY (LB-R6b) — args never carry identity.**
- **Counter-intuitive (verify behavior, not the flag):** in this file `readOnlyHint: false` appears on read-only tools too. Match the `swfl_project_list` (read) vs `swfl_project_add` (write) annotation pairing rather than trusting the name.
- **From U2:** `validateSocialToolInput(input): ValidationResult`, `composeCaptions({ grounded, platform, topic })`. **From 01:** `computeNextRunAt(spec)`, `claimOnce(db, key, ctx)`, `social_schedules`. **From 02:** `renderSocialImage(...)`.

## Build
1. **`app/api/mcp/social-tools.ts`** — export a `registerSocialTools(server)` that the `/api/mcp` route calls alongside `registerProjectTools` (follow how `project-tools.ts` is wired into the MCP server).
2. **`swfl_social_list`** (read-only): `inputSchema: {}`; annotations match `swfl_project_list` (read-only intent). Handler: `authorize` → `SELECT … FROM social_schedules WHERE user_id = project.user_id ORDER BY next_run_at` (service-role) → `describeSchedule(row)` one-liners (`'[1] linkedin · weekly Tue 9am ET · next Jun 23 · status active'`, via `formatScheduleSendTime`) → `text(list)`.
3. **`swfl_social_schedule`** (write): `inputSchema` (zod) `{ platform: enum, cadence: enum['daily','weekly','monthly'], day_of_week?: 0-6, day_of_month?: 1-28, send_hour_et: 0-23, scope_kind?: enum['zip','place','county'], scope_value?: string, content_template: string, hashtags?: string[], media_kind?: enum, preview?: boolean }`. Handler: `authorize` → `validateSocialToolInput(args)` → if `preview`: pull grounded content (01) + `composeCaptions` + `renderSocialImage` with a dry publisher → return the rendered preview as `text` (caption + a hosted image URL); else: `claimOnce(db, idempotencyKey, ctx)` (key = hash of platform+scope+cadence+template to dedupe retried calls) → `next_run_at = computeNextRunAt(spec)` → INSERT `social_schedules` **stamping `user_id = project.user_id`** → `recordUseForClient('mcp:'+project.user_id, { report_id: project.id, reach: [], action: 'schedule_social' }, project.user_id)` → `text(success)`. **Freeze the artifact identically to U2** (write `frozen_post` if the column exists; graceful skip otherwise).
4. Errors via `errText(...)` — actionable, customer-clean (no internal ids): "Missing content_template — give the AI a prompt or template text."

## Tests & gates
`authorize` rejects missing/invalid key (fail-closed, no fallback to args) · write target derived solely from key→`project.id` (args carry no identity) · `swfl_social_list` is read-only and lists the project's schedules · `swfl_social_schedule` validates inputs, computes `next_run_at`, INSERTs with `user_id=project.user_id` · idempotent re-submit (same args) doesn't double-schedule · `preview` mode renders without writing · real-tsc 0, eslint.

## Done =
`swfl_social_list` + `swfl_social_schedule` are live on `/api/mcp` (same X-Project-Key resolution as `swfl_project_build`); a user's AI can list and create social schedules (with optional preview), stamped to the project owner, idempotent, no live post fired.
