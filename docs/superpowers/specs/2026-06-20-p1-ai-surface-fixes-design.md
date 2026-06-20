# P1 AI-Surface Fixes — Design + Build Plan (2026-06-20)

**Parent:** `docs/superpowers/specs/2026-06-20-ai-surface-audit-and-handoff.md` (the audit). This spec
covers the **P1 batch** of that punch list. Ledger: the related #1 ask is tracked as
`cross_project_ai_knowledge` (P2 — NOT in this batch).

**Burden-of-proof note:** a verification pass (3 Explore agents, one per item) re-checked every `file:line`
claim in the handoff doc against actual code. **The handoff doc was wrong in three material ways** — this
spec records the *verified* reality, not the doc's claims.

---

## What the probe corrected

1. **§1 `recentActivity`** — doc claimed "pure threading, **no type changes**." FALSE: `ProjectWorkspace`
   Props needs a new field + threading. Also surfaced an **identical dead-path for `branding`** at the same
   call site (independently confirmed: `digest.ts` accepts both `@126`/`@131`, builder passes both `@305`/`@306`,
   `page-context.ts` feeds both to the AI `@106-108`/`@207-208`, but the `buildProjectDigest({...})` call in
   `ProjectWorkspace.tsx:389-410` passes neither and the useMemo deps omit both).
2. **§2 email-as-template** — doc framed it as net-new. FALSE: largely already built — `assemble.ts` accepts
   scope, the **web build route already threads it**, the **MCP path is complete**, the type union already
   includes `email`, and the no-ZIP guard already exists. Doc's "clear error message" + "ZIP/**place** scope"
   advice is wrong: email is **ZIP-only** (place/county are rejected by `resolveReportZip`).
3. **§3 schedule confirm card** — bigger than stated: `computeNextRunAt` runs only in the *write* path (not
   propose), the card renders only the bare `summary`, `needsClarification` exists but does **not** handle
   bare-hour, and **no bare-hour logic exists anywhere**.

## Decisions (operator, 2026-06-20)

- **§2 email:** UI menu **AND** fix the conversational action-route path (max scope).
- **§3 schedule card:** full — first-send echo + contact count **AND** bare-hour disambiguation (max scope).
- **§3 bare-hour mechanism:** model-driven `clarify` action (not raw-text regex) — the model already owns the
  am/pm→0-23 conversion, so disambiguation stays in one layer.

---

## §1 — `recentActivity` + `branding` dead-paths (bugfix)

**Goal:** the in-project AI actually receives recent-activity lines and the live agent/brokerage branding it
was already designed to consume.

**Changes**
- `app/project/[id]/page.tsx`: `import { readRecentActivity } from "@/lib/project/activity"`; after the
  existing significance/event loads, `const recentActivityLines = await readRecentActivity(supabase, id)`;
  pass `recentActivity={recentActivityLines}` to `<ProjectWorkspace>`.
- `app/project/[id]/ProjectWorkspace.tsx`: add `recentActivity?: string[]` to Props; destructure with
  `recentActivity = []`; add `recentActivity` **and** `branding` to the `buildProjectDigest({...})` input
  object and to the useMemo deps array. Adapt the `branding` prop shape to the digest's
  `{ agentName?, brokerage?, license? }`.

**Tests / verification**
- `lib/project/digest.test.ts`: add contract assertions that `buildProjectDigest` passes through provided
  `recentActivity` and `branding`. (Honest note: the pure builder *already* passes these through — the bug is
  the omitting caller — so these tests **guard the contract**; the *wiring* fix is proven by `tsc` requiring
  the new prop + `next build`.)
- Before claiming `branding` as a net-new AI improvement, confirm it isn't already reaching the AI by another
  path (grep the chat/context assembly).

## §2 — email (UI menu + conversational)

**Goal:** users can build an `email` deliverable from the workspace menu and by asking the AI; the
conversational path no longer silently drops scope.

