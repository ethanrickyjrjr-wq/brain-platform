# 00 — MASTER PLAN: Live Work Environment

## NORTH STAR — the Project Page is a live AI workspace, not a file cabinet

One page where a user's work actually lives. Open a project, see everything — uploaded files, built deliverables,
emails going out — as clickable thumbnails that open to **current** data. The AI knows exactly what's in that project
and is actively helpful, not a chatbot you have to wake up. **Every action on the platform feeds the project AI
context, so it's always ready — a partner that already knows what's going on, not a tool you prompt.**

How it works (operator's north star, locked):
- **Projects rail** — list of projects; pick one, its world loads; pick another, it swaps. (Each project still has its
  own URL — see *Architecture spine*.)
- **Inside a project** — two thumbnail grids: (1) built deliverables, (2) active email campaigns. Click a thumbnail →
  full-size with **live data** (weekly email shows this week; daily shows today).
- **AI assistant** — always present, context-aware: knows the project, what changed in the data, what's being emailed,
  where they left off. Surfaces **3 rotating smart prompts + 1 action offer** — broad on first open, focused when a
  project is selected, refreshed after a question or a project switch.
- **Create from anywhere** — save a chart, build a deliverable outside projects → "Create Project" → auto-named, lands
  already open. Branding open unless filled; MCP-connect open unless connected or dismissed twice.
- **Branding** — under the title; fill once, it collapses and **follows every project after** *(target; import/claim not yet wired — see G2 / P1 §G)*.
- **MCP connect** — below branding; close removes it and everything moves up; connected → just "MCP connected";
  disconnect → click → confirm/cancel.
- **Search bar at the bottom** — find charts, /r/ pages, data to pull into a project.
- **Deliverable editing** — click → open → edit sections/colors/rebuild; deleted work held a few days, then gone.
- **Background site agent** — invisible; reports daily to every project AI (new data, **new features**, what changed);
  the AI turns that into smart prompts without the user asking.

This is the *consumer cockpit* on the existing flywheel (briefcase → project → deliverable → email → buyer-intent
reply) and the data contract in `docs/THE-GOAL.md`. It does **not** change the brain/master pipeline.

## Who this is for — and what "good" means (the WHY, the quality bar)

The end user is a **professional operator — picture a 20-year real-estate broker.** They don't want "home sales are
down." They want **accurate, fast, polished, visually appealing** output that **tells a story** and surfaces what they
*missed* — high-level decisions and grounded predictions read off the data's own patterns. That is the whole reason
this exists: **Data + AI — the data holds the story, the AI connects the dots.** Every build clears that bar or it
isn't done: relevant to the data (real estate, mostly, today), cited, and decision-grade. A pretty chart that says
nothing fails; a true insight rendered cleanly is the product.

## The spine — everything is `project_id`; it converges at Projects

There is **one persistent assistant**, not two bots. It has two *contexts*:
- **Outside a project** ("Outside mode") — works the whole site: answers, charts, conversations, and it **saves work**
  (briefcase/draft, saved charts). Project-agnostic, but everything it saves is on its way to a project.
- **Inside Projects** ("Project mode") — aware of **all of the user's project IDs**, but **most knowledgeable about the
  currently-open project**. Cross-project aware, current-project focused.

Same assistant, **joined by the context bus + `project_id`** — not two chatbots messaging each other. Work done in
Outside mode flows (via the bus) toward the project, so **by the time the user arrives at Projects, the pieces are
already lined up.** Projects is the **convergence point**: it feels instant *because the cheap work already happened
upstream.*

## Architecture spine (reconciles "own page" + "swaps in place")

The operator said both *"each project gets its own page"* and *"list on the left… click another, it swaps."* One
mechanism satisfies both — a persistent **Next.js layout** for the project area:

- `app/project/layout.tsx` (NEW) holds the **projects rail**, the **bottom search bar**, and the **persistent AI** —
  it does NOT unmount on navigation.
- `app/project/[id]/page.tsx` renders the selected project's world as the layout's `children`.
- Clicking a project navigates to `/project/[id]` — a real URL (shareable, back-button, deep-linkable from the
  "Create Project" landing, and literally "its own page") — but because the rail + AI live in the layout, only the
  right side **swaps** while the AI keeps its context. "Give him time to load during click-over" = **prefetch the
  digest on hover/click**. Idiomatic; no hand-rolled page-state juggling.
- *Only* alternative = pure client-side swap with no per-project URL — loses shareable links + back button for no gain.

## The context bus (the north-star mechanism)

"Every action feeds the AI context" needs ONE channel, not ad-hoc wiring. A lightweight **context event** is emitted
by any surface when something meaningful happens (save chart, build, send, view, edit, project-switch). Two halves:
- **Ephemeral / in-session:** `setAiContext(ctx)` on `BriefcaseProvider` (P1 seam) — what the user is doing right now.
- **Durable / cross-session:** `project_feed` rows (P3) — what happened while away (data changed, 7 clicks, Walmart
  nearby, a new platform feature). P2's prompt engine reads BOTH + the project digest.

Feed signal kinds (P3 must carry all four): **data-change** · **engagement** (clicks/opens) · **external-event**
(nearby construction/news) · **platform-feature** ("we just got new charts that fit this — want to see?"). The last is
why the site agent reports *features*, not only data.

## Flagship flow — email through Projects (see it before you send)

We do **not** send email from a blind "outside" surface. Outside mode can *suggest* it; the *send* happens in Projects
so the user **sees exactly what's going out.**

1. Outside mode (on a chart / answer) suggests "email this to your list?"
2. One button → land in the project (auto-created/opened, branding already applied because brand follows all paths).
3. The **email deliverable is seeded and previewed** on `/p/[id]`.
4. The user tells the Project AI to tweak (section, color, swap a chart), sees it update, then the prompt **"Ready to
   send?"** → send.

**Honest status:** the email *engine* is built — Task 2 spine (`5ea26cb`), Task 3 brand/recurring (`ed8e77e`), Task 4
email+PDF deliverable (`7630b32`), Task 7 build→schedule bridge (`a5d1858`), Task 6 send handle on `/p/[id]`+`/project`
(`f8bc3cc`), and Task 5 Slice 1 — the in-chat "Send weekly" card (`962ad12`). That work lives in
`docs/superpowers/plans/2026-06-16-deliverable-convergence/` (its scope-handoff block points back here). So this is a
**rewire onto the project workspace, not a rebuild.** The receiving
end is largely built — `/p/[id]` renders the email preview and `SendWeeklyHandle` is already on it + project cards. The
*outside→project→preview→send* handoff is **not built** and needs three concrete gaps closed (P1 + email lane, see
`01-…` §I): (a) the project page can't **seed/auto-build on load** (no `?seed=` today); (b) `/api/projects/[id]/build`
+ `swfl_project_build` don't thread `scope_kind/scope_value` and the tool's template enum **excludes `"email"`**
(`assembleDeliverable` already supports email+scope; `deliverables.scope_*` columns are **confirmed live in prod**
(schema probe 2026-06-17 — `assembleDeliverable` has always written them, so a missing column would break every build));
(c) the "Ready to send?" prompt is P2, and P2's project-action path depends on an **authenticated chat surface** —
`/api/welcome/chat` is public and receives no `user_id`/`project_id` today (**G1**, the J2/J4 blocker; see
`02-…` for the locked open decision on the auth surface).
Right call: you can't "see what you're emailing" from a blind send — the project preview is where it's actually visible.

## Convergence engine — REAL vs. SELECTIVE vs. REACH (be precise about cost)

The vision: by the time the user clicks build/send it's not a 3-minute scramble — the assistant lined things up while
they worked. Possible, but only if we're honest about what each tier costs:

- **REAL — do it eagerly (deterministic, ~free):** derive item summaries; detect "these two series would chart well
  together"; pre-resolve chart **recipes** (no LLM); build the **cross-project identity index** ("you already have this
  33931 flood metric in *Luxury Clients*"); **invalidate** a staged suggestion when its source item is deleted. This is
  cache/seed work, not AI thinking — it's what makes arrival feel instant.
- **SELECTIVE — possible, each costs an LLM pass, so do ONE on a strong signal in the background:** pre-**build** a
  single suggested deliverable so **one** sample thumbnail is ready on arrival; pre-build so "turn this into a PDF" is
  one click (the PDF itself is `window.print()` of an already-built `/p/[id]`). **Never pre-build every option.**
- **REACH — reframe, don't promise:** two AIs collaborating in real time over a "live line" while the user types;
  zero-wait full deliverables for arbitrary asks; pre-building all options. Buildable version = **one assistant + the
  context bus + a background pre-stage/pre-build worker.** Same felt experience, actually shippable.

Rule of thumb: **stage everything cheap; build one thing on a clear signal; never block the user waiting on either.**

## The 4 pieces (decomposition)

| # | Piece | One line | Net-new vs. exists today |
|---|---|---|---|
| 1 | **Workspace Shell** | The live cockpit UI + creation flow | Grouped item cards w/ summaries, deliverable thumbnail lanes + modal, collapsing branding, dismissible MCP, search bar, auto-named create. |
| 2 | **Project-Aware AI** | The always-prepared assistant | AI *knows* the project + all projects; cross-project overlap; dynamic 3+1 situational prompts. (Today: prompts are 100% static by page/visit-count; pill isn't project-aware.) |
| 3 | **Signal Layer** | The invisible reporter | Change-detection feed + per-project notifications + email click/open tracking — the *fuel* for Piece 2's best prompts. (Today: none of these exist; only raw freshness tokens + reply sensor.) |
| 4 | **Editing + Refresh + Trash** | Make deliverables live & mutable | Open-to-current rebuild, edit a past deliverable (section/color/add/delete/rebuild), soft-delete with a few-days bin. (Today: deliverables are frozen, immutable snapshots.) |

## User Journeys — the backward-from-the-broker view (J1–J4)

The four pieces are organized by **system layer** (Shell → AI → Signal → Editing). These journeys organize the same work by **what the broker experiences end-to-end.** Use them to catch "this seam is built, but the journey still feels broken."

| Journey | Moment → outcome | Seams it rides | Gap |
|---|---|---|---|
| **J1 — Create from anywhere** | Broker saves a chart / files an answer outside Projects → one button → arrives inside a named, branded project, nothing to set up. | `deriveProjectName` (P1) · `/api/projects/import` + `/api/claim` · branding copy from `user_brand_profiles` | G2: import/claim don't copy branding → projects from outside arrive unbranded |
| **J2 — Open a project, already prepared** | Click a project in the rail → persistent AI holds this project's context, offers 3 situational prompts + 1 action. | `app/project/layout.tsx` persistent rail + AI (P1) · `setAiContext/{kind:"project"}` PillPage (P1 in-session bus) · project digest + prompt engine (P2) · `project_feed` (P3, later) | **G1:** `/api/welcome/chat` is anonymous — no `user_id`/`project_id` → AI can't be project-aware; "Ready to send?" can't fire |
| **J3 — Build / edit a deliverable, see it live** | Build → thumbnail in Built lane → click → opens big → edit section/color/add-remove → rebuild → reflects current data. | `DeliverableLanes`/`Thumbnail`/`Modal` + `components/ui/Modal.tsx` (P1) · `assembleDeliverable` guided rebuild + `deleted_at` trash (P4) | P4 is net-new: thumbnails/modal/lanes (P1); live refresh, guided edit, trash (P4) |
| **J4 — Email through Projects: see it before you send** | Outside, AI suggests "email this to your list?" → one button → project opens with email deliverable seeded + previewed → broker tweaks → "Ready to send?" → send. *This is the flagship — send is the paywall.* | seed-on-load `?seed=` (P1) · build route + `swfl_project_build` threading scope + `"email"` template · `/p/[id]` preview + `SendWeeklyHandle` (built) · "Ready to send?" prompt (P2, blocked on G1) | **G3:** `20260616_deliverables_scope.sql` unapplied — verify prod first. **G5:** seed-on-load missing. **G1:** auth surface for P2 actions |

### "Flawless" acceptance bar — how we know each journey is done

- **J1:** create from briefcase / charts / `/r/` → lands at `/project/[id]`, auto-named (`FMB-33931 → "Fort Myers Beach 33931"`), branding already applied regardless of creation path.
- **J2:** open a project → pill never reloads on switch; AI's prompts reference *this project's* items/scope (proves G1 bridge is live); prompts change only on switch or a question.
- **J3:** Built lane thumbnail opens big; edit a section/color → rebuild passes `spec-validator` + 3 lints; shared `/p/[id]` link semantics explicit (fork-on-content-edit); deleted deliverable recoverable for the retention window.
- **J4:** outside "email this" → project opens with email seeded + previewed; tweak updates the preview; "Ready to send?" → `SendWeeklyHandle` schedules; **the broker saw exactly what's going out before it went.**

---

## Sequencing & why

```
P1 Workspace Shell ─┬─> P2 Project-Aware AI ──> (richer with) ──┐
                    │                                            │
                    └─> P4 Editing/Refresh/Trash                 │
                                                                 │
P3 Signal Layer ─────────────(feeds situational prompts)─────────┘
```

- **P1 first** — it's the skeleton everything renders in, and it creates most of the seams.
- **P2 next** — needs P1's project state + `aiContext` seam to reason over. Ships an MVP on *existing* signals
  (freshness diffs, email_sends, reconcile verdicts, "where you left off"); P3 enriches it later.
- **P3** — mostly backend; can run partly in parallel with P2. P2's "7 clicks / Walmart nearby" prompts only become
  real once P3 lands the feed + click tracking.
- **P4** — lives inside P1's deliverable lanes/modal; independent; do whenever after P1.

### Wave-order alternative — flagship-vertical-first

The piece-order above completes each *layer* before the next. An alternative sequences by *journey* — ships the monetizing J4 end-to-end early, then widens:

- **W0** — light up the built engine with no UI work: verify/apply G3 scope migration; thread scope + `"email"` in build route + MCP tool (G4); copy branding on import/claim (G2). Each ships alone.
- **W1** — P1 thin shell + seed-on-load (G5) + `page.tsx` load expansion (G6). Result: cockpit renders; deliverables open big; nav doesn't reload the AI.
- **W2** — J4 flagship end-to-end + the auth spine: the authenticated chat surface (G1) + "Ready to send?" prompt. Result: see-it-before-you-send works; the paywall journey is live.
- **W3** — P2 full (digest + cross-project + dynamic prompts) + P3 (`project_feed` + click tracking + change-detection cron) + P4 (live refresh + guided edit + trash). Result: AI gets genuinely prepared; deliverables become live/mutable.

**Tradeoff:** piece-order completes layers cleanly and each layer is fully built before the next. Wave-order ships the monetizing journey sooner but mixes layer work per wave. Pick deliberately — don't let two orderings float across two docs.

## Shared data model (program-wide)

Keep additive + idempotent. One migration per piece.

| Piece | Schema change | Purpose |
|---|---|---|
| P1 | `projects.ui_state jsonb DEFAULT '{}'` | per-project UI/agent state bag (collapse, mcp dismiss count) — **extensible by all later pieces** |
| P3 | `project_feed` (or `notifications`) table; email click tracking via `usage_events.action='click'` (Resend webhook) or an `email_events` table | situational-prompt fuel |
| P4 | `deliverables.deleted_at` (+ retention sweep) **or** a `trash` table; deliverable edit/version fields | live refresh + trash + editing |
| P2 | (decide at brainstorm) likely none — derive project digest on the fly; optional `project_ai_memory` | AI context |

## CROSS-BUILD CONTRACTS — read before touching any piece

These are the named seams. **A later build depends on the exact name an earlier build creates.** If you change a
name, fix it here in the same commit.

| Seam (name) | Created by | Consumed by | Contract |
|---|---|---|---|
| `projects.ui_state jsonb` | P1 | P2,P3,P4 | per-project state bag; **additive keys only**, never repurpose a key |
| `setAiContext(ctx)` / `aiContext` on `BriefcaseProvider`; `{kind:"project",projectId}` in `PillPage`/`pageFromPath` (`lib/briefcase/pill-mount.ts`) | P1 (**seam only — no consumer**) | P2 | project buttons push context; P2 reads it to prepare prompts |
| `summarizeItem(item)` (`lib/project/summarize-item.ts`) | P1 (derived, no LLM) | P2 | P2 may swap to AI summaries **behind the same signature** — call sites don't change |
| `groupItemsByKind(items)` (`lib/project/group-items.ts`) | P1 | P2,P4 | stable grouping for cards + digests |
| `ProjectWorkspace` + `app/project/[id]/workspace/*` | P1 | P2,P4 | mount points: P2 adds prompt surfaces, P4 adds edit/trash controls |
| `components/ui/Modal.tsx` | P1 | P4 | reused for the editing overlay |
| `DeliverableLanes` / `DeliverableThumbnail` / `DeliverableModal` | P1 (renders **frozen** snapshot via `<iframe>`) | P4 | P4 swaps frozen render for live rebuild + edit controls; Emailing lane gains live "this week's email" |
| `deriveProjectName(items)` (`lib/project/derive-name.ts`) | P1 | — | stable util |
| `ProjectSearch` (`components/project/ProjectSearch.tsx`) | P1 | P2,P3 | P2/P3 can inject "suggested adds" into the same surface |
| context event convention (`setAiContext` in-session + `project_feed` durable) | P1 (in-session half) + P3 (durable half) | P2 | the ONE channel "every action feeds the AI"; surfaces emit, P2's prompt engine reads |
| `project_feed` table — kinds: data-change · engagement · external-event · platform-feature | P3 | P2 | situational-prompt fuel; "platform-feature" = site agent announcing new charts/features |
| email click/open events | P3 | P2 | enables "your property got 7 clicks" |
| change-detection (freshness-token diff per project scope) | P3 | P2 | enables "the new data shows X" |
| dynamic prompt engine + project digest builder | P2 | (UX) | the always-prepared assistant; reads P1 state + P3 feed |
| deliverable rebuild-with-fresh-data | P4 | Emailing lane live preview | |
| soft-delete trash + retention sweep | P4 | — | "deleted work saved for a few days" |

## What "bringing it all together" means

When all four land: the user opens a project, the **persistent AI** (P1 mount) is already prepared because it read
the **project digest** (P2) plus **today's signals** (P3); it offers 3 situational prompts + 1 offer; the user sees
**grouped items** (P1) and **live deliverable thumbnails** (P1) that open big (P1) to **current data** (P4) and can
be **edited in place** (P4); a top **search** (P1) pulls in more; scheduled sends show in the **Emailing lane** (P1)
with live "this week's email" (P4); deleted work is recoverable for a few days (P4). The prompts only change on
project-switch or a question (P2). That is the cockpit.
