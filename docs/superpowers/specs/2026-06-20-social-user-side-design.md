# Social Auto-Posting — USER-SIDE Design Spec (the four user-facing surfaces)

**Date:** 2026-06-20
**Status:** Design approved (brainstorm complete). Companion to the OUR-SIDE program spec; goes to per-surface build files (`U1–U4`) next.
**Author:** session 2026-06-20 (grounded by a 5-agent code-verified probe + a 5-agent cited Vendor-First/competitor-UX web pass).

> **Scope.** This spec covers ONLY the user-facing social surfaces: (1) connect-your-socials OAuth, (2) the "just ask AI" schedule+compose command with a frozen visual preview, (3) the `swfl_social_*` MCP tools, (4) the workspace "Social posting" lane + connect block. The backend spine (data model, image renderer, platform publish adapters + encrypted token store/refresh, cron worker, deliverable template, engagement tracking) is specced separately in `SOCIAL BUILD/01–06` and is referred to here as "the backend builds." The two meet at the seams in §6.

> **Authoritative-source rule (RULE 0.5 / probe-first).** Where the OUR-SIDE program spec `docs/superpowers/specs/2026-06-20-social-auto-posting-design.md` (its body, below the Revision-2 header) conflicts with `SOCIAL BUILD/01–06` + `README.md` + `USER-SIDE-HANDOFF.md` + the actual code, **the build files and code win.** §3 lists every drift this resolves. Every anchor in this spec was re-opened and verified on 2026-06-20; cite the symbol, never a line number (line ranges drift — see drift #4).

---

## 0. One-paragraph summary

The social posting features a user touches, built by mirroring the email-campaign engine the same way the backend builds do. A user connects their own social accounts (OAuth, per platform), then tells the AI in plain language to post a branded card on a cadence ("post my Fort Myers Beach flood card to LinkedIn every Monday"). **Before confirming, they see the actual branded post — image + caption — rendered exactly as it will publish.** On confirm, that first post is **frozen**: the cron posts precisely what was approved on the first fire, and on each later fire it re-composes only when the underlying brain data has actually moved (the freshness gate); stale data → skip, never a re-post of unchanged numbers. The same capability is exposed over MCP (`swfl_social_list` + `swfl_social_schedule`) and managed in the project workspace ("Social posting" lane + a connect block). Everything runs DRY behind `SOCIAL_PUBLISH_ENABLED` (default false); human-confirm is mandatory; nothing ever auto-posts without a human in the loop.

---

## 1. Locked decisions

| # | Decision | Choice |
|---|---|---|
| U-D1 | Preview at PROPOSE | **Full visual preview** — PROPOSE composes (backend 01) + renders the real branded PNG (backend 02) and shows image + caption(s) before confirm. |
| U-D2 | First-post freshness | **Frozen-on-confirm.** The approved artifact is stored and posted verbatim on the first fire; later fires re-compose only when the brain `freshness_token` advances (freshness gate); unchanged → skip + re-arm. |
| U-D3 | Disconnect behavior | **Auto-pause + revoke** — revoke the token at the platform, set `social_accounts.status='revoked'`, auto-pause (not delete) that platform's active `social_schedules`. Reconnect can resume. |
| U-D4 | Reconnect-on-expiry | **Float-to-top + in-place "Reconnect"** (Buffer pattern) — an expired/revoked account surfaces at the top of the connect block with a single reconnect action that re-runs OAuth without delete/re-add. |
| U-D5 | GBP scope | **Parked (Operation Dumbo Drop).** Build the connect UI + the v4 `localPosts` path, but gate it "pending Google approval" and do NOT block launch on it. Launch with X + Meta + LinkedIn; GBP graduates with zero code change when allowlist access lands. |
| U-D6 | AI captions | **Multiple options (~3) per platform**, user picks + edits inline before confirm; never auto-commit an AI caption. |
| U-D7 | Platforms | **X, Facebook + Instagram (one Meta adapter), LinkedIn, Google Business Profile (parked).** No Bluesky. |

**Carried defaults (locked, inherited from the program spec — not re-litigated):**
- **Build/preview is FREE (login capture); publish is the paywall.** Watermark rides in the artifact, never a block. ([[feedback_build-monetization-model]] — builds free forever, send is the paywall.)
- **Human confirm before any publish** — non-negotiable. Never an autonomous post.
- **No-invention number lint** on every caption and every graphic — verbatim from the brain dossier; placeholder literals fail the build.
- **Everything DRY** until `SOCIAL_PUBLISH_ENABLED=true` (repo var, default false). The flag gate lives in the cron worker (backend 04); the user surfaces only ever write a recipe / queued row, never trigger a live post.
- Sibling `social_*` tables, `user_id`-namespaced from day 1 (multi-tenant-ready).

---

## 2. The four surfaces

### 2.1 U1 — Connect your socials (OAuth, per platform)

Mirror the Google-Contacts OAuth precedent exactly, with the one net-new difference that the callback **persists** tokens.

- **Precedent (verified 2026-06-20):** `lib/email/google-oauth.ts` — `buildGoogleAuthUrl({ state, redirectUri }): string`, `exchangeCodeForToken({ code, redirectUri }): Promise<string>`. `app/api/email/contacts/google/start/route.ts` + `callback/route.ts` — CSRF via an httpOnly state cookie (`OAUTH_STATE_COOKIE = "g_contacts_oauth"`; the handoff's `OAUTH_STATE_COOKIE` was a placeholder name — the literal value is `g_contacts_oauth`), cookie payload `${state}.${flag}`, `httpOnly` + `secure` (prod only) + `sameSite:'lax'` + `maxAge:600` (10 min); the cookie is deleted on every outcome via `finish(res)`. Auth via `createClient()` + `supabase.auth.getUser()`. Rate-limited per IP on `/start`. **The precedent never stores the token** (callback comment: "The token is never stored") — encrypted persistence is net-new and owned by backend 03.
- **New files:** `lib/social/connect/oauth-config.ts` (per-platform authorize-URL builders + scope sets + token endpoints, from §4), `app/api/social/connect/[platform]/start/route.ts`, `.../callback/route.ts`, `.../disconnect/route.ts`.
- `/start`: require signed-in user → build the platform authorize URL + scopes + a `social_oauth` state cookie (httpOnly, sameSite lax, 10-min). **For X (PKCE), generate a `code_verifier`, store it in the state cookie (or a sibling httpOnly cookie), and send `code_challenge=S256(verifier)`.** Redirect to the platform.
- `/callback`: verify state cookie → exchange code (with `code_verifier` for X) → **`storeTokens(db, userId, platform, tokens, accountInfo)` (backend 03)** → delete cookie → redirect to the workspace with a `?social=connected|error` flag. The callback **calls** `storeTokens`; it never writes `social_accounts` columns directly.
- `/disconnect`: `revokeToken(db, userId, platform[, platformAccountId])` (backend 03) → set `social_accounts.status='revoked'` → auto-pause that platform's active `social_schedules` (U-D3).
- **Reconnect-on-expiry (U-D4):** the connect block reads `social_accounts.status`; `expired|revoked` floats the account to the top with a "Reconnect" action that re-runs `/start` for that platform.
- **Per-platform reality** (full contracts in §4): X = OAuth2 PKCE + paid tier; Meta = Standard Access covers the operator's own assets (dogfood) but Advanced Access (App Review + Business Verification) is required for arbitrary customers; LinkedIn = member self-serve vs org vetted; **GBP = parked, connect card shows "access pending Google approval."**

### 2.2 U2 — "Just ask AI" schedule + compose (frozen visual preview)

Mirror the email schedule-command two-step, add social compose.

- **Precedent (verified):** `app/api/email/schedule-command/route.ts` (`COMMAND_MODEL = "claude-haiku-4-5"`), `lib/email/schedule-command.ts` (`SCHEDULE_COMMAND_TOOL` named `propose_email_schedule_action`; `validateToolInput(input): ValidationResult`; `buildSystemPrompt(existing): string`), `lib/email/proposal-nonce.ts` (`issueProposalNonce({ uid, pid, proposal, nowMs? }): string | null`, `verifyProposalNonce(token, { uid, pid, proposal, nowMs? }): NonceVerifyResult`; HMAC-SHA256, 15-min TTL, single-use), `lib/email/idempotency.ts` (`claimOnce(db, key, ctx): Promise<boolean>`). Two non-LLM PROPOSE lanes exist (`fromDeliverable`, `fromScope`) that bypass the model and call `deliverableToScheduleRecipe` deterministically — they return the identical proposal shape, so a deterministic "schedule this card" button gets them for free.
- **New files:** `lib/social/schedule-command.ts`, `app/api/social/schedule-command/route.ts`.
- `lib/social/schedule-command.ts`: `SOCIAL_SCHEDULE_COMMAND_TOOL` (`propose_social_schedule_action`) — actions `create | pause | stop | change-cadence | change-platform`; fields `platform, cadence, day_of_week, day_of_month, send_hour_et, scope_kind, scope_value, content_template, hashtags, media_kind`. `buildSocialSystemPrompt(existing)` carries the per-platform caption rules (char + hashtag caps from §5) and the no-invention lint. Forced-tool `claude-haiku-4-5`.
- `app/api/social/schedule-command/route.ts` — **PROPOSE → signed nonce → CONFIRM:**
  - **PROPOSE:** parse NL (Haiku) or the deterministic lanes → pull the **grounded content** (the stat, freshness, no-invention data + image data) from the backend compose core (01) → **generate ~3 per-platform caption variants** in U2's compose-a-post-by-AI step (Haiku over that grounded content; this is the net-new creative step the handoff assigns to the user side — "deterministic math, narrative prose": numbers stay verbatim from 01, the caption prose is the LLM's) → render the card via `renderSocialImage` (02) → return `{ proposal, preview: { image_url, captions: [≤3 per platform], hashtags }, proposal_nonce }`. Full visual preview (U-D1) + multiple caption options (U-D6).
  - **Ownership of the caption variants:** build 01's compose core returns a single grounded content object; the **multi-variant per-platform caption generation lives in U2** (`lib/social/compose-caption.ts`, new), keeping numbers code-sourced and only the prose model-generated. Do NOT expect build 01 to emit ≤3 variants.
  - **CONFIRM:** `verifyProposalNonce` → `claimOnce(db, "nonce:<nid>", ctx)` (single-use) → build a `CadenceSpec { cadence, day_of_week?, day_of_month?, send_hour_et }` → `next_run_at = computeNextRunAt(spec)` → INSERT `social_schedules` (chosen caption + hashtags + `media_kind` + scope) → **freeze the approved artifact** (see §2.5).
- **Determinism gate (carry the lesson):** the nonce single-use test must flip a **decoded byte**, not a base64url char — the flaky-`proposal-nonce` ~6.5%/push-red incident. Reuse `proposal-nonce.ts` unchanged; the test lives with the new route.

### 2.3 U3 — MCP `swfl_social_list` + `swfl_social_schedule`

- **Precedent (verified):** `app/api/mcp/project-tools.ts` — `keyFromHeader(extra): string | null` (X-Project-Key, lowercased by transport), `resolveProjectByKey(db, key): Promise<ProjectKeyRow | null>` (service-role lookup on `projects.mcp_key`), `authorize(db, extra): Promise<{ project } | { error }>` (every handler starts here), `server.registerTool(name, { title, description, inputSchema, annotations: { readOnlyHint, destructiveHint, idempotentHint } }, handler)`, response helpers `text()` / `errText()`, and `recordUseForClient(...)` beacon. **Write target is derived solely from key→`project.id`** (LB-R6b) — args never carry identity.
- **New file:** `app/api/mcp/social-tools.ts`, registered alongside `project-tools.ts` on `/api/mcp`.
- `swfl_social_list` (read-only; `readOnlyHint` per the `swfl_project_list` precedent): SELECT `social_schedules` for the resolved project → numbered `describeSchedule()` one-liners (platform · cadence · next/last run · status).
- `swfl_social_schedule` (write): inputSchema `{ platform, cadence, day_of_week?, day_of_month?, send_hour_et, scope_kind?, scope_value?, content_template, hashtags?, media_kind?, preview? }`. Handler: `authorize` → validate (`send_hour_et` 0–23; cadence enum) → if `preview`, compose (01) + render (02) with a dry publisher and return the rendered preview → else `claimOnce` (idempotency-key over platform+scope+cadence+template hash) → INSERT `social_schedules` (stamp `user_id = project.user_id`) → `recordUseForClient(action:'schedule_social')` → success `text()`. Same frozen-on-confirm.
- ⚠ **Counter-intuitive flag:** in this codebase `readOnlyHint: false` is used on read-only tools too — verify the *behavior* (side effects), not the flag name. Match the `swfl_project_list` (read) vs `swfl_project_add` (write) annotation pattern.

### 2.4 U4 — Workspace "Social posting" lane + connect block

- **Precedent (verified):** `app/project/[id]/workspace/DeliverableLanes.tsx` — Built lane + Emailing lane `<section>`s, `EmailScheduleCard({ s })`. `app/project/[id]/workspace/types.ts` — `EmailScheduleRow` interface. `app/project/[id]/page.tsx` — `email_schedules` SELECT (`.eq("project_id", id).neq("status","stopped").order("created_at",{ascending:false})`) → passed to `<ProjectWorkspace emailSchedules=.../>` → threaded into `<DeliverableLanes emailSchedules=.../>`. `ConnectMcpBlock` is the precedent for the connect block's open/dismissed/connected modes.
- **New:** a `SocialScheduleRow` type (`platform, cadence, day_of_week, day_of_month, send_hour_et, scope_kind, scope_value, status, last_run_at, next_run_at, account_name?, media_kind?`); a `SocialScheduleCard` (platform badge, cadence label, status, last/next run — mirror `EmailScheduleCard`); a third `<section>` "Social posting" (conditional on `socialSchedules.length > 0`); a `ConnectSocialBlock` (per-platform connect cards showing the connected account name, reconnect-on-expiry float-to-top); the `socialSchedules` prop threaded through **all three** layers; the `social_schedules` (+ `social_accounts` for connected state) SELECTs in `page.tsx`.
- ⚠ **Concurrency hazard (verified):** `page.tsx`, `ProjectWorkspace.tsx`, and `BuildActions.tsx` are currently modified (FINAL BOSS Piece 1, held for push). U4 edits the live workspace files — **build U4 after Piece 1 merges, and re-probe these files at build time.** This is the only surface that edits shared workspace files; treat it as the highest coordination risk and stage it last.

### 2.5 The frozen-preview mechanic (cross-cutting; needs one backend seam)

The user approves an artifact rendered with data **as-of-confirm**. "Initial post is frozen, then updated only when posted again if data changed" (operator) means:

1. **On CONFIRM** (U2 + U3), persist the approved artifact as a frozen record: the chosen caption, the rendered `media_url`, `hashtags`, and the `freshness_token` snapshot. **Recommended:** add `frozen_post jsonb` to `social_schedules` (backend 01). *Alternative:* the confirm writes a seed `social_posts` row (status `dry_run`/`queued`) keyed `post:<schedule>:<firstdate>` that the cron's `claimOnce` finds already-claimed on the first fire.
2. **First fire** (cron, backend 04): post the **frozen** artifact verbatim — exactly what the user previewed — not a re-derivation.
3. **Later fires:** re-compose with fresh data; if `freshness_token` advanced → render a new artifact, post it, overwrite `frozen_post`; if unchanged → **skip + re-arm** (D7 — never re-post stale numbers).

**Coordination note (USER-SIDE → backend):** this requires (a) a `frozen_post jsonb` column on `social_schedules` in build 01, and (b) build 04's worker honoring it (post-frozen on first fire; refresh-or-skip after). Both are small. Flag this in the `U2` build file and as a one-line addition to builds 01 + 04 so the seam exists when U2 builds. Until it lands, U2/U3 still write the recipe; the freeze degrades gracefully to "re-compose every fire."

---

## 3. Drift this spec resolves (build files authoritative)

| # | Stale (program-spec body) | Authoritative (build files + code) |
|---|---|---|
| 1 | `post_schedules`, `claim_due_posts` | `social_schedules`, `claim_due_social_schedules` |
| 2 | LinkedIn + **Bluesky** + X | `Platform = 'x'｜'facebook'｜'instagram'｜'linkedin'｜'google_business'` — **no Bluesky** |
| 3 | one MCP tool `swfl_social_post` (actions compose/preview/schedule/list/cancel) | two tools `swfl_social_list` + `swfl_social_schedule` |
| 4 | `computeNextRunAt` at lines 92–106 | actually **116–130** — import by symbol, never line |
| 5 | `corridor` grain supported | `parse-scope` `SCOPE_KINDS = {zip, place, county}` only — **corridor is unbuilt**; do not offer it in command/MCP schemas until `parse-scope` is extended |

Other verified naming facts: the scope parser export is `parseDeliverableScope(kind, value): DeliverableScope` (not `parseScope`; `SCOPE_KINDS` is module-private). `social_accounts` columns are `account_name` (not `display_name`), `expires_at` (not `token_expires_at`). The engagement metrics view is `social_schedule_metrics`. Idempotency-key format mirrors email: `class:<id>:<YYYY-MM-DD>` — the cron post key is `post:<schedule>:<date>`; the confirm single-use key is `nonce:<nid>`.

---

## 4. Per-platform OAuth contracts (Vendor-First — verified 2026-06-20, cited)

Re-verify against live docs before coding each connector (CLAUDE.md Rule 1). Sources are listed; treat scope strings + pricing as time-sensitive.

### X (Twitter)
- **OAuth 2.0 Authorization Code with PKCE — mandatory** (`code_challenge_method=S256`, verifier 43–128 chars). Authorize `https://x.com/i/oauth2/authorize`; token `https://api.x.com/2/oauth2/token`.
- **Scopes to post:** `tweet.write`, `tweet.read`, `users.read`, `offline.access`, `media.write`. **`offline.access` is required** or there is no refresh token and the access token dies in **2 hours**. Refresh tokens may rotate on use — persist the newly returned one.
- **Post:** `POST /2/tweets` `{ text, media:{ media_ids:[…] } }`. **Media:** `POST /2/media/upload` (v2; the v1.1 `upload.twitter.com` endpoint was sunset 2025-06-09 — do not use).
- **⚠ DISCREPANCY to resolve before go-live:** the shipped backend adapter `lib/social/channels/x.ts` (build 03, landed 2026-06-20 per SESSION_LOG) reportedly uses **v1.1** media upload; this spec's live check (docs.x.com media quickstart + the deprecation announcement) says v1.1 was **sunset 2025-06-09** and v2 `/2/media/upload` is the path. Re-verify `channels/x.ts` against docs.x.com before posting — one of the two is wrong. (Media upload is backend 03's surface, not a user-side one — noted here for provenance.)
- **Cost (go-live COGS, not a build blocker):** posting requires a **paid/pay-per-use** tier; new developers default to pay-per-use credits (no free posting path). **$0.015/standard post, $0.200/post containing a link.** The "link in first comment dodges the charge" idea is **unverified folklore** (a reply is itself a priced post) — do NOT state it as fact or rely on it. Re-verify the live pricing page before any billing logic.
- Sources: docs.x.com (OAuth, pricing, create-post, media quickstart), TechCrunch 2026-04-22 (link-post price hike).

