# HANDOFF — read me first (new session)

You're picking up a multi-build program to turn the project page into a **live work environment**. This file gets you
oriented in 2 minutes. Then read `00-MASTER-PLAN.md`, then the piece you're building.

## The ultimate goal (one paragraph)

**North star: the Project Page is a live AI workspace — not a file cabinet. Every action on the platform feeds the
project AI context, so it's always ready — a partner that already knows what's going on, not a tool you prompt.**

`/project/[id]` becomes a **cockpit**: open a project and *see what's in it and what's been built*; the **Project AI
is always prepared** — it knows a little about each project, knows what you already have and what overlaps other
projects, and **suggests without nagging** via situational prompts that change as things happen ("your property got 7
clicks", "Walmart is building near your listing", "we just got new charts that fit this — want to see?", "pick up where
we left off?"). You can build, **edit**, and **email** data-grounded deliverables, see live thumbnails of each (open
them big to current data), and recover recently deleted work. This is the consumer cockpit on top of the existing
briefcase → project → deliverable → email flywheel. It does **not** touch the brain/master data pipeline.

## Who you're building for (the quality bar)

The end user is a **professional operator — picture a 20-year real-estate broker.** Not "home sales are down" — they
want **accurate, fast, polished, visually appealing** output that **tells a story** and shows what they *missed*:
high-level decisions and grounded predictions read off the data's patterns. **Data + AI — the data holds the story, the
AI connects the dots.** Every build clears that bar or it isn't done. (Full: `00-MASTER-PLAN.md` → "Who this is for".)

## The spine (one line)

Everything is keyed to **`project_id`** and **converges at Projects.** There is **one persistent assistant in two
contexts** — Outside mode (works the whole site, saves work) and Project mode (all-project-aware, current-project
focused) — joined by the **context bus + `project_id`**, not two bots talking. Projects feels instant because the cheap
work already happened upstream.

## What's REAL vs. what's REACH (don't over-promise)

- **REAL / eager (deterministic, ~free):** summaries, chartable-combo detection, chart-recipe pre-resolution,
  cross-project identity index, staged-suggestion invalidation on delete.
- **SELECTIVE (costs an LLM pass — ONE, on a strong signal, in background):** pre-build *one* suggested deliverable so a
  sample thumbnail / one-click PDF is ready on arrival.
