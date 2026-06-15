# Plan A — Front Door (AUDITED · DECISION-LOCKED 2026-06-15)

**Status:** approved (operator confirmed Option 4 + Option 1). **Models:** **OPUS** on A-2, A-3,
A-8.5; **SONNET** elsewhere. These are execution briefs with the audit corrections + locked
decisions baked in. **Cite symbols, not line numbers — they drift; grep to locate.**

## What A does

Make the Briefcase visible on every page as **one unified "AI + Briefcase" pill**, turn a
logged-out filer into a signed-up builder, and lay the **funnel + metering substrate** so the
paywall ladder's enforcement is a later toggle, not a refactor.

## Locked decisions (canonical — do not re-litigate)

1. **Unified "AI + Briefcase" pill (Option 4).** ONE bottom-right floating element on **every**
   page, clearly labeled AI. Click opens the project view: AI chat + **context-aware** prompts +
   a "create this now" suggestion + filed items + build path. One element ⇒ no stack/move
   coordination.
   - **Two modes.** *Off `/r/*`* (`/`, `/charts`, everywhere): standalone — opens `BriefcaseChat`
     (A-6), files into the global draft (`BriefcaseProvider`), **no `HighlighterContext`**. *On
     `/r/*`*: same pill, **bridges to `HighlighterContext`** for `thread(reportId)`,
     `archiveExchange`, `fileItem` (file-this-chart) — so the pill and the inline highlight-to-ask
     popup stay **one shared thread**.
   - **Retire** `AskAiFab`/`AskAiDock` as a separate bottom-right element; absorb its three jobs
     into the unified pill's on-`/r/*` mode. **Never two bottom-right pills** (they collide).
   - **Keep** the inline highlight-to-ask popup (`HighlightPopup`) `/r/*`-only — that is the
     separate "highlighter AI," tied to text selection. Only the corner-pill role merges.
2. **Ladder = watermark, don't block (Option 1).** Builds are **free forever**. Trial expiry is a
   **watermark toggle keyed to first-build timestamp**, NOT a build gate. The only paywall is
   **branded/clean SEND** (email + unwatermarked PDF). MCP-connected = discounted send tier. Paying
   users never get a watermark (watermark = free-tier render only).
3. **Personalization = NOT YET.** `usage_events` is anon-only today, the build path is stateless,
   and the only per-user store is `user_brand_profiles` (static, explicitly set — not learned). So
   **copy says "context-aware," never "learns how you work."** A-7 prompts key off **page context**
   (report/zip/chart) + **anon revisit count**, NOT user history.
