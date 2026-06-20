# U2 — "Just ask AI" schedule + compose (frozen visual preview)

| | |
|---|---|
| **Model** | **Opus** (no-invention moat + multi-caption compose + the frozen-preview judgment) |
| **Stage** | USER-SIDE — build after backend **01** (cores + `social_schedules`) + **02** (`renderSocialImage`) + **03** (token read/refresh) merge |
| **Runs in parallel with** | **U1** |
| **CANNOT run with** | nothing file-wise; **owns the shared social compose/command lib that U3 consumes** → land U2's `lib/social/*` before U3 builds |
| **Blocked by** | 01 (compose core + `social_schedules` + `claim` + `social_send_ledger`), 02 (`renderSocialImage`), 03 (`retrieveTokens`/`refreshAccessToken`) |
| **Files (new)** | `lib/social/schedule-command.ts`, `lib/social/compose-caption.ts`, `app/api/social/schedule-command/route.ts`, `lib/social/__tests__/schedule-command.test.ts`, `lib/social/__tests__/compose-caption.test.ts` |
| **Gate** | **determinism gate** (nonce test flips a *decoded* byte) · no new deps |

## Goal
Turn "post my Fort Myers Beach flood card to LinkedIn every Monday" into a scheduled recipe, and **show the user the actual branded post (image + ~3 caption options) before they confirm**. On confirm, **freeze** the approved artifact so the first fire posts exactly what they saw; later fires refresh only when data moves. Mirror the email schedule-command two-step exactly; the net-new piece is the compose-a-post-by-AI caption step.

## Verified anchors (2026-06-20 — cite the symbol, never a line number)
- `COMMAND_MODEL = "claude-haiku-4-5"` — `app/api/email/schedule-command/route.ts`. Forced-tool, two non-LLM PROPOSE lanes (`fromDeliverable`, `fromScope`) bypass the model via `deliverableToScheduleRecipe` and return the identical proposal shape.
- `SCHEDULE_COMMAND_TOOL` (name `propose_email_schedule_action`), `validateToolInput(input): ValidationResult`, `buildSystemPrompt(existing: ExistingSchedule[]): string` — `lib/email/schedule-command.ts`.
- `issueProposalNonce({ uid, pid, proposal, nowMs? }): string | null`, `verifyProposalNonce(token, { uid, pid, proposal, nowMs? }): NonceVerifyResult` — `lib/email/proposal-nonce.ts`. HMAC-SHA256, 15-min TTL, single-use; canonical proposal hash is order-independent.
- `claimOnce(db, key, ctx: SendLedgerContext): Promise<boolean>` — `lib/email/idempotency.ts`. `true` = won/proceed, `false` = already-claimed/skip. Key class `nonce:<nid>`.
- `computeNextRunAt(spec: CadenceSpec, fromUtc?): Date | null` + `CadenceSpec { cadence, day_of_week?, day_of_month?, send_hour_et }` + `formatScheduleSendTime(iso): string` — `lib/email/schedule-cadence.ts` (`Cadence = 'daily'|'weekly'|'monthly'`; `day_of_week` required for weekly, `day_of_month` 1–28 for monthly).
- `parseDeliverableScope(kind, value): DeliverableScope` — `lib/deliverable/parse-scope.ts` (`SCOPE_KINDS = {zip, place, county}` — **no corridor**; module-private — do not import the set).
- **Backend cores (build 01):** the compose/`build-content` core returns grounded content `{ caption, hashtags, freshness, image? }` and keeps the `.in_scope` MOAT gate. **Backend 02:** `renderSocialImage({ model|svg, theme, format }): Buffer`. **`social_schedules`** cols (build 01): `platform, cadence, day_of_week, day_of_month, send_hour_et, scope_kind, scope_value, content_template, hashtags, media_kind, next_run_at, last_run_at, status`.

