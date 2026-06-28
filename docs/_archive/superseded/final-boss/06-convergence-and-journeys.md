# 06 — Convergence Plan: How the Live Work Environment Comes Together

> **This is a map, not a status board.** Live status lives in `SESSION_LOG.md`, the `checks` ledger, and
> `_AUDIT_AND_ROADMAP/build-queue.md` per CLAUDE.md RULE 2 — never in this file.
>
> **What this is:** the convergence layer the four piece docs don't have — the end-to-end view through the broker's
> eyes. It traces four real user journeys through what's already built + the four pieces, names the exact seam each
> journey rides, and surfaces the gaps that would make a journey feel broken.

## Audit verdict (grounded in code, not docs)

- **Email/deliverable engine is built and in use:** `assembleDeliverable` (supports email + `scope_kind/value`),
  `/p/[id]` live preview, `SendWeeklyHandle`, `/p/[id]/print` PDF, `email_schedules`, the build→schedule recipe
  bridge, and the Resend reply-sensor (`buyer_intent_events`). Tasks 2–7 all landed.
- **Piece 1 shell is code-verified:** root-layout AI mount survives nav; `ProjectDetail.tsx` is the 743-line monolith
  to decompose; item model has all 9 kinds; `ChartBlockView`/`StatCard` support compact.
- **The work is a rewire onto the project surface, not a rebuild.**

For the spine, context bus, and REAL/SELECTIVE/REACH convergence tiers — see `00-MASTER-PLAN.md`. This doc does not
duplicate that material; it maps journeys and sequences onto it.

---

## The four journeys (designed backward from the broker)

Each journey: **the moment → seams it rides → what's built today → gap to close.**

### J1 — Create from anywhere → lands already-open and already-branded

- **Moment:** broker saves a chart / files an answer outside Projects → one button → arrives inside a named, branded
  project, nothing to set up.
- **Seams:** `deriveProjectName(items)` (P1) · `/api/projects/import` + `/api/claim` · branding copy from
  `user_brand_profiles`.
- **Built:** import/claim create the project; direct `POST /api/projects` copies branding.
- **Gap (G2):** import/claim don't copy branding → projects made from outside arrive unbranded. Must copy brand on all
  creation paths or the "already lined up" promise breaks on the most common path.

### J2 — Open a project and it's already prepared (the AI greets you)

- **Moment:** click a project in the rail → the persistent AI is already holding this project's context and offers 3
  situational prompts + 1 action ("pick up where we left off?", "the new data shows X — add it?").
- **Seams:** persistent `app/project/layout.tsx` (rail + AI, no unmount) (P1) · `setAiContext/{kind:"project",projectId}`
  PillPage (P1 in-session context bus) · project digest + dynamic prompt engine (P2) · `project_feed` (P3, later).