4. **Cost guardrail.** One build = one Sonnet call (≤2048 tok, ≤1 retry, no external paid calls,
   ~10-25KB JSONB) ≈ **$0.03 typical / $0.08 worst-case** — free-forever is affordable. **Keep
   `DELIVERABLE_MODEL` pinned to Sonnet** (Opus ~5×'s cost); no switch without operator sign-off.

## Paywall ladder (final)

| Rung | Surface | Cost to us | Gate |
| --- | --- | --- | --- |
| **0 — Try (anon)** | browse `/r/*`, `/charts`, the pill, **live example deliverables** | ~0 (public) | none |
| **0 — MCP (free forever)** | `claude mcp add` → cited data in their own Claude | storage + tiny LLM (their plan) | none (bearer off) |
| **1 — Build here (free forever)** | `/project/*` → `/p/[id]` | ~$0.03 Sonnet | **auth wall** (sign up) |
| **1 — First 30 days** | builds render **clean** | same | first-build timestamp |
| **1 — After 30 days** | builds still free, **watermarked** (brand + `/p/` URL travels = free ads) | same | watermark toggle (Tier-2 render) |
| **2 — Branded SEND (PAID)** | email / clean unwatermarked PDF | send + brand | **money wall**, MCP discount |

Don't fight screenshots — a watermarked build is dead/un-refreshable/cited, so leaks become
marketing. Meter **builds and sends**, never views.

## Corrections baked in (verified against live code)

1. **Refactor is grep-driven, not list-driven** (A-2). Verified draft consumers are exactly three:
   `components/highlighter/Briefcase.tsx`, `HighlightPopup.tsx`, `AskAiDock.tsx`. `AskAi.tsx` is a
   mount point; `use-highlight.ts` does **not** touch draft state — drop it from the move set.
2. **Provider split** — move only `draftItems/fileItem/removeItem/draftNearCap`; **keep**
   `chipFact/onActivate/thread/archiveExchange/clearThread` in the highlighter context. Constants
   `DRAFT_KEY="swfl_project_draft_v1"`, `DRAFT_CAP=50`.
3. **Template ids correct** — `market-overview, bov-lite, client-email, one-pager`
   (`lib/deliverable/templates.ts`, `assemble.ts`).
4. **Welcome cap already wired** — `lib/welcome/chat-usage.ts` + `welcomeChatWeeklyCount()`, gated by
   `WELCOME_CHAT_FREE_WEEKLY_CAP`. A-6 step 3 = flip an env var, not write code.
5. **Seed safe** — `deliverables.user_id` is `uuid NOT NULL` with **no FK** to `auth.users`, public
   SELECT, ALL to service_role ⇒ reserved sentinel UUID via service_role is safe (A-4).
6. **No-invention guarantee holds** — `lintDeliverableNarrative` runs in `lib/deliverable/build.ts`
   (the build path).

## Tasks

| File | Task | Model |
|---|---|---|
| `task-1-api-me-and-usesession.md` | `/api/me` + `useSession` (auth signal, static layout) | SONNET |
| `task-2-extract-briefcaseprovider.md` | extract root `BriefcaseProvider` + safe context bridge | **OPUS** |
| `task-3-mount-globally.md` | unified AI+Briefcase pill; retire the dock; mode-aware | **OPUS** |
| `task-4-example-deliverables-live.md` | live-generated examples + sentinel/`is_example` | SONNET |
| `task-5-popup-state-machine.md` | state-branching panel; ladder-aligned, "context-aware" copy | SONNET |
| `task-6-briefcase-chat-dry-stream.md` | DRY the chat stream; flip the welcome cap env | SONNET |
| `task-7-adaptive-prompts-cta.md` | net-new page-context prompts + escalating CTA | SONNET |
| `task-8-open-project-and-draft-import.md` | fix dead "Open project" + draft→project import | SONNET |
| `task-8.5-meter-uid-attribution.md` | `usage_events.user_id` = `auth.uid` on web build/deliver | **OPUS** |
| `task-9-self-review-and-ship.md` | self-review, ledgers, ship; live-verify checks | SONNET |

## Tier-2 follow-ons (named, OUT of A — A makes them toggles, not refactors)

- **Pill chat ⇆ report thread bridge (`use-converse`) — PHASE 2 (deferred, operator decision
  2026-06-15).** The locked decision 1 line "_On `/r/*`: bridges to `HighlighterContext` … one
  shared thread_" is **not** how A-3 shipped. A-3 ships the pill **unification + FAB/tray
  retirement** with the **existing report dock (`AskAiDock`) preserved untouched** on `/r/*` (its
  thread + file-this-chart unchanged). Merging the dock chat into the A-5 panel via `use-converse`
  (so the pill panel and the inline popup share one thread) is a **separate future PR with its own
  tests** — kept out of the A-3 commit to avoid touching the battle-tested `/r/*` Q&A.

- **Watermark render** on `/p/[id]` + PDF (net-new render, NOT a config flip). **Reserve the
  watermark slot in the `/p/[id]` + PDF templates during A** so Tier-2 is a toggle. Key it off the
  first-build timestamp derived from `usage_events.user_id` (A-8.5).
- **Send paywall + checkout vendor** (the money wall) + the MCP-discount price.
- **Memory / "learns how you work" layer.** Store = per-user JSON row keyed to `auth.uid`
  (deliverables-table pattern: uuid `user_id` + JSONB), **deterministic append** of filed
  items/builds/dwell — **no refinery**. Optional distill = reuse `build.ts`'s forced-tool JSON
  pattern as its own cheap/deterministic Sonnet summarizer (~$0.03). **TENANCY GUARDRAIL:**
  per-user isolated memory is fine; the moment memory reads **across brains per-client**, that is
  the tenancy seam **deferred 2026-06-03** (un-parks only with the asset-management brain) — **flag
  the operator first; never silently reopen tenancy.** Copy stays "context-aware" until this ships.

## Verification (integrated A flow + new gates)

1. Exactly **one** AI+Briefcase pill on `/`, `/charts`, `/r/<any>` (no double on `/r/*`, no zero
   off it), logged-out.
2. **On `/r/*`:** pill thread persists via `HighlighterContext` AND file-this-chart still works (no
   change from the retired dock).
3. **Off `/r/*` (e.g. `/charts`):** pill renders standalone, opens `BriefcaseChat`, files to the
   global draft, throws **no** error from a missing `HighlighterContext`.
4. Logged-out popup: pitch + 4 example cards; each `/p/example-*` opens, cited, with a **current**
   freshness token matching live `/r/*`; both exits work (`LoginModal`; `MCPInstall` shows
   `claude mcp add ...`).
5. File logged-out → persists across nav → "Sign in to build" → OTP login → draft imported to a
   `projects` row → "Open project" → Build → `/p/<id>`.
6. Revisit count (anon localStorage) changes prompt set + CTA intensity; prompts reflect page
   context.
7. **Meter (prod row):** logged-in web build/send writes `usage_events.user_id = auth.uid`; **MCP
   build writes `client_id = mcp:<owner_uid>` with `MCP_BEARER_TOKEN` OFF**; logged-out stays
   `sdg_cid`; `is_example` rows write **no** usage event.
8. **Run the FULL `bun test` suite** (subsets hit the `mock.module` SYNTHESIS_MODEL footgun); the
   A-8.5 migration is a **prod-evidence** gate (verify the live row), not dev attestation.