### Meta — Facebook Page + Instagram (one combined adapter)
- **Confidential server-side code flow** (client_secret; **not** PKCE). Authorize `https://www.facebook.com/v25.0/dialog/oauth`; token `https://graph.facebook.com/v25.0/oauth/access_token`.
- **Scopes:** `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `instagram_basic`, `instagram_content_publish`, `business_management`. Use the **"Instagram API with Facebook Login"** config so one grant covers both surfaces; the Page is the join key (`GET /{page-id}?fields=instagram_business_account`).
- **No refresh-token grant.** Short-lived user token → **long-lived user token (~60 d)** via `grant_type=fb_exchange_token`; derive a **long-lived Page token (non-expiring)** — that is the durable credential.
- **Post:** Facebook Page `POST /{page-id}/feed` (Page token). **Instagram is two-step:** `POST /{ig-user-id}/media` (create container from a public HTTPS `image_url`) → poll `GET /{container-id}?fields=status_code` until `FINISHED` → `POST /{ig-user-id}/media_publish?creation_id=…`. Container TTL **24 h**. IG limit **100 published/24 h** (carousel = 1).
- **App-review long pole:** **Standard Access** (no review) covers app-owned/claimed assets → **dogfood (operator as tenant #1) needs no review.** Posting for arbitrary customers needs **Advanced Access = App Review + Business Verification** (plan weeks, not days). IG account must be Professional (Business/Creator) linked to a Page; mind Page Publishing Authorization (PPA).
- Sources: developers.facebook.com (Instagram content-publishing, Pages API, long-lived tokens, IG `/media`).

### LinkedIn — member + organization (Company Page)
- **Confidential code flow** (client_secret; PKCE not documented as required). Authorize `https://www.linkedin.com/oauth/v2/authorization` (code TTL 30 min); token `https://www.linkedin.com/oauth/v2/accessToken`.
- **Scopes:** `w_member_social` (member; **self-serve** via "Share on LinkedIn") · `w_organization_social` + `r_organization_social` (org/Company Page; the **"Community Management API" — a vetted product**: application + Development/Standard tiers + a screencast demo + Technical Sign-Off → real latency) · `openid profile email` (identity via "Sign In with LinkedIn using OpenID Connect"; person id from the userinfo `sub`).
- **Post:** `POST /rest/posts` with `author = urn:li:person:{id}` or `urn:li:organization:{id}`; headers `LinkedIn-Version: {YYYYMM}` + `X-Restli-Protocol-Version: 2.0.0`. The created URN is in the `x-restli-id` response header (201). Legacy `/v2/ugcPosts` is superseded — use `/rest/posts`.
- **Tokens:** access **60 d**; refresh **365 d but only for approved Marketing Developer Platform partners** — otherwise re-auth at 60 d. Changing the requested scope set invalidates existing tokens.
- **Image:** 3-step `POST /rest/images?action=initializeUpload` → upload binary to the returned `uploadUrl` → reference `urn:li:image:{id}` in `content.media.id` (async PROCESSING→AVAILABLE).
- Sources: learn.microsoft.com/linkedin (Posts API, 3-legged OAuth, programmatic refresh tokens, Community Management overview, Share on LinkedIn, Images API).