- **REACH (reframe, don't build literally):** two AIs over a live line; zero-wait arbitrary deliverables; pre-building
  every option → one assistant + context bus + a background pre-stage/pre-build worker. (Detail: `00-MASTER-PLAN.md` →
  Convergence engine.)

## Continuity

Write so the next session picks up *like you never left*: keep `00-MASTER-PLAN.md` contracts current, leave open
decisions in the `checks` ledger + `SESSION_LOG.md` (not in plan-doc prose), and make the *site* flow the same way —
every action feeds `project_id` context so the assistant is always ready.

## How it's cut (build in this order)

1. **Piece 1 — Workspace Shell** (`01-…`) — ✅ planned + code-verified. **Build this first.** The skeleton + most seams.
2. **Piece 2 — Project-Aware AI** (`02-…`) — 🟡 draft. The always-prepared assistant + dynamic prompts. Needs P1's seams.
3. **Piece 3 — Signal Layer** (`03-…`) — 🟡 draft. The invisible reporter (feed + click tracking + change-detection). Fuels P2.
4. **Piece 4 — Editing/Refresh/Trash** (`04-…`) — 🟡 draft. Live deliverables + edit + trash. Lives in P1's modal/lanes.

**Pieces 2–4 are scoped drafts, NOT approved designs.** Each one: `superpowers:brainstorming` → spec under
`docs/superpowers/specs/` → plan → build. Do not skip the brainstorm (RULE 3.5).

## What builds must know about each other (the contracts)

The full matrix is in `00-MASTER-PLAN.md` → "CROSS-BUILD CONTRACTS". The load-bearing ones:

- **Architecture spine** (P1): a persistent `app/project/layout.tsx` holds the projects rail + bottom search + AI; each project keeps its own URL `/project/[id]` but only the right side swaps and the AI never unmounts. This reconciles "each its own page" + "click another, it swaps."
- **Context bus** (the north-star mechanism): ONE channel = `setAiContext` (in-session, P1) + `project_feed` (durable, P3). Every surface emits; P2 reads. Don't wire AI context ad-hoc.
- **`projects.ui_state jsonb`** (P1) is the shared per-project state bag — P2/P3/P4 add keys, never repurpose them.
- **`aiContext`/`setAiContext` + `{kind:"project"}` PillPage** (P1 ships the *seam only*) is how P2 hooks the AI to project buttons.
- **`summarizeItem` / `groupItemsByKind`** (P1) — P2 may swap to AI summaries *behind the same signature*.
- **`DeliverableModal`/`Thumbnail`/`Lanes`** (P1, frozen render) — P4 swaps in live refresh + editing here.
- **`project_feed`** (P3) — P2 reads it to generate the "7 clicks / new data" prompts. P2 ships an MVP on *existing* signals before P3 lands.

If you rename a seam, fix `00-MASTER-PLAN.md` in the same commit.

## Current state (2026-06-17)

- Nothing in this program is built yet. Piece 1 is fully planned (this folder) and verified against the code.
- The existing project page is `app/project/[id]/ProjectDetail.tsx` (743-line form) — Piece 1 decomposes it.
- The AI pill is already mounted in the **root layout** (`app/layout.tsx:44-54`) and already reads `projectId` from the
  path — persistence is free; don't re-architect it.

## Repo rules you must follow (from CLAUDE.md — not optional)

- **RULE 0 / SESSION_LOG.md** — read it at session start; append a top-of-file entry before every push (hook-enforced).
- **RULE 2 — Check → Submit → Update** — open obligations live in the `checks` ledger (`node scripts/check.mjs`), build
  status in `_AUDIT_AND_ROADMAP/build-queue.md` — **not** in plan-doc markers. This FINAL BOSS folder is documentation, not a status board.
- **RULE 3.5 — brainstorm before building** (Pieces 2–4 especially).
- **No autonomous push / branch / PR.** Work on `main`; stage explicit paths (`git add <paths>`, never `-A`); use
  `node scripts/safe-push.mjs`; stop after commit and let the operator push (memory: `no-autonomous-push`).
- **Pre-push gates** are hook-enforced (lockfile, vocab, secrets, ingest guard, pack⇆catalog). Don't fight them.
- **SQL migrations:** run directly, idempotent, creds in `.dlt/secrets.toml` (RULE 1).
- **Vendor-first:** verify any vendor surface (Resend webhook shape for P3, etc.) against live docs in-session.

## Gotchas that will bite you

- **`react-hooks/set-state-in-effect` is a build-blocking error.** Derive during render / lazy `useState(()=>…)` /
  event handlers — never read props→state in an effect.
- **Don't add `key={pathname}` above the AI pill / in `app/project/layout.tsx`** — it would unmount the assistant on every project switch (breaks the whole "persistent, prepared AI" premise). The rail + AI live in the layout precisely so they survive nav.
- **Search bar is at the BOTTOM** (operator said "top" once, "bottom" twice incl. the north star — bottom wins), in the layout so it persists.
- **Branding must follow ALL creation paths** — copy `user_brand_profiles`→branding in `import`/`claim` too, not just direct create, or a filled brand won't auto-apply to projects made from outside.
- **`email_schedules` has no `deliverable_id`** — the Emailing lane is schedule-driven, not a deliverable→schedule map.
- **Deliverables are frozen snapshots** today; `/p/[id]` is a capability link people may already hold — P4 must decide
  refresh-in-place vs. new-version before mutating it.
- **Monetization:** builds (incl. editing) are free forever; **send** is the only paywall. Never gate a build.
- **No-invention is structural** — any P4 rebuild/edit must still pass `spec-validator` + the three lints.

## Where to start right now

Read `00-MASTER-PLAN.md` → `01-piece-1-workspace-shell.md`. If approved to build Piece 1: write the repo spec
(`docs/superpowers/specs/2026-06-17-workspace-shell-piece1-design.md`), run the `ui_state` migration, then execute the
Build Sequence in `01-…` step by step, verifying each.
