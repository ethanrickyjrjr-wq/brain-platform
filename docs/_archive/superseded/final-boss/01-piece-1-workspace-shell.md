# 01 — PIECE 1: Workspace Shell  ✅ READY TO BUILD

> **Recommended model:** 🧠 Opus — 9 tasks, 22 files, keywords: migration, schema, architecture







> Status: fully planned, every claim verified against the code. This is the foundation; build it first.
> Brainstorm done (decisions locked below). Next step on approval: write the repo spec under
> `docs/superpowers/specs/2026-06-17-workspace-shell-piece1-design.md`, then implement the build sequence.

## Contract — what this piece gives the others

**Provides (seams later pieces depend on):** `app/project/layout.tsx` (persistent rail + AI + bottom search) ·
`projects.ui_state jsonb` · `setAiContext/aiContext` on `BriefcaseProvider` + `{kind:"project"}` PillPage (in-session
context-bus half) · `summarizeItem` · `groupItemsByKind` · `ProjectWorkspace` + `workspace/*` mount points ·
`components/ui/Modal.tsx` · `DeliverableLanes/Thumbnail/Modal` (frozen render) · `deriveProjectName` · `ProjectSearch`.
**Depends on:** nothing — uses only what exists today. (Full matrix: `00-MASTER-PLAN.md`.)

## Locked decisions

1. **Persistent master-detail (layout-based).** A new `app/project/layout.tsx` holds the **projects rail** (left), the **bottom search bar**, and the **persistent AI** — it does NOT unmount on nav. `app/project/[id]/page.tsx` renders the selected project's world as `children`. Clicking a project navigates to its own URL `/project/[id]` (shareable, back-button) but the rail + AI persist and only the right side **swaps**. Reconciles "each its own page" + "click another, it swaps" (`00-MASTER-PLAN.md` → Architecture spine). Two-projects-on-one-page = future.
2. **AI persists + is project-aware via the route;** P1 passes `projectId` and **prefetches the digest on hover/click** ("time to load during click-over"). Deep project-awareness = P2.
3. **Project pane layout (top→bottom):** title → collapsible **Branding** → body (grouped item cards + two deliverable thumbnail lanes) → **Connect-MCP** → build/email actions. The **search bar is pinned at the BOTTOM** (north star), in the layout so it persists across switches.
4. **Items** = grouped compact cards with summaries **derived from fields (no LLM)**; click expands.
5. **Deliverables** = two lanes, **live compact mini-render** thumbnails, **click → in-page modal**. Built-lane opens the **frozen** deliverable big (live rebuild = P4); the **Emailing lane may render live "this week's/today's" email** via `lib/email/grounded-report.ts` reuse — include if cheap, else early-P4.
6. **Search** over reports (`BRAIN_CATALOG`) + charts (`saved_charts`) with "Add to project", from the bottom bar.
7. **Create-from-anywhere** with **deterministic auto-naming**, triggerable from the briefcase, the charts page, and any /r/ answer; **branding follows EVERY project (all creation paths)**.

## Verified anchors

- Persistent AI already correct: `app/layout.tsx:44-54` mounts `<BriefcaseProvider>`+`<AppShell/>`(→pill→`BriefcaseChat`) in the **root layout** → survives `/project ↔ /project/[id]` nav. `BriefcaseChat.tsx:15-18` already derives `projectId`. **No new AI mount.**
- `PATCH /api/projects/[id]` (`route.ts:45-57`) builds an `update` object (items/title/branding) → add a `ui_state` branch (one line); RLS scopes to owner.
- `email_schedules` has `project_id`+`scope_kind`/`scope_value`, **no `deliverable_id`** → Emailing lane is **schedule-driven**, not a deliverable→schedule map.
- Reuse confirmed: `ChartBlockView`/`HBarChart` accept `compact`; `StatCard`, `FrameRenderer` exist; `lib/briefcase/item-title.ts` (`itemTitle`) is the summarizer seed; collapse pattern = `CitationList.tsx`. No modal/typeahead component exists.
- **Hard constraint:** `react-hooks/set-state-in-effect` is build-blocking — collapse/dismiss via lazy `useState(()=>…)` + event handlers only; never props→state in an effect.

