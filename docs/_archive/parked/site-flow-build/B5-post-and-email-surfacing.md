# B5 — Surface the post + email journeys · **Opus** · WAVE 3 · GATED (do not start yet)

**Goal:** make posting and emailing reachable in the UI. These are the two non-nav journey gaps the audit found.
**Blocked** on: SOCIAL BUILD `U4` (the Social lane) + payments/app-review (social go-live) + the operator's email
go-live call. Plan now; build when unblocked. **Re-probe the live workspace files before editing — SOCIAL BUILD
`U4` and FINAL BOSS Piece 1 also touch them.**

## State today (verified 2026-06-20)
- **Social posting = backend-only, invisible.** `lib/social/*` cores + adapters + token store landed (`SOCIAL_PUBLISH_ENABLED=false`, cron commented). `app/api/social/render/[format]` is a live authed endpoint **with no UI caller**. The user-facing `U1–U4` (connect OAuth, ask-AI compose, MCP, **workspace Social lane**) are **planned, unbuilt** — no button, lane, or MCP tool reaches social. Nothing is "MCP-only"; it is reachable by no interface.
- **Email:** the **platform digest** cron IS live (`daily-email-digest.yml`, to `/api/email/subscribe` subscribers). The **per-user send** (`email_schedules` "Send weekly" card) is **paused** — `email-scheduler.yml` schedule commented; needs the `claim_due_email_schedules` migration applied + `DIGEST_BROADCAST_SECRET` set (see `GO-LIVE/email-scheduler-unit-f.md`). So a user's "Send weekly" creates a row that never fires.
- **Discovery:** there is no `Email`/`Campaigns`/`Social`/`Send` entry anywhere; Contacts hides in the account dropdown only.

## Build (when unblocked)
1. **Social lane** — after `U4`: mount the Social lane in `DeliverableLanes.tsx` beside Built + Emailing, and wire `app/project/[id]/page.tsx` to fetch `social_schedules` (mirror the email-lane pattern). Add a "Social" entry to B1's `NAV_GROUPS`/workspace so the lane is reachable, not another orphan like `/api/social/render` is today.
2. **Email go-live** (operator-gated, ~2 hrs, irreversible-ish — treat as a migration): apply `claim_due_email_schedules`, set `DIGEST_BROADCAST_SECRET`, uncomment the `email-scheduler.yml` schedule. Verify one claim→send→`send_status=sent` (open check `email_scheduler_f_live_verify`).
3. **Surface Send + Contacts** — add a persistent "Send"/"Schedules" affordance on the project workspace (the Emailing lane currently only displays, never creates) and a nav path to Contacts beyond the account dropdown.

## Preserve
- Social stays hard-gated until payments + app-review clear (`SOCIAL_PUBLISH_ENABLED=false`). **Do not represent social as live** — backend-complete, surface+go-live pending.

## Gates
Standard done-bar + migration idempotent/row-count-verified + Vendor-First re-check of any platform API claim. `SESSION_LOG.md` · explicit-path staging · no autonomous push.