### Google Business Profile — PARKED (Operation Dumbo Drop, U-D5)
- Standard Google OAuth: authorize `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`; `access_type=offline` + `prompt=consent` → refresh token; access token ~1 h. **Scope:** `https://www.googleapis.com/auth/business.manage`.
- **Post:** `POST https://mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/localPosts` (legacy **v4** — `localPosts` was NOT deprecated and has **no v1 successor**; only `localPosts.reportInsights` was sunset). Media inline via `LocalPost.media[].sourceUrl` (public image URL); `topicType ∈ STANDARD|EVENT|OFFER|ALERT`.
- **Why parked:** access is **allowlist-gated** — a fresh GCP project has **0 QPM until Google manually approves** an application (eligibility: a verified profile active 60+ days, owner/manager email, business website; review takes days-to-weeks → 300 QPM on approval). Build the connect card + the v4 path but gate it behind an "access approved" state; surface a 0-QPM/403 as "GBP access pending Google approval," never a generic failure. Do not block launch on it.
- Sources: developers.google.com Business Profile (localPosts.create, deprecation schedule, prereqs, limits), support.google.com/business (API access application), Google OAuth 2.0.

---

## 5. Compose defaults (from competitor + best-practice research)

Bake these into the social system prompt + cadence defaults; users override.