## Implementation

### A. Decompose the monolith + add the persistent layout
Add `app/project/layout.tsx` (NEW): the **projects rail** + **bottom search bar** + **persistent AI** wrapper — renders
`children`, does not unmount on `/project ↔ /project/[id]` nav (Architecture spine, `00-MASTER-PLAN.md`). Add
`app/project/ProjectsRail.tsx` (left list). Then replace `app/project/[id]/ProjectDetail.tsx` (743 lines) with
`ProjectWorkspace.tsx` (orchestrator owning `items,title,branding,deliverables,localPreviews,dirty,saving` +
`patch()/mutate()`) and a page-local `workspace/` dir:

| New file | Responsibility | Extract / reuse |
|---|---|---|
| `app/project/layout.tsx` | persistent rail + bottom search + AI wrapper (no unmount) | NEW (Architecture spine) |
| `app/project/ProjectsRail.tsx` | left projects list; click → `/project/[id]`; prefetch digest on hover | NEW |
| `workspace/ProjectTitle.tsx` | editable title + Save | `ProjectDetail:177-196` |
| `workspace/BrandingBlock.tsx` | branding fields + Save, collapsible | `:256-280` + `BRANDING_FIELDS` |
| `components/project/ProjectSearch.tsx` | search + results + Add | `BRAIN_CATALOG` + `savedChartsIndex` |
| `workspace/ItemsBoard.tsx` | group items by kind → grid | replaces `:199-249` |
| `workspace/ItemCard.tsx` | compact card: kind badge + `summarizeItem` + origin + move/remove; click→expand | §C |
| `workspace/ItemDetail.tsx` | full per-kind render (exported) | verbatim move of `renderItem()` `:592-743` |
| `workspace/DeliverableLanes.tsx` | Built lane + Emailing lane | replaces `:286-331` |
| `workspace/DeliverableThumbnail.tsx` | live compact mini-render | `ChartBlockView compact`, `StatCard` |
| `components/ui/Modal.tsx` | portal overlay | new (§D) |
| `workspace/DeliverableModal.tsx` | deliverable big in modal + revoke + `SendWeeklyHandle` | reuses `Modal` |
| `workspace/ConnectMcpBlock.tsx` | wraps existing `ConnectYourAI`; collapse/dismiss + connected state | `ConnectYourAI:446-589` (~144 lines, moves verbatim — **not** a one-liner, budget it) |
| `workspace/BuildActions.tsx` | template select + Build + Print | `:333-368`, `runBuild` |

`page.tsx` server load gains: `email_schedules` for this project, `projects.ui_state`, `savedChartsIndex`
(`select id, chart_block->>title`), and deliverable render fields (`template,narrative,items_snapshot,branding`).

