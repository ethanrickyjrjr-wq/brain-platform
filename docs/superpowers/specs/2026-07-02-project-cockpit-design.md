# Project cockpit — unified email + social workspace

**Date:** 2026-07-02
**Check:** `project_cockpit_live_verify`
**Phase:** 1 of 3 (this spec covers Phase 1 only; Phases 2–3 are recorded at the bottom and get their own brainstorms)

## Problem

The pieces of the "one place to create, edit, and schedule" experience all exist, but they
live in three worlds:

1. `/project/[id]` — the workspace (materials thumbnails, scheduled lanes, filed data, AI bar).
2. `/email-lab` + `/email-lab/grid` — standalone labs (1,000+ line shells each), reachable by
   anyone, outside any project. Signed-in users wander out of project context and lose their
   brand/scope/data wiring.
3. Social — not a surface at all. The weekly calendar (Generate-Week), per-platform previews,
   and schedule modal are buried as a side panel inside the email lab shells.

Operator direction (2026-07-02): one cockpit. Projects on the left, tools + AI on the right.
Click a project, its frozen deliverables open as thumbnails; the main purpose is creating with
AI and scheduling emails + socials from one location. Retire the split worlds — "everyone
should see the best."

## Goal

A signed-in user lives inside `/project/[id]` and never needs to leave it to author, edit
(per-section, via AI), or schedule an email or a social week. Switching between Overview,
Email, and Social never remounts the projects rail, the pinned search, or the root AI.

**Verified vendor fact (crawl4ai, nextjs.org, 07/02/2026):** Next.js layouts do not re-render
on navigation between child routes — "Layouts are cached in the client during navigation…
they do not rerender." The persistent-cockpit premise is therefore route-nesting, not a
client-side mega-shell.

## What exists today (probed, not remembered)

- `app/project/layout.tsx` — the Piece 1 §A spine: persistent `ProjectsRail` (left), pinned
  `ProjectSearch` (bottom), AI mounted at root. Children swap without remounting the rail.
- `app/project/[id]/ProjectWorkspace.tsx` — Overview content: `MaterialsHub` (deliverable
  thumbnails), `DeliverableLanes` (scheduled sends), filed-data `ItemsBoard`, `BuildActions`,
  `ProjectActionBar` (Piece 2 free-form AI).
- `app/project/[id]/email-lab/` — project-scoped block-canvas lab. `ProjectEmailLabClient`
  (105 lines) wraps `EmailLabShell` with project brand tokens, scope, `?did=` deep-links, and
  saves via `POST/PATCH /api/projects/[id]/materials`.
- `components/email-lab/EmailLabShell.tsx` (1,087 lines) — free/block canvas.
- `components/email-lab/EmailLabGridShell.tsx` (1,306 lines) — the paid-tier grid canvas
  ("the north star" per its own header comment). ALREADY accepts `onSave`, `projectId`,
  `deliverableId`, `scope` — same save contract the block shell uses. The standalone page
  just never passes them.
- Social: `SocialCalendarPanel` (presentational, 117 lines) + `ScheduleSocialModal` +
  `useSocialComposer({ scope, projectId, branding })`, fed by `/api/email-lab/social/*` and
  `/api/email-lab/social-calendar`. All mounted only inside the email-lab shells.
- Auth: middleware gates the entire `/project` prefix; `/email-lab*` is anonymous-accessible
  (it is currently the only taste-surface for logged-out visitors).

## Design

### D1 — Tool switcher (the cockpit frame)

New nested layout `app/project/[id]/layout.tsx` renders a tool switcher — **Overview ·
Email · Social** — above `{children}`. Routes:

- `/project/[id]` → Overview (current `ProjectWorkspace`, unchanged content)
- `/project/[id]/email-lab` → Email (existing route, now a first-class tab)
- `/project/[id]/social` → Social (new)

Because these are sibling child routes under the persistent layouts, tool switches keep the
rail, search, root AI, and the switcher itself mounted. Active-tab highlight reads
`usePathname()` in a small client component (layouts can't read pathname — vendor-doc
confirmed). The switcher needs no project data beyond `[id]` from params; it makes no queries.

Mobile: the switcher is a horizontal segmented control; it must fit ~360px width with three
labels. Layout heights follow the repo standard (`dvh`/`h-full`, never `h-screen`).

### D2 — Social tool (promotion, not construction)

`app/project/[id]/social/page.tsx` (server) mirrors the email-lab page's loading pattern:
auth → project row (title, branding, items) → brand tokens + inferred scope → client.

`ProjectSocialClient` composes EXISTING pieces as a full page instead of a side panel:

- `useSocialComposer({ scope, projectId, branding })` — the state/actions hook the grid
  shell already uses.
