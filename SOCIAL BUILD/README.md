# SOCIAL BUILD — assignment files (OUR SIDE)

One file = one ultracode Claude's complete job. Hand each file to a separate session.
Design source of truth: `docs/superpowers/specs/2026-06-20-social-auto-posting-design.md`.
Live-verify research: run `ingest/pipelines/social_best_practices/crawl_social_practices.py` (where the web is open) → `social-practices.json` feeds cadence/format defaults + verifies every platform API claim.

## The model (confirmed this session)
- **NO paid middleman at the start.** Direct platform APIs only — **X, Facebook + Instagram (Meta Graph), LinkedIn, Google Business Profile.** No Ayrshare/Buffer/Hootsuite we pay for.
- **Clients connect their own accounts** (OAuth) → we store + refresh their tokens → our cron posts on their behalf. Multi-tenant from day 1, `user_id`-namespaced. We dogfood on our own accounts as tenant #1 while app-reviews clear.
- **Go-live switch:** the whole pipeline runs in cost-free DRY mode (`SOCIAL_PUBLISH_ENABLED=false`, default). One flip (`node scripts/social.mjs go-live`) when payments are in. No code change at go-live.
- **App-review is the long pole** — a non-code track that must start **day 1** in parallel (X, Meta ×2 for Pages+IG with Business Verification, LinkedIn Community Management, Google Business Profile). Weeks each. Owner: operator.

## OUR SIDE vs USER SIDE
This folder is **OUR SIDE** — the backend/platform spine (data model, image rasterizer, platform adapters + token refresh, cron worker, deliverable template, engagement tracking).
The **USER SIDE** (connect-your-socials OAuth UX, the "just ask AI" command, the `swfl_social_*` MCP tool, the workspace Social lane) is **now planned** (2026-06-20): brief `USER-SIDE-HANDOFF.md` → spec `docs/superpowers/specs/2026-06-20-social-user-side-design.md` → build files **`U1–U4`** (below).
They meet at the seam: **`social_accounts` token store** (schema in 01, read/refresh lib in 03) + the **compose cores** (01) + the **`social_schedules` recipe + claim** (01) + one small **`frozen_post jsonb`** addition on `social_schedules` (01) that build 04 honors on first fire (see U2).

## Who builds what
**Opus** = visual/quality + no-invention + shared-file judgment. **Sonnet** = clone-and-rename of the proven email/outreach engine + vendor-doc-following.

| File | Build | Model |
|---|---|---|
| `01-spine-cores-and-go-live-switch.md` | Tables, claim RPC, pure DI cores, `lib/social/types.ts`, go-live switch | **Sonnet** |
| `02-social-image-rasterizer.md` | Reuse `chart-renderer` SVG + brand → PNG card per platform size | **Opus** |
| `03-platform-adapters-and-token-refresh.md` | X / Meta(FB+IG) / LinkedIn / GBP publish adapters + encrypted token store/refresh | **Sonnet** |
| `04-cron-worker-and-gha.md` | `run-schedules.mts` worker + `social-scheduler.yml` | **Sonnet** |
| `05-social-template-and-grain.md` | `"social"` deliverable template + place/county/ZIP grain | **Opus** |
| `06-engagement-tracking.md` | Engagement poll → `social_events` → metrics view | **Sonnet** |

## What can run together — concurrency matrix
The only real conflicts are same-file edits or a hard dependency. Run in stages:

### STAGE 1 — start now (2 Claudes)
- **01** (Sonnet) + **02** (Opus). No overlap.
- **01 must merge `lib/social/types.ts` + the migration FIRST** (small) — it's the shared interface + schema everyone codes against.

### STAGE 2 — after 01's types + migration land (2 Claudes)
- **03** (Sonnet) + **05** (Opus).
- 03 owns `lib/social/oauth-tokens.ts` (the USER SIDE seam). 05 **edits shared deliverable files** (`lib/deliverable/templates.ts`, `assemble.ts`) — see ⚠ below.

### STAGE 3 — after 01 + 02 + 03 merge (2 Claudes)
- **04** (Sonnet) + **06** (Sonnet). Both integrate the earlier builds via interfaces; neither edits the other's files.