**Changes**
- `app/project/[id]/workspace/BuildActions.tsx`: add `{ id: "email", label: "Email (send-ready)" }` to
  `DELIVERABLE_TEMPLATE_OPTIONS`.
- `app/api/projects/[id]/action/route.ts`:
  - classify enum (`~:92`): add `"email"`.
  - CONFIRM `build_deliverable` handler (`~:200-214`): extract `scope_kind/scope_value` from the proposal
    (already captured at PROPOSE, `~:79-87`/`~:266-267`) and pass into `assembleDeliverable` via
    `parseDeliverableScope`. **This fixes a latent bug** — the handler currently drops scope, which is why the
    prior session excluded `email`; we fix the root cause instead.
  - **ZIP-only guard:** if `template === "email"` and the resolved scope is not a ZIP, return a clarification
    ("An email needs a single ZIP; this project is {scope}. Build it for a specific ZIP?") rather than
    building an empty email. The UI build-menu path (web `build/route.ts`, already threads scope) keeps its
    existing safe `GlobalDigestFallback`.

**Already correct — do NOT touch:** `assemble.ts` (accepts scope), `email-deliverable.ts` (guard exists),
`build/route.ts` (threads scope), MCP `project-tools.ts` (enum + scope complete), `templates.ts` (union has `email`).

**Tests**
- Extend/add `app/api/projects/[id]/action/route.test.ts`: CONFIRM of an `email` build persists
  `scope_kind/scope_value`; a non-ZIP scope returns the clarification, not a build.
- (cheap) assert `email` is present in `DELIVERABLE_TEMPLATE_OPTIONS`.

## §3 — schedule confirm card (full, incl. bare-hour)

**Goal:** the confirm card states the concrete first send + live audience size, and a meridian-less hour is
disambiguated instead of guessed.

**Changes**
- `lib/email/schedule-command.ts`: add a `clarify` action (tool schema + `SCHEDULE_ACTIONS`) and a prompt
  rule: *"NEVER guess am/pm for a bare hour — emit `clarify` with `candidates:[{hour:6,label:'6am'},{hour:18,label:'6pm'}]`."*
- `app/api/email/schedule-command/route.ts`:
  - PROPOSE branch (NL + fromScope + fromDeliverable): compute `next_run_at` via `computeNextRunAt(command)`
    and a live `contact_count` (from the `email_audiences` source the send-status route already uses); return
    both. Handle the new `clarify` action → `{ needsClarification, message, candidates }`.
  - Guard the `send_hour_et == null` / `=== 0` distinction (midnight is valid).
- `components/briefcase/ChatScheduleCard.tsx`: confirm step renders
  *"First email: Mon Jun 23, 9:00am ET — then weekly. To N contacts."* (carry `next_run_at` + `contact_count`
  through propose→confirm state); render the clarify branch as two buttons (6am / 6pm) that re-submit the
  chosen hour.

**Tests**
- `lib/email/schedule-command` tests: a bare-hour command yields `clarify` with both candidates.
- route test: PROPOSE response includes `next_run_at` + `contact_count`; clarify command returns the
  needsClarification shape.

---

## Cross-cutting

- **Process:** TDD per item (write/extend the test, watch it fail where a true red is possible, implement, green).
- **Gate before handing back:** real-`tsc` 0, eslint clean, `next build` ✓, full `bun test` green.
- **Push policy:** all three touch live `/project` + conversational-AI surfaces → **diff-review, operator
  pushes** (RULE 1 + no-autonomous-push). `SESSION_LOG.md` entry + ledger reconcile in the same push.

## Non-goals (explicitly out)

- Cross-project AI knowledge (`cross_project_ai_knowledge`, P2 — separate brainstorm).
- Email-blast stale-data verification, NewsBar UI, uploaded-file-pages-in-PDF (P2/P3).
- Email-scheduler go-live (operator-gated, P3).
- Any refactor of the already-correct email/assemble/MCP/build-route surfaces.