- **Caption char ceilings (compose to):** X ≤ 280 · LinkedIn ≤ 3000 · Instagram ≤ 2200 · Facebook (generous) · GBP (short, CTA-oriented).
- **Hashtag caps (do not exceed):** Instagram 3–5 · LinkedIn 3–5 · X 1–2 · Facebook 1–2 · GBP n/a. Over-hashtagging suppresses reach.
- **Cadence defaults:** Instagram 3–5/wk · Facebook 3–5/wk · LinkedIn 3–5/wk (≤1/day) · X 1–3/day · GBP 1–2/wk.
- **Image ratios (renderer, backend 02):** square 1080×1080 · portrait 1080×1350 · story 1080×1920 · Facebook landscape 1200×630 · X 1600×900. When unsure, 1080×1080 / 1080×1350 are valid across IG/FB/X/LinkedIn. GBP image specs unconfirmed — verify against Google before a GBP default.
- **Compose UX:** return ~3 per-platform caption variants (U-D6), tailor one source → per-network variants, allow inline edit, never auto-commit.

---

## 6. Seam map — where the user surfaces meet the backend

| User surface | Calls / writes | Backend owner |
|---|---|---|
| U1 connect callback | `storeTokens(db, userId, platform, tokens, accountInfo)` → `social_accounts` | `lib/social/oauth-tokens.ts` (build 03) |
| U1 disconnect | `revokeToken(...)` + pause schedules | build 03 + `social_schedules` (01) |
| U2/U3 PROPOSE preview | compose core (01) + `renderSocialImage` (02), dry | builds 01 + 02 |
| U2/U3 CONFIRM | `verifyProposalNonce` + `claimOnce("nonce:<nid>")` → INSERT `social_schedules` + freeze `frozen_post` | nonce/idempotency reused as-is; `social_schedules` + `frozen_post` (01) |
| U3 MCP | `authorize` / `keyFromHeader` (X-Project-Key) + `recordUseForClient` | `app/api/mcp/project-tools.ts` exports |
| U4 lane | SELECT `social_schedules` + `social_accounts` | build 01 |
| (cron, not a user call) | first fire posts `frozen_post`; later fires freshness-gate | builds 04 (+ 01) |