### CANNOT-RUN-AT-SAME-TIME
| Pair | Why | Fix |
|---|---|---|
| 03/04/05/06 ✕ 01 (schema) | all import `lib/social/types.ts` + read `social_*` tables | 01 merges types + migration first |
| 04 ✕ 01, 02, 03 | 04's worker calls their code; needs them present (doesn't edit them) | run 04 in Stage 3 |
| 06 ✕ 01, 03 | poll needs the tables + platform read APIs | run 06 in Stage 3 |
| 05 ✕ any EMAIL deliverable work | 05 edits `lib/deliverable/templates.ts` + `assemble.ts` (shared with email) | don't run 05 while another session edits those two files |
| **USER SIDE** ✕ 01, 03 | connect-OAuth writes via 03's `oauth-tokens.ts`; command writes `social_schedules` (01) | plan anytime; build after 01 + 03 merge |

Peak useful concurrency: **2 Claudes** per stage. **02 (renderer) conflicts with nothing.**

## USER SIDE — build files (planned 2026-06-20)

The four user-facing surfaces. Plan in `docs/superpowers/specs/2026-06-20-social-user-side-design.md`.

> **STATUS (2026-06-20): backend 01 + 02 + 03 + 05 have LANDED on origin** (SESSION_LOG: Stage 1 pushed `577fecc6`; Stage 2 `aeec3ac4` (03) + `2c4319fc` (05)). The `01 + 03` dependency is **satisfied** → **Stage A (`U1` ‖ `U2`) is unblocked.** A local checkout behind origin must `git fetch` + rebase onto `origin/main` before building (`lib/social/*` cores, the `social_schedules` table, and `oauth-tokens.ts` live there). `U4` still waits on FINAL BOSS Piece 1. **Confirm the shipped `lib/social/oauth-tokens.ts` signatures (`storeTokens`/`retrieveTokens`/`refreshAccessToken`/`revokeToken`) at integration — they are now real, not spec'd.**

| File | Build | Model |
|---|---|---|
| `U1-connect-your-socials-oauth.md` | Per-platform OAuth start/callback/disconnect; calls `storeTokens`/`revokeToken` (03) | **Sonnet** |
| `U2-ask-ai-schedule-and-compose.md` | `schedule-command` two-step + multi-caption compose + frozen visual preview | **Opus** |
| `U3-mcp-social-tools.md` | `swfl_social_list` + `swfl_social_schedule` MCP tools (reuse U2's compose lib) | **Sonnet** |
| `U4-workspace-social-lane.md` | "Social posting" lane + connect block in the project workspace | **Opus** |

### USER SIDE concurrency
- **STAGE A — after 01 + 03:** `U1` (Sonnet) ‖ `U2` (Opus). No shared files. U2 also needs 02 (renderer).
- **STAGE B — after U2's `lib/social/*` merge:** `U3` (Sonnet) — imports U2's `validateSocialToolInput` + `composeCaptions`.
- **STAGE C — after 01 + FINAL BOSS Piece 1:** `U4` (Opus) — edits the live workspace files (`page.tsx`, `ProjectWorkspace.tsx`); run alone, re-probe those files first.

| Pair | Why | Fix |
|---|---|---|
| U1/U2/U3/U4 ✕ backend 01 + 03 | connect writes via 03's `oauth-tokens.ts`; all read/write `social_*` (01) | plan now; build after 01 + 03 merge |
| U2 preview ✕ backend 02 | PROPOSE renders the real PNG via `renderSocialImage` | U2 needs 02 merged |
| U3 ✕ U2 | U3 imports U2's compose/validation lib | land U2's `lib/social/*` first |
| **U4 ✕ FINAL BOSS Piece 1** | both edit `app/project/[id]/page.tsx` + `ProjectWorkspace.tsx` | U4 last; re-probe shared files |
| GBP (in U1) | allowlist-gated (0 QPM until Google approves) | parked / graduation-ready — do not block launch |

## Every file's done-bar (house rules)
- Build in DRY mode; never wire a live post that fires without `SOCIAL_PUBLISH_ENABLED=true`.
- Gates before push: `real-tsc` 0, eslint clean, `next build` ✓, relevant `bun test` green. Migrations idempotent + verified by row count. **New deps (sharp/@vercel/og/resvg-js) → `bun install` + commit `bun.lock` same push (lockfile gate).**
- `SESSION_LOG.md` entry on push; stage only your own files (explicit paths, never `git add -A`); no autonomous push.
- **Vendor-First:** re-verify the platform API claim (scopes/token TTL/app-review/rate limit/media-upload) against live docs — or the crawl output — before coding each adapter.