- `SocialCalendarPanel` — Generate-Week + per-day expand (caption, hashtags, copy, load card,
  schedule). `onSchedule` IS wired here (it is optional in the panel precisely because only
  paid/scoped consumers wire it).
- `ScheduleSocialModal` — unchanged.
- A card preview column: "Load Card" renders the selected day's card `EmailDoc` read-only
  with the project's brand tokens, with an "Edit in Email" action that saves the card as a
  material and opens it in the Email tab via the existing `?did=` deep link.

**Scope guard:** this is a surface move. The publish engine (`lib/social/`) and the lab's
calendar system (`lib/email/social-calendar/`) remain two systems; wiring them (social
publish go-live, Gap 5) is explicitly out of scope, as it was in the 2026-07-01 lake-wiring
spec. No new social capability is built — only a real home for the existing one.

### D3 — Grid canvas inside the Email tool

The Email tab offers both canvases via a toggle (Block · Grid), persisted per-project in
`ui_state` (e.g. `email_canvas: "block" | "grid"`). Implementation is a project-scoped grid
wrapper alongside `ProjectEmailLabClient` — passing the SAME props the block client already
passes (`onSave` → materials endpoints, brand tokens, scope, `deliverableId`, project
photos). No changes inside `EmailLabGridShell` beyond what mounting reveals; it already
supports the contract.

A material opened from Overview (`?did=`) opens in the project's preferred canvas
(`ui_state.email_canvas`, default block). Both shells operate on the same `EmailDoc`, so the
toggle re-renders the loaded doc in the other canvas without converting or rewriting it.

This is the heart of the operator's vision: click a grid section, ask the AI for better
writing or a different chart, and only that section changes — now with the project's real
brand, scope, and lake data behind it instead of a seed doc.

### D4 — Retirement of the standalone labs (signed-in only, this phase)

- `/email-lab` and `/email-lab/grid`, when visited **signed in**: redirect to the user's
  most-recently-updated project's Email tab (`/project/[id]/email-lab`); if the user has no
  projects, create one (same path the funnel's auto-create uses) and land there.
- **Anonymous** visitors keep the standalone labs exactly as they are — zero changes — until
  Phase 2 ships the anonymous cockpit. Yanking them now would leave the funnel with no
  taste-surface.
- No deletion of shell code in this phase: both shells are the cockpit's canvases now.
  The standalone *pages* become thin redirect-or-render wrappers.

### Error handling

- Social page with an unscoped project (no ZIP/place inferable): scope falls back to
  region-wide SWFL, same as the email lab's `effectiveScope` fallback. Never blocks.
- Generate-Week failure: existing panel `state === "error"` retry affordance, unchanged.
- Redirect target race (project deleted between list fetch and navigation): fall back to
  `/project` (the list/landing).
- Grid toggle with an incompatible doc: keep the doc, render in the chosen shell —
  both consume `EmailDoc`; if a doc renders degraded, the user toggles back (no destructive
  conversion, the saved doc is never rewritten by a toggle alone).

### Testing

- Unit: switcher active-state from pathname; redirect chooser (most-recent project / create /
  fallback); `ui_state.email_canvas` round-trip in the projects PATCH.
- Existing suites must stay green: email-lab social upload/generate tests, materials
  endpoints, project PATCH.
- Verification: `bunx next build` (not bare tsc, per repo rule), then drive the flow —
  create project → Email tab → build → toggle grid → Social tab → Generate Week → schedule
  modal opens → Overview shows the material. Live-verify check: `project_cockpit_live_verify`
  (operator-run).

## Explicitly OUT of Phase 1

- Wiring the social publish engine to the calendar system (Gap 5, parked).
- Research-in-page tool (AI webpage write-ups in the canvas) — future tool tab, own brainstorm.
- Per-project click analytics ("third click") — operator ranked least important.
- Any chat-chart building (operator decree 2026-07-02 — parked).
- Anonymous cockpit + quotas, homepage showcase (below).

## Recorded for later (not in this build)

**Phase 2 — anonymous cockpit + identity-gated quotas.** Anonymous users get the real
cockpit with localStorage-backed projects, capped at X projects before email signup; signup
unlocks X more. Stripe appears only at send/schedule — this COMPOSES with the locked
decision (builds free, SEND is the paywall, no Stripe on creation): the caps are identity
gates for lead capture, not payment gates. X values are the operator's call. The standalone
labs die completely here. Needs its own research pass (abuse, localStorage limits, draft
migration — `ImportDraftOnLogin` already exists as the seed of the migration path).

**Phase 3 — homepage showcase.** The homepage leads with real AI-built deliverables
(gallery of actual outputs) plus a words→product loop (looping capture or live replay of a
prompt becoming an email). Needs its own research pass (capture tooling).