### B. Global AI seam (now anchored in the layout)
The persistent AI lives via `app/project/layout.tsx` (rail + AI wrapper) atop the existing root mount, so it survives
project switches. Add `{kind:"project",projectId}` to `PillPage`/`pageFromPath` (`lib/briefcase/pill-mount.ts`) +
`aiContext/setAiContext` on `BriefcaseProvider` — `setAiContext` is the **in-session half of the context bus**
(`00-MASTER-PLAN.md`). **No prompt consumer in P1** (that's P2). Guard: never introduce `key={pathname}` above the
pill/AI (breaks persistence).

### C. Derived summaries + grouping (pure)
- `lib/project/summarize-item.ts` → `summarizeItem(item):string` on top of `itemTitle`: qa→question(≤80); metric→`label: value`; chart/frame→title; report→title??slug; source→label; note→first line; table_slice→`title — C×R`; file→`caption??basename (mimeShort)`.
- `lib/project/group-items.ts` → `groupItemsByKind` (fixed order qa,chart,metric,report,source,note,table_slice,file,frame).
- Tests: `summarize-item.test.ts` (one per kind).

### D. Deliverable lanes + modal
- **Built lane:** all `deliverables` for the project (frozen snapshots).
- **Emailing lane (schedule-driven):** the project's active `email_schedules` as cards (cadence+scope+audience+`last_run_at`); clicking can render the live "this week's/today's" email by reusing `lib/email/grounded-report.ts` (sends already pull fresh) — include in P1 if cheap, else early-P4.
- **Thumbnail:** exec-summary first sentence + template label + first `items_snapshot` chart via `ChartBlockView compact`; container ~`h-40`.
- **Modal:** `components/ui/Modal.tsx` — `createPortal` to body, `fixed inset-0 z-[60] bg-black/60`, centered `max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d1e2b] p-6`, close on backdrop+Esc, `role="dialog" aria-modal`. P1 "open big" = `<iframe src={'/p/'+id}>`.

### E. Collapsible branding + dismissible MCP (`projects.ui_state`)
- **Branding:** collapsed when any `BRANDING_FIELDS` value non-empty (true on fresh projects too — `POST /api/projects` copies `user_brand_profiles`→`branding`); collapses on Save; else open.
- **Connect-MCP:** open until `mcp_key!=null` (connected) **or** `ui_state.mcp_dismissed_count>=2`; then collapsed + reachable from the actions/email dropdown. Connected = "MCP connected" + click-to-disconnect confirm (confirm→`DELETE …/mcp-key`).
- **Store:** `projects.ui_state jsonb` (cross-device); add a PATCH branch. Connected-state derives from `mcp_key`, never `ui_state`.

### F. Search ("Add to project")
`components/project/ProjectSearch.tsx`: client index from `BRAIN_CATALOG` (import directly) + server `savedChartsIndex`;
lowercase `includes`; grouped Report/Chart; **Add** appends a `ProjectItem` and PATCHes `{items}` (same path as
today's `addFileItem`): report→`{kind:"report",slug:entry.id,title:entry.id}`; chart→`{kind:"chart",chart_id:row.id,title:row.title}`.
Lake-view search = deferred.

### G. Create-from-anywhere + auto-naming + brand-follows-all
- `lib/project/derive-name.ts` → `deriveProjectName(items):string`: most-frequent place (ZIP `\b3\d{4}\b` + known-SWFL-place scan over `report_id`/`source.label`/`note.text`/`qa.question`) + most-frequent topic (keyword table rent/permit/flood/cre/price); compose `"{place} {zip|topic}"` / `"SWFL {topic}"`; fallback `"Project {Mon D, YYYY}"` from earliest `added_at`. + `derive-name.test.ts`.
- **Trigger surfaces (all land already-open at `/project/[id]`):** the briefcase panel, the **charts page** (save a chart), and any **/r/ answer** (file → build). Each "Create Project" reuses `/api/projects/import {items,title:deriveProjectName(items)}` (localStorage drafts) or `/api/claim` (MCP token). No new write API.
- **Branding follows EVERY project (requirement, not optional):** copy `user_brand_profiles`→`branding` in `import`/`claim` too (today only `POST /api/projects` does), so a filled brand auto-applies regardless of creation path.
- Landing open-states: branding open unless filled; MCP open unless connected or dismissed-twice.

### H. Migration (run directly per RULE 1)
```sql
-- docs/sql/20260617_projects_ui_state.sql
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS ui_state jsonb NOT NULL DEFAULT '{}'::jsonb;
NOTIFY pgrst, 'reload schema';
```

### I. Email-through-Projects seed + cheap pre-staging (concrete; partly P1)

> **W0 pre-condition — ✅ DONE 2026-06-17.** G2 (branding on import/claim), G3 (scope migration), and G4 (thread scope + `"email"` in build route + MCP tool) were the no-UI items that had to land first. All three shipped: G2 = `lib/project/apply-brand.ts` routed through all 3 creation paths; G3 = `deliverables.scope_*` confirmed live in prod (no migration needed); G4 = shared `lib/deliverable/parse-scope.ts` threaded through the web build route + MCP `swfl_project_build` (enum now includes `"email"`). The rest of §I (seed-on-load) is still W1. Status: `SESSION_LOG.md` + `checks`.

Enables the flagship "email through Projects" flow (`00-MASTER-PLAN.md`). P1 owns the seed + preview surface; the LLM
"Ready to send?" prompt + selective pre-build are P2.
- **Seed-on-load (the missing consumer):** support `/project/[id]?seed=…` (or auto-build on first load) so an outside
  "email this" hands off cleanly. None exists today — without it the handoff is dead plumbing.
- **Email template + scope through the build path — ✅ DONE 2026-06-17.** `/api/projects/[id]/build` +
  `swfl_project_build` now thread `scope_kind/scope_value` via the shared, tested `lib/deliverable/parse-scope.ts`
  (canonical lowercase+trim, drops a kind with no value); the MCP `TEMPLATE_ENUM` now includes `"email"` (the web
  route already accepted it through `isTemplateId`). `deliverables.scope_*` were confirmed live in prod (schema probe)
  — `assembleDeliverable` has always written them, so no migration was needed.
- **Preview reuse (already built):** `/p/[id]` renders the email preview; `SendWeeklyHandle` is on it + project cards.
- **Cheap pre-staging (the REAL tier — deterministic, eager, no LLM):** on item save, derive summaries (§C), flag
  chartable combos, pre-resolve chart recipes — so the project looks "already lined up" on arrival. The selective LLM
  pre-build (one sample thumbnail / one-click PDF) is P2/P4, not P1.

## Build sequence (ship + verify each)
1. Extract `ItemDetail` from `renderItem` → every kind renders identically.
2. `summarizeItem` + `groupItemsByKind` + tests → green.
3. `ItemsBoard`+`ItemCard` → grouped cards, click expands.
4. Decompose remainder → `ProjectWorkspace`+`ProjectTitle`+`BrandingBlock`+`ConnectMcpBlock`+`BuildActions`; fix `page.tsx` import → all actions still work.
5. `ui_state` column + PATCH branch → round-trips on re-GET.
6. Collapsible branding + dismissible MCP + disconnect confirm → behaviors correct.
7. `Modal` → backdrop/Esc/portal.
8. `DeliverableLanes`+`Thumbnail`+`Modal`; extend `page.tsx` → Built + Emailing lanes; click opens big.
9. `ProjectSearch`+index → "rent" surfaces report+chart; Add persists+renders.
10. Auto-naming util+wiring → FMB-33931 draft → "Fort Myers Beach 33931"; empty → dated.
11. (Optional) AI seam → projectId flows, no P2 behavior.

## Verification
`bun test lib/project/`; full suite + `next build` + lint green (watch `set-state-in-effect`). Run the app:

- **(J1)** create from briefcase → auto-named (`FMB-33931 → "Fort Myers Beach 33931"`); branding already applied regardless of path (import + claim paths included).
- **(J1/J3)** items grouped + expandable; search-Add persists; build → Built lane thumbnail opens big.
- **(J4)** schedule → Emailing lane renders; seed-on-load `?seed=` hands off cleanly from outside.
- **(J1)** branding collapses on save; MCP collapses after 2× / when keyed.
- **(J2)** nav `/project ↔ /project/[id]` → pill never reloads; `ui_state` persists cross-reload.

## Deferred out of P1
P2 (dynamic prompts, AI project-awareness, cross-project overlap — P1 ships only the `aiContext`/`project` PillPage seam + the in-session context-bus half).
P4 (Built-lane open-to-current rebuild, deliverable editing, trash). NOTE: the **Emailing-lane** live "this week's/today's" preview can land in P1 by reusing `lib/email/grounded-report.ts`; the Built-lane live rebuild stays P4.
Lake-view search; two-projects-on-one-page; slot-level thumbnails (would need extracting `render-slots` from `app/p/[id]/page.tsx`).

## Critical files
`app/project/[id]/ProjectDetail.tsx` (decompose) · `app/project/[id]/page.tsx` (server load) ·
`app/api/projects/[id]/route.ts` (ui_state branch) · `app/layout.tsx` (confirm mount) · `lib/project/items.ts` ·
`lib/briefcase/item-title.ts` · `components/charts/ChartBlockView.tsx` · `app/p/[id]/StatCard.tsx` ·
`app/project/_import/ImportDraftOnLogin.tsx` · `app/api/projects/import/route.ts` · `app/api/claim/route.ts` ·
`refinery/packs/catalog.mts`.

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 1, Task 2, Task 4, Task 6 | `app/project/layout.tsx`, `components/project/ProjectSearch.tsx`, `components/ui/Modal.tsx` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
