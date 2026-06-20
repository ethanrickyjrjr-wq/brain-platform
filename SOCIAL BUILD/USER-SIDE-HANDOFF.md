# USER SIDE — Social Campaign Builder (planning handoff)

> ✅ **PLANNED 2026-06-20.** This brief has been turned into a spec + build files. **Spec:** `docs/superpowers/specs/2026-06-20-social-user-side-design.md`. **Build files:** `U1`–`U4` in this folder + the USER-SIDE section in `README.md`. Operator decisions baked in: full visual preview, frozen-on-confirm (refresh only when data moves), disconnect = auto-pause + revoke, reconnect-on-expiry, GBP parked (Operation Dumbo Drop), ~3 caption options per platform, no Bluesky. The text below is the original brief, kept for provenance.

**For:** a fresh Claude to **plan out** (brainstorm → spec → implementation plan). This is NOT a ready-to-execute build file — it's a scoped, code-verified brief. Start with `superpowers:brainstorming`, write the spec to `docs/superpowers/specs/`, then `superpowers:writing-plans`.

**Context:** We're building client-facing social auto-posting (mirror of the email campaign). The **OUR SIDE** backend (data model, image rasterizer, platform adapters + token store/refresh, cron worker, deliverable template, engagement tracking) is specced in this same `SOCIAL BUILD/` folder + `docs/superpowers/specs/2026-06-20-social-auto-posting-design.md`. **YOUR job is the four user-facing surfaces** below. Platforms: **X, Facebook + Instagram, LinkedIn, Google Business Profile.** Model: clients connect their own accounts → our cron posts for them. No paid middleman. Everything DRY until the `SOCIAL_PUBLISH_ENABLED` go-live flip.

**RULE 0.5 — probe before you plan.** Every anchor below was code-verified on 2026-06-20, but re-open each file before speccing; the repo moves.

---

## The four USER-SIDE surfaces to plan

### 1. "Connect your socials" — OAuth flow (per platform)
The "if they connect their socials, will we auto-run their posts?" answer is **yes** — once connected, OUR cron (build 04) reads the refreshed token and posts. You build the connect UX + callback.
- **Proven precedent to mirror:** `app/api/email/contacts/google/start/route.ts` + `.../callback/route.ts` + `lib/email/google-oauth.ts` (`buildGoogleAuthUrl({state, redirectUri})`, `exchangeCodeForToken({code, redirectUri})`). CSRF via an httpOnly state cookie (`OAUTH_STATE_COOKIE`, 10-min TTL).
- **Per platform:** `/api/social/connect/[platform]/start` (build authorize URL + scopes + state cookie → redirect) and `/api/social/connect/[platform]/callback` (verify state → exchange code → **store tokens**).
- **SEAM → OUR SIDE:** the callback persists via **`storeTokens(...)` in `lib/social/oauth-tokens.ts` (build 03)** into `social_accounts`. ⚠ The google-contacts precedent does NOT persist tokens — encrypted storage is new and owned by build 03; you call it, you don't reimplement it.
- **New design:** per-platform scopes + the disconnect flow (revoke + pause schedules).

### 2. "Just ask AI" — schedule-command route
- **Proven precedent (mirror EXACTLY):** `app/api/email/schedule-command/route.ts` + `lib/email/schedule-command.ts` (forced-tool Haiku, `SCHEDULE_COMMAND_TOOL`, `validateToolInput`, `buildSystemPrompt`) + `lib/email/proposal-nonce.ts` (`issueProposalNonce({uid,pid,proposal})`, `verifyProposalNonce(token,{...})`) + `claimOnce(db,key,ctx)` (`lib/email/idempotency.ts:48-84`). **Two-step PROPOSE → CONFIRM with a signed single-use nonce.**
- Build `app/api/social/schedule-command/route.ts` + `lib/social/schedule-command.ts`: a `SOCIAL_SCHEDULE_COMMAND_TOOL` (actions create/pause/stop/change-cadence/change-platform; fields platform, cadence, day_of_week, day_of_month, send_hour_et, content_template, hashtags, media_kind). On confirm, write a `social_schedules` row (compute `next_run_at` via `computeNextRunAt`).
- **SEAM → OUR SIDE:** writes `social_schedules` (build 01); nonce + `social_send_ledger` reused as-is.
- **Determinism gate:** the nonce single-use test must flip a *decoded* byte, not a base64url char (the flaky-`proposal-nonce` lesson — ~6.5%/push red otherwise).

### 3. MCP tool `swfl_social_*`
- **Proven precedent:** `app/api/mcp/project-tools.ts` — `swfl_project_build` (`:384-447`), `authorize(db, extra)`, `keyFromHeader(extra)` (X-Project-Key header), `server.registerTool(name, {title, description, inputSchema, annotations}, handler)`.
- Add `swfl_social_list` (read schedules, `readOnlyHint`) + `swfl_social_schedule` (create/update). Same X-Project-Key → project resolution.
- **SEAM → OUR SIDE:** reads/writes `social_schedules`; can call the compose cores (build 01) for a preview.

### 4. Workspace "Social" lane
- **Proven precedent:** `app/project/[id]/workspace/DeliverableLanes.tsx` — Built lane (`:163-221`) + Emailing lane (`:223-235`); `EmailScheduleRow` in `app/project/[id]/workspace/types.ts:59-72`.
- Add a third `<section>` "Social posting" with a `SocialScheduleCard` (platform, cadence, status, last/next run), a `SocialScheduleRow` type, the `socialSchedules` prop, and the fetch in `app/project/[id]/page.tsx`. ⚠ This edits the workspace files — coordinate with any concurrent workspace work.

---

## Seam map (where USER SIDE meets OUR SIDE)
| USER SIDE surface | calls / writes | OUR SIDE owner |
|---|---|---|
| connect callback | `storeTokens()` → `social_accounts` | `lib/social/oauth-tokens.ts` (build 03) |
| schedule-command confirm | INSERT `social_schedules` + `claimOnce` | tables + RPC (build 01) |
| MCP `swfl_social_schedule` | INSERT `social_schedules` | build 01 |
| Social lane | SELECT `social_schedules` | build 01 |
| (all auto-posting) | cron reads token + posts | builds 03 + 04 |

## Has NO precedent — design new
1. Per-platform OAuth scopes + authorize URLs (X PKCE, Meta Pages+IG, LinkedIn, GBP).
2. Disconnect / revoke flow.
3. Social-specific command fields (hashtags, media_kind) + system prompt.
4. The compose-a-post-by-AI content step (distinct from *scheduling*) — caption + hashtags shaped per platform, no-invention on numbers.

## Dependencies / sequencing
- You can **plan** now. **Building** needs builds **01** (tables, schedule-command target, cores) and **03** (`oauth-tokens.ts`) merged first.
- Everything DRY until go-live; human confirm before any publish; never an autonomous post.

## Deliverable from this handoff
A spec in `docs/superpowers/specs/` + an implementation plan covering the four surfaces above, with their own `[USER SIDE]` build files if you want to parallelize (mirror this folder's model/concurrency convention).