Reused unchanged: `computeNextRunAt(spec: CadenceSpec, fromUtc?): Date | null` (`lib/email/schedule-cadence.ts`, symbol not line); `CadenceSpec { cadence, day_of_week?, day_of_month?, send_hour_et }`; `formatScheduleSendTime(iso)` for the "first send" line; `parseDeliverableScope(kind, value)` (`SCOPE_KINDS = {zip,place,county}`); `claimOnce(db, key, ctx)`; `issueProposalNonce`/`verifyProposalNonce`.

---

## 7. Sequencing, staging, and model assignment

Mirror the OUR-SIDE concurrency convention. **Plan now; build after the backend merges.**

| File | Builds after | Model | Why |
|---|---|---|---|
| **U1** connect OAuth | backend 01 (`social_accounts`) + 03 (`oauth-tokens.ts`) | **Sonnet** | clone the Google OAuth flow + follow vendor docs |
| **U2** ask-AI + preview | backend 01 + 02 (renderer) + 03 | **Opus** | no-invention compose + multi-caption + preview judgment |
| **U3** MCP tools | backend 01 (+ 02 for preview) | **Sonnet** | clone the `project-tools` MCP pattern |
| **U4** workspace lane | backend 01 + **FINAL BOSS Piece 1 merged** | **Opus** | edits shared workspace files; concurrency-sensitive |