- **Built:** AI pill is mounted in the root layout and already derives `projectId` from the path — persistence is free.
- **Gap (G1 — the J2/J4 blocker):** `/api/welcome/chat` is **public and unauthenticated** — it receives no `user_id`
  and no `project_id`. The pill knows the `projectId`; the request never sends it. **Project *actions*** ("Ready to
  send?", seeding a build) cannot ride this anonymous, text-only surface. **Project *answers*** (grounding) do NOT need
  auth — P2 §D pushes `projectContext` client-side via `getExtraBody`, which works without a server auth bridge. The
  real gap is narrower than it first appears: **project actions have no authenticated surface yet.** An authenticated
  path (port `/api/converse`, or a new authed project-action route) is the locked open decision — see `02-…` §Grounding
  vs. actions. Until it exists, J4's "Ready to send?" cannot fire.

### J3 — Build / edit a deliverable, see it live, open it big

- **Moment:** build a deliverable → it appears as a live thumbnail in the Built lane → click → opens big → edit a
  section/color/add-remove an item → rebuild → reflects current data, not a frozen snapshot.
- **Seams:** `DeliverableLanes`/`Thumbnail`/`Modal` + `components/ui/Modal.tsx` (P1) · `assembleDeliverable` guided
  rebuild + soft-delete trash (P4).
- **Built:** deliverables build + freeze; `/p/[id]` renders them; `/p/[id]/print` is the PDF.
- **Gap:** thumbnails/modal/lanes are net-new (P1); live refresh, guided edit, and trash are P4. P4 must keep the
  no-invention guarantee (`spec-validator` + 3 lints) on every rebuild, and the `deleted_at`/`supersedes_id` migration
  must sequence after the G3 scope migration (both touch `public.deliverables`).

### J4 — Email through Projects: see it before you send (the flagship; send is the paywall)

- **Moment:** outside, on a chart/answer, the AI suggests "email this to your list?" → one button → lands in the
  project with the email deliverable seeded and previewed → broker tweaks (section/color/swap chart), sees it update →
  prompt "Ready to send?" → send.
- **Seams:** seed-on-load (`/project/[id]?seed=`, P1 §I) · build route + `swfl_project_build` threading
  `scope_kind/value` + `"email"` template · `/p/[id]` preview + `SendWeeklyHandle` (built) · "Ready to send?" prompt
  (P2, blocked on G1 authenticated surface) · Emailing lane = schedule-driven (`email_schedules`, no `deliverable_id`).
- **Built:** the receiving end — `/p/[id]` email preview, `SendWeeklyHandle`, the recipe bridge, the send ledger +
  reply sensor. This is why it's a rewire.
- **Gaps (confirmed in code):**
  - **(G3) ✅ RESOLVED 2026-06-17** — `deliverables.scope_kind/scope_value` were confirmed present in prod (live
    schema probe). The "unapplied" status was stale; `assembleDeliverable` has always written these columns, so a
    missing column would have broken every live build. No migration needed.
  - **(G4) ✅ DONE 2026-06-17** — both the web build route and MCP `swfl_project_build` now thread scope via the shared
    `lib/deliverable/parse-scope.ts`; the MCP `TEMPLATE_ENUM` now includes `"email"` (the web route already accepted it
    through `isTemplateId`).
  - **(G5)** Seed-on-load missing — `page.tsx` has no `?seed=` handoff; the outside→project handoff is dead plumbing
    without it.
  - **(G1)** "Ready to send?" is a project *action* — blocked on the authenticated chat surface (see J2 above).

---

## Gap table

> **Status lives in `SESSION_LOG.md` + the `checks` ledger, not here (RULE 2).** As of **2026-06-17** the Wave-0 engine gaps are closed: **G2 ✅ built**, **G3 ✅ resolved** (columns verified live in prod), **G4 ✅ built**. The `ui_state` column (G6's storage half) is also applied. The rows below keep the *design* for provenance; the ✅ flags are factual code/prod state, not a status board.

| # | Gap | Where | Why it breaks a journey | State |
|---|---|---|---|---|
| G1 | Project *actions* (seed, "Ready to send?") have no authenticated surface | `app/api/welcome/chat/route.ts` is anonymous; the auth surface decision is open | J2/J4: AI can't fire project actions; "Ready to send?" can't send | OPEN (W2) |
| G2 | Branding not copied on import/claim | `app/api/projects/import`, `app/api/claim` | J1: outside-made projects arrive unbranded | ✅ DONE — all 3 creation paths route through `lib/project/apply-brand.ts` |
| G3 | `20260616_deliverables_scope.sql` | `docs/sql/` + prod | J4: build route can't thread scope until columns exist | ✅ RESOLVED — `deliverables.scope_kind/scope_value` confirmed in prod 2026-06-17 |
| G4 | Build route + MCP tool don't thread scope / MCP enum excludes `"email"` | `.../build/route.ts`, `project-tools.ts` | J4: can't seed an email deliverable from the tool path | ✅ DONE — both thread scope via `lib/deliverable/parse-scope.ts`; MCP enum now includes `"email"` (the web route already accepted it) |
| G5 | Seed-on-load missing | `app/project/[id]/page.tsx` | J4: outside→project handoff is dead plumbing | OPEN (W1) |
| G6 | `page.tsx` doesn't load `email_schedules` / `ui_state` | `app/project/[id]/page.tsx` | J2/J4: Emailing lane + collapse state can't render | OPEN (W1) — `ui_state` column now exists; `page.tsx` load still pending |

> **G7 (dropped):** Piece-5's original "ConnectYourAI is 307 lines (:282-589)" was inaccurate. The function is
> defined at line 446 and ends at 589 (~144 lines); line 283 is the render site, not the definition. P1 §A already
> cites the correct range (`ConnectYourAI:446-589`). Do not propagate the 307-line figure.

---

## Recommended sequence — always shippable

Rationale: the flagship (J4) is the monetizing journey (send is the paywall), the receiving end is already built, and
it forces the spine (G3 migration, seed-on-load, scope threading, G1 auth surface) into existence early.

### Wave 0 — light up the built engine (no UI, each ships alone)
Verify + apply G3; thread scope + add `"email"` to the build route and `swfl_project_build` (G4); copy branding on
import/claim (G2). Result: the engine is reachable + branded from every path.

### Wave 1 — Piece 1 thin shell
`app/project/layout.tsx` (rail + bottom search + persistent AI, no unmount) · decompose `ProjectDetail.tsx` (incl. the
real `ConnectYourAI` at ~144 lines) · `ui_state` migration + PATCH branch · `summarizeItem`/`groupItemsByKind` +
grouped item cards · `Modal` · Deliverable lanes/thumbnail/modal + Emailing lane live "this week's email" via
`lib/email/grounded-report.ts` reuse · seed-on-load (G5) · extend `page.tsx` load (G6). Result: the cockpit renders;
deliverables open big; nav doesn't reload the AI.

### Wave 2 — J4 flagship end-to-end + the auth spine
The authenticated project-action surface (G1) · a single "Ready to send?" prompt when an email deliverable is seeded ·
outside "email this" → seed → preview → tweak → send. Result: see-it-before-you-send works flawlessly; the paywall
journey is live.

### Wave 3 — widen
P2 full (project digest · cross-project identity index · dynamic 3+1 prompt engine replacing `lib/briefcase/visits.ts`)
· P4 (live refresh · guided edit · `deleted_at` trash) · P3 (`project_feed`, email click/open tracking on
`usage_events.action`, change-detection cron) feeding P2's best prompts. Result: the AI gets genuinely prepared;
deliverables become live/mutable; the invisible reporter fuels the situational prompts.

*Each of P2/P3/P4 still gets its own `superpowers:brainstorming` → spec → build (RULE 3.5). This plan sequences them;
it does not pre-approve their internals.*

---

## "Flawless" acceptance bar — per journey

- **J1:** create from briefcase/charts/`/r/` → lands at `/project/[id]`, auto-named (`FMB-33931 → "Fort Myers Beach
  33931"`), branding already applied regardless of creation path.
- **J2:** open a project → pill never reloads on switch; AI's prompts reference *this project's* items/scope (proves G1
  bridge is live); prompts change only on switch or a question.
- **J3:** Built lane thumbnail opens big; edit a section/color → rebuild passes `spec-validator` + 3 lints; shared
  `/p/[id]` link semantics explicit (fork-on-content-edit, cosmetic-in-place); deleted deliverable recoverable for the
  retention window.
- **J4:** outside "email this" → project opens with email seeded + previewed; tweak updates the preview; "Ready to
  send?" → `SendWeeklyHandle` schedules; **the broker saw exactly what's going out before it went.**

---

## Verification (end-to-end, per wave)

- **W0:** build an email deliverable via the MCP tool + web route with a ZIP scope → row carries `scope_kind/value`;
  create a project via import → branding present. `bun test` + `next build` + lint green.
- **W1:** run the app — create→auto-named; items grouped + expandable; deliverable opens big; schedule shows in
  Emailing lane; branding collapses on save; MCP collapses after 2×/keyed; `/project ↔ /project/[id]` nav keeps the
  pill alive; `ui_state` persists cross-reload. `bun test lib/project/`.
- **W2:** live-verify the full J4 chain in prod (the `task5_inchat_send_verify` discipline — close on a runtime
  signal, not "code looks right").
- **W3:** per-piece brainstorm + spec + its own verification.

---

## Critical files (by wave)

- **W0:** `app/api/projects/[id]/build/route.ts` · `app/api/mcp/project-tools.ts` · `app/api/projects/import/route.ts`
  · `app/api/claim/route.ts` · `docs/sql/20260616_deliverables_scope.sql` · `lib/deliverable/assemble.ts` (read-only).
- **W1:** `app/project/[id]/ProjectDetail.tsx` (decompose) · `app/project/[id]/page.tsx` (load) ·
  `app/project/layout.tsx` (new) · `app/api/projects/[id]/route.ts` (`ui_state`) · `lib/project/*` (new utils) ·
  `components/ui/Modal.tsx` (new) · `docs/sql/<date>_projects_ui_state.sql`.
- **W2:** `app/api/welcome/chat/route.ts` (or a new authed route — G1 decision) · `components/briefcase/BriefcaseProvider.tsx`
  (`setAiContext`) · `lib/briefcase/pill-mount.ts` (`{kind:"project"}`).
- **W3:** `lib/briefcase/visits.ts` (→ prompt engine) · `lib/project/digest.ts` + `prompt-engine.ts` (new) ·
  `workspace/DeliverableModal.tsx` + `lib/deliverable/build.ts` (P4) · `docs/sql/<date>_project_feed.sql` +
  `app/api/webhooks/resend/*` (P3).