## Build
1. **`lib/social/schedule-command.ts`** — `SOCIAL_SCHEDULE_COMMAND_TOOL` (name `propose_social_schedule_action`): actions `create | pause | stop | change-cadence | change-platform`; fields `platform, schedule_id, cadence, day_of_week, day_of_month, send_hour_et, ambiguous_hour, scope_kind, scope_value, topic, content_template, hashtags, media_kind`. `validateSocialToolInput(input): ValidationResult` (zod defense-in-depth; `send_hour_et` 0–23; cadence enum; `scope_kind ∈ {zip,place,county}`). `buildSocialSystemPrompt(existing): string` carrying the per-platform caption rules (char + hashtag caps, spec §5) + the no-invention instruction (never fabricate engagement numbers; numbers come only from the dossier).
2. **`lib/social/compose-caption.ts`** — `composeCaptions({ grounded, platform, topic }): Promise<{ captions: string[]; hashtags: string[] }>` — **the net-new compose-a-post-by-AI step.** Takes the grounded content object from build 01 (numbers verbatim), calls Haiku (`claude-haiku-4-5`, forced-tool) to produce **~3 platform-shaped caption variants** (U-D6), runs the **no-invention number lint** (every numeric literal must trace to `grounded`; placeholder literals throw). "Deterministic math, narrative prose": numbers are code-sourced, only prose is model-generated. **Build 01's core does NOT emit variants — that is owned here.**
3. **`app/api/social/schedule-command/route.ts`** — two-step:
   - **PROPOSE:** parse NL (`SOCIAL_SCHEDULE_COMMAND_TOOL` via Haiku) OR the deterministic lanes → pull grounded content from build 01's compose core → `composeCaptions(...)` → `renderSocialImage(...)` (build 02) → `issueProposalNonce({ uid, pid, proposal })` → return `{ proposal, preview: { image_url, captions, hashtags }, proposal_nonce }`.
   - **CONFIRM:** `validateSocialToolInput(proposal)` → `verifyProposalNonce(token, { uid, pid, proposal })` → `claimOnce(db, 'nonce:'+nid, ctx)` (single-use; lose → 409) → build `CadenceSpec` → `next_run_at = computeNextRunAt(spec)` → INSERT `social_schedules` (chosen caption + `hashtags` + `media_kind` + scope via `parseDeliverableScope`) → **freeze the artifact** (step 4). Render the "first send" line with `formatScheduleSendTime(next_run_at)`.
4. **FREEZE the approved artifact (§2.5 of the spec).** On confirm, persist `{ caption, media_url, hashtags, freshness_token, composed_at }` as `social_schedules.frozen_post` (jsonb). **Seam coordination (small backend additions — flag in builds 01 + 04):** build 01 adds the `frozen_post jsonb` column; build 04's worker, on the **first** fire, posts `frozen_post` verbatim, and on later fires re-composes only when `freshness_token` advances (overwrite `frozen_post`), else skip + re-arm. **Graceful fallback if the column isn't there yet:** skip the freeze; the first fire re-composes (may differ slightly from preview). Do not block U2 on the column — write the recipe regardless.
5. **DRY invariant:** confirm only ever writes a recipe/`frozen_post`; it NEVER calls `postToChannel` or triggers a live post. Publishing is the cron's job, gated by `SOCIAL_PUBLISH_ENABLED`.

## Tests & gates
**Nonce single-use test — flip a DECODED byte, not a base64url char** (the flaky-`proposal-nonce` ~6.5%/push lesson) · `composeCaptions` returns ≤3 variants and the **no-invention lint throws on any number not in `grounded`** (the "beautiful template shipped fake $412K" tripwire) · per-platform caption char/hashtag caps enforced · PROPOSE returns image + captions + nonce; CONFIRM rejects a tampered/replayed nonce (409) · `computeNextRunAt` fed a valid `CadenceSpec`; out-of-footprint scope refuses (never a "representative" ZIP) · real-tsc 0, eslint, relevant `bun test` green.

## Done =
A user asks the AI to schedule a post, sees the real branded image + ~3 caption options, confirms, and a `social_schedules` recipe + frozen first post is written — single-use nonce enforced deterministically, no invented numbers, no live post fired.