Stages: U1 ‖ U3 can run together (no shared files). U2 after the renderer (02) lands. U4 last (after Piece 1). Everything DRY behind `SOCIAL_PUBLISH_ENABLED`; the user surfaces never call `postToChannel` — only the cron does, and only when the flag is live.

---

## 8. Testing posture (clone the email posture)

- **Nonce single-use test — deterministic:** flip a *decoded* byte, not a base64url char (the flaky-`proposal-nonce` lesson).
- Caption **no-invention lint** test (every number traces to the dossier; placeholder literals fail) + per-platform caption-shaping tests (char + hashtag caps).
- **OAuth state-cookie CSRF** test per platform (state mismatch → reject); X **PKCE** verifier/challenge round-trip.
- **Frozen-preview** test: confirm freezes the approved artifact; first fire posts it verbatim; an unchanged `freshness_token` skips (no re-post).
- **Disconnect** test: revoke + auto-pause that platform's schedules; reconnect resumes.
- MCP: write target derived solely from key→project (args carry no identity); `swfl_social_list` read-only; idempotent re-submit doesn't double-schedule.
- Gates before push: `real-tsc` 0, eslint clean, `next build` ✓, relevant `bun test` green. New deps (none expected on the user side beyond what the renderer pulls in) → lockfile gate.

---

## 9. Out of scope (v1)

- Engagement read-back UI (backend 06 owns the data; the ops board lives in `swfldatagulf-ops`, not here).
- A login-free shareable approve/reject link for external approvers (Sprout/Later pattern) — fast-follow; v1 the operator/owner confirms in-app.
- A content-calendar view + queue/slot scheduling — fast-follow; v1 is cadence recipes + the lane.
- Corridor grain (blocked on `parse-scope` extension — drift #5).
- GBP live posting (parked until Google allowlist access — U-D5).
- Video/Reels compose (image cards first; `media_kind` carries the enum for later).

---

## 10. Open questions deferred to the implementation plan

- `frozen_post` as a `social_schedules` column vs a seed `social_posts` row (§2.5) — pick in the plan once build 01's schema is final.
- The exact `accountInfo`/`tokens` TypeScript shapes for `storeTokens` (param names are fixed in build 03; types finalize when 03 merges) — confirm at integration.
- Whether U3's `swfl_social_schedule` preview returns a hosted image URL or an inline data ref over MCP (depends on the renderer's output surface in build 02).
