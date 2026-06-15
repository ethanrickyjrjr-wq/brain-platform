# Plan A — Front Door

**Status:** audited & planned (operator confirms A is correct). **Model:** SONNET overall; **OPUS on
Task 2** (refactor — blast-radius) **and Task 8.5** (meter spine + migration). These files are a
faithful decomposition of the audited master plan — execution briefs, not a re-design.

## Architecture
Lift draft state into a **root-mounted `BriefcaseProvider`**, add a **global Briefcase button** + a
**state-branching popup**, and a **client `/api/me`** auth signal (keeps the layout static). Make the
briefcase visible everywhere (`/`, `/charts`, `/r/*`), turn a logged-out filer into a signed-up
builder, and lay the **funnel + meter substrate** so the paywall ladder's enforcement is a later
config flip, not a refactor.

## What A ships of the ladder
The funnel + the auth wall + the meter substrate + CTAs that point at rung 2. Enforcement (trial
expiry block, watermark render, checkout vendor) is a deliberate **Tier-2 follow-on** — but because A
folds in uid-attribution (Task 8.5), Tier-2 becomes a config flip. See parent `../README.md` for the
ladder table.

## Corrections baked into these tasks (verified against live code)
1. **Refactor is grep-driven, not list-driven** (Task 2). Real draft consumers:
   `components/highlighter/Briefcase.tsx`, `components/highlighter/HighlightPopup.tsx` (fileItem ~248,
   ~310), `components/highlighter/AskAiDock.tsx:234` (`ctx?.fileItem(...)` — the **missed** consumer).
   `AskAi.tsx` is a mount point, not a consumer. **`use-highlight.ts` does NOT touch draft state —
   drop it from the move set.**
2. **Line numbers** — lazy-init is `lib/highlighter/context.tsx:149-151` (the 3-line
   `useState(() => loadDraftFrom(browserStorage()))`), not 149-168. `DRAFT_KEY = "swfl_project_draft_v1"`,
   `DRAFT_CAP = 50`. Provider also holds `chipFact/onActivate/thread/archiveExchange/clearThread` —
   **keep those**; move only `draftItems/fileItem/removeItem/draftNearCap`.
3. **Template ids correct ✅** — `market-overview, bov-lite, client-email, one-pager`
   (`lib/deliverable/templates.ts:83`, `assemble.ts:21-26`).
4. **Metering claim stale** — welcome-chat weekly cap is already wired (`lib/welcome/chat-usage.ts`,
   env `WELCOME_CHAT_FREE_WEEKLY_CAP`). Task 6 step 3 = **flip an env var**, not write code.
5. **Seed blocker milder** — `deliverables.user_id` is `uuid NOT NULL`, **no FK** to `auth.users`,
   public SELECT, ALL to service_role. A reserved sentinel UUID via service_role is safe; add an
   `is_example`/sentinel convention for analytics hygiene (Task 4).
6. **No-invention guarantee holds ✅** — `lintDeliverableNarrative` is in `lib/deliverable/build.ts`
   (the build path, not the route handler).

## Future-proofing (operator: "when we bring in new data / are live")
- **Examples are LIVE-generated, not frozen fixtures** (Task 4) — a scheduled job rebuilds the 4
  example deliverables through the real `lib/deliverable/build.ts` from live brain reads, for a
  data-driven scenario set. They stay current, carry a live freshness token, and dogfood the engine.
  (The drafted hardcoded seed + `demo-answer.ts`'s pinned `SWFL-7421-v5-20260522` would show a stale
  number as current the moment data refreshes — violating our own freshness rule.)
- **uid-attribution** (Task 8.5) future-proofs the funnel: trial gate, send cap, and MCP-connected
  detection all key off it.

## Tasks
| File | Task | Model |
|---|---|---|
| `task-1-api-me-and-usesession.md` | `/api/me` + `useSession` (auth signal, static layout) | SONNET |
| `task-2-extract-briefcaseprovider.md` | extract root `BriefcaseProvider` (grep-driven repoint) | **OPUS** |
| `task-3-mount-globally.md` | mount globally; remove per-page `<Briefcase/>` | SONNET |
| `task-4-example-deliverables-live.md` | live-generated examples + sentinel/`is_example` | SONNET |
| `task-5-popup-state-machine.md` | state-branching popup; ladder-aligned CTAs | SONNET |
| `task-6-briefcase-chat-dry-stream.md` | DRY the chat stream; flip welcome cap env | SONNET |
| `task-7-adaptive-prompts-cta.md` | revisit-aware prompts + escalating CTA | SONNET |
| `task-8-open-project-and-draft-import.md` | fix dead "Open project" + draft→project import | SONNET |
| `task-8.5-meter-uid-attribution.md` | `usage_events.user_id` = `auth.uid` on web build/deliver | **OPUS** |
| `task-9-self-review-and-ship.md` | self-review, ledgers, ship; open live-verify check | SONNET |

## Out of scope (Tier-2 follow-on, named)
Watermark render on `/p/[id]` + PDF; trial-expiry enforcement block; checkout vendor pick; the
MCP-discount price. A makes them **flips, not refactors.**
