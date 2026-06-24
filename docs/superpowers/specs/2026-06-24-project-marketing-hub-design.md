# Project Marketing Hub — Design Spec
**Date:** 2026-06-24  
**Status:** Approved  
**Scope:** Phase 6 (save/load + materials grid) + Phase 7 (recurring re-fill + send)  
**Depends on:** block-canvas Waves 0–5 shipped (`6419138d`)

---

## 1. What We're Building

A **Project Marketing Hub** — the project workspace becomes a property-level media library where every marketing material for a listing (emails, PDFs, market reports, one-pagers) lives as a frozen thumbnail card. AI generates on demand, never auto. Users see what's been built, open it, edit it, or refresh the data with one click.

**Three nouns — kept cleanly separate:**

| Noun | What it is | Storage |
|------|-----------|---------|
| **Material** | A frozen snapshot of a marketing piece at a point in time | `deliverables` row |
| **Project** | The address / property container | `projects` table (existing) |
| **Schedule** | The recurring send recipe | `email_schedules` table (existing) |

A Material can exist without a Schedule. A Schedule can fire without a Material (re-fills from live lake data). Filing AI suggestion bridges Material → Project post-build.

---

## 2. Architecture: Extend `deliverables`, Not a New Table

Add one nullable `doc JSONB` column to the existing `deliverables` table. A new template value `"block-canvas"` stores the full `EmailDoc` there. All other templates (`market-overview`, `client-email`, `one-pager`, `email`) continue using `items_snapshot + narrative` unchanged.

**Why:** Materials need to appear in the same thumbnail lane — one table, one versioning system (`supersedes_id`), one trash system (`deleted_at`), one thumbnail component. Adding a parallel table creates a silo.

**Migration:** One nullable column. Zero risk to existing rows.

```sql
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS doc JSONB;
```

`doc` is non-null only when `template = 'block-canvas'`. All other templates leave it null.

---

## 3. Project Workspace Layout

```
┌──────────────────────────────────────────────────────────────┐
│  PROJECT HEADER                                              │
│  123 Main St  ·  Fort Myers Beach  ·  33931                  │
│  [+ New Material ▼]              [⊞ Grid]  [≡ List]  [⋯]   │
├──────────────────────────────────────────────────────────────┤
│  AI suggestion banner (dismissable, shown post-build only)   │
│  ◈  Looks like a 123 Main St listing — file it here?         │
│                                              [Yes]  [Skip]   │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  MATERIALS  ────────────────────────────────── 6 items       │
│                                                              │
│  [Card] [Card] [Card]                                        │
│  [Card] [Card] [+]                                           │
│                                                              │
├─ FILED DATA ────────────────────────────── ▾ collapse ───────┤
│  Answers · 3   Figures · 7   Sources · 4   Charts · 2        │
│  (ItemsBoard — existing, intact, collapsed below the fold)   │
└──────────────────────────────────────────────────────────────┘
```

**Materials are above the fold.** Filed data is supporting context — it stays but lives below, collapsible, defaulting to collapsed on first load if ≥3 materials exist.

### Grid vs List toggle
- **Grid** (default): `grid-cols-3` on `xl`, `grid-cols-2` on `lg`, single col on `md`
- **List**: compact single-row cards with inline thumbnail strip, title, status, date, actions

---

## 4. Material Card Anatomy

```
┌────────────────────────────────┐
│  ╔══════════════════════════╗  │  ← thumbnail area, 180px tall
│  ║  scaled mini render of   ║  │    bg-[#0d2030], overflow-hidden
│  ║  first 2 blocks OR       ║  │    iframe at 30% zoom (600px → 180px)
│  ║  type glyph if no doc    ║  │    OR exec_summary text preview
│  ╚══════════════════════════╝  │
│                           [✉] │  ← format badge, top-right inside thumbnail
├────────────────────────────────┤
│  Listing Spotlight — May 2026  │  ← title, white/85, text-sm font-medium
│  Jun 24 · data: Apr 2026       │  ← date, white/35, text-[10px]
│                                │
│  ● sent          [Edit] [↻]    │  ← status chip + action buttons
└────────────────────────────────┘
```

**Card tokens:**
- Base: `bg-[#0d1e2b]/80 border border-white/8 rounded-xl overflow-hidden`
- Hover: `ring-1 ring-[#1BB8C9]/40 bg-[#0d1e2b] cursor-pointer`
- Selected/active: `ring-2 ring-[#1BB8C9]`
- Transition: `transition-all duration-150`

**Click behavior:** opens the material full-screen (email lab for block-canvas, deliverable view for others).

**Action buttons** (revealed on hover, `opacity-0 group-hover:opacity-100`):
- `[Edit]` — navigates to the editor for this material
- `[↻]` — triggers Update Data (see §7)
- `[⋯]` — three-dot: Convert to PDF, Schedule send, Duplicate, Delete

---

## 5. Format Badges

Small `rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide` chips, rendered inside the thumbnail top-right corner.

| Template | Label | Text | Background |
|----------|-------|------|------------|
| `block-canvas` | `email` | `#1BB8C9` | `bg-[#1BB8C9]/15` |
| `client-email` | `email` | `#1BB8C9` | `bg-[#1BB8C9]/15` |
| `one-pager` | `one-pager` | `#8b5cf6` | `bg-[#8b5cf6]/15` |
| `market-overview` | `overview` | `#f97316` | `bg-[#f97316]/15` |
| `email` (digest) | `digest` | `#f97316` | `bg-[#f97316]/15` |
| `bov-lite` | `BOV` | `#f43f5e` | `bg-[#f43f5e]/15` |

---

## 6. Status Chips

`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]` with a colored 6px dot.

| State | Dot | Text color | Trigger |
|-------|-----|-----------|---------|
| `draft` | `bg-white/20` | `text-white/40` | saved, never sent |
| `scheduled` | `bg-[#4f46e5]` | `text-[#818cf8]` | active `email_schedules` row |
| `sent` | `bg-[#10b981]` | `text-[#34d399]` | `send_status = "sent"` log |
| `needs refresh` | `bg-[#f59e0b]` | `text-[#fbbf24]` | `data_as_of` > 30 days ago |
| `archived` | `bg-white/10` | `text-white/20` | `deleted_at` non-null |

"Needs refresh" takes precedence over "sent" if both conditions are true.

---

## 7. Update Data

Click `↻` on any card:

1. Button shows spinner, card shows subtle pulse ring
2. For `block-canvas`: POST `/api/email-lab/ai` with `{ doc: savedDoc, scope, mode: "refresh" }` — AI patches numbers and text only, never layout or colors
3. For report templates: POST `/api/deliverables/refresh` — re-runs the brain fetch + narrative, pins items_snapshot
4. Saves new deliverable row (`supersedes_id` → prior row id)
5. Card updates: `data: Jun 24 2026`, status resets to `draft` (unsent new version)

**Rule: no auto-update. Ever.** The only automatic data refresh is the nightly sweep before a scheduled send fires (Phase 7). Button = intentional human action.

---

## 8. Filing Sidebar

Slides in from the right. Triggered by: post-build AI suggestion "Yes", or `[⋯] → File to project` on any card.

```
┌─────────────────────────────────┐
│  File to project           [✕]  │
│  ┌───────────────────────────┐  │
│  │ 🔍 Search address…        │  │
│  └───────────────────────────┘  │
│                                 │
│  AI MATCH                       │
│  ▌ 123 Main St (this project)   │  ← teal left-border stripe
│                                 │
│  YOUR PROJECTS                  │
│  ○ 456 Coral Ave                │
│  ○ 789 Gulf Shore Dr            │
│  ○ Riverside Portfolio (4)      │
│                                 │
│  + Create new project           │
└─────────────────────────────────┘
```

**Sidebar tokens:**
- Width: `w-72`
- Background: `bg-[#0d1920] border-l border-white/8`
- Backdrop: `bg-black/40` behind it, click to dismiss
- AI match row: `border-l-2 border-[#1BB8C9] bg-[#1BB8C9]/5 pl-3`

**AI match logic:** extract `scope_kind + scope_value` from the material being filed. Query `projects` for rows where `items` contains a metric with matching ZIP or address string. Fuzzy fallback: if no exact match, surface top 3 projects by recency.

**Multi-address future guard:** filing sidebar always operates on ONE material at a time. Multi-address campaigns are a platform-level construct outside project scope — they never appear in the filing UI.

---

## 9. AI Suggestion Banner

Shown immediately after any build completes (deliverable OR email), IF the material's scope matches ≥1 existing project. Dismissed on "Yes", "Skip", or 15s timeout.

```
bg-[#1BB8C9]/8  border border-[#1BB8C9]/20  rounded-lg px-4 py-2.5  text-sm
```

```
◈  Looks like a [scope label] — file it here?    [Yes]  [Skip]
```

- `◈` glyph in `text-[#1BB8C9]`
- "Yes" → opens filing sidebar pre-seeded with the matched project highlighted
- "Skip" → banner disappears, material stays unfiled (can file later via `[⋯]`)
- Scope label: "a 33931 listing" / "a Fort Myers Beach property" / "a Lee County overview"

---

## 10. New Material Flow

`[+ New Material ▼]` opens a picker popover:

```
┌──────────────────────┐
│  ✉  Email            │  → /project/[id]/email-lab  (block-canvas)
│  □  One-pager        │  → deliverable builder, template "one-pager"
│  📊  Market overview  │  → deliverable builder, template "market-overview"
│  ─────────────────── │
│  ✦  AI, surprise me  │  → AI picks format + pre-fills + saves
└──────────────────────┘
```

**"AI, surprise me":** POST `/api/project/[id]/ai-material` with `{ scope }` → model picks the most appropriate format given the project's scope and existing materials (avoids duplicating the same format twice in one session) → generates content → saves as `deliverables` row → card appears in grid immediately.

---

## 11. Phase 7 — Recurring Re-fill + Send

Plugs into the existing `email_schedules` + `run-schedules.mts` infrastructure. New template lane: `template_id: "block-canvas"`.

**Scheduler lane logic** (new branch in `run-schedules.mts → buildContent`):

```
if template_id === "block-canvas":
  1. Load project's most recent block-canvas deliverable for this project_id
     (SELECT * FROM deliverables WHERE project_id = ? AND template = 'block-canvas'
      AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1)
  2. If none → fall back to global digest (existing behavior)
  3. POST /api/email-lab/ai with { doc: row.doc, scope, mode: "refresh" }
  4. Validate response with EmailDocSchema
  5. POST /api/email-lab/render → { html }
  6. Return { subject: firstBlockHeading(doc) ?? scope label fallback, body: "", html }
     — firstBlockHeading: find first block where type === "header" | "hero", return props.tagline ?? props.label ?? scope label
```

**Nightly sweep** = run-schedules.mts fires on schedule. For block-canvas rows, this is the ONLY moment data auto-updates. The saved `deliverable.doc` is the layout template; the AI patches fresh numbers for this specific send, never writes back to the saved row (sends are ephemeral; the saved design stays frozen).

**GHA workflow:** `email-scheduler.yml` already exists (currently paused). The block-canvas lane slots in without a new workflow file. `DRY_RUN=true` logs the patched doc + rendered HTML to stdout without sending.

---

## 12. Data Model Changes

### `deliverables` table
```sql
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS doc JSONB;
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS data_as_of TIMESTAMPTZ;
```
- `doc` non-null only for `template = 'block-canvas'`; contains full `EmailDoc` shape (validated by `EmailDocSchema` on write)
- `data_as_of` set on every create/update to the lake's `freshness_token` date; drives the "needs refresh" chip and the "data: Apr 2026" label on cards
- All existing columns unchanged

### No new tables required

`email_schedules` already has `project_id`, `template_id`, `scope_kind`, `scope_value`. The new scheduler lane reads `project_id` to look up the saved design.

---

## 13. API Changes

### New routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/project/[id]/materials` | GET | List all deliverables for project (includes block-canvas) |
| `/api/project/[id]/materials` | POST | Save a new block-canvas material |
| `/api/project/[id]/materials/[did]/refresh` | POST | Trigger Update Data for one material |
| `/api/project/[id]/ai-material` | POST | "AI, surprise me" — generate + save |
| `/api/project/[id]/file-suggest` | GET | Return AI-matched project(s) for a material's scope |

### Modified routes
- `/api/email-lab/ai` — add `mode: "refresh"` param: patch text/numbers only, never add/remove/reorder blocks
- `/api/email-lab/render` — unchanged (already accepts `{ doc }`)

---

## 14. Component Changes

### Modified
- `app/project/[id]/ProjectWorkspace.tsx` — add Materials grid above ItemsBoard; add AI suggestion banner; add filing sidebar
- `app/project/[id]/workspace/DeliverableLanes.tsx` — the "Built" deliverable lane is replaced by `MaterialsGrid`; the `EmailScheduleCard` list is kept intact as a collapsible "Scheduled sends" section below the materials grid (above ItemsBoard), so active schedules remain visible without being buried

### New
- `components/project/MaterialsGrid.tsx` — grid/list toggle, New Material button, filtering
- `components/project/MaterialCard.tsx` — card with thumbnail, format badge, status chip, hover actions
- `components/project/MaterialThumbnail.tsx` — renders mini iframe for block-canvas OR text preview for report types
- `components/project/FilingSidebar.tsx` — slide-over panel with search + project list
- `components/project/AiSuggestionBanner.tsx` — dismissable post-build suggestion
- `components/project/NewMaterialPicker.tsx` — popover with format options + "AI, surprise me"

---

## 15. Acceptance Criteria

### Phase 6 (save/load + materials grid)
- [ ] Block-canvas email saved to `deliverables` with `template = 'block-canvas'`, `doc = EmailDoc JSON`
- [ ] Materials grid renders in project workspace above ItemsBoard
- [ ] Cards show: format badge (correct color), status chip, date, "data as of" date
- [ ] Click card → opens email lab with saved doc loaded; click report card → opens deliverable view
- [ ] "Update Data" patches content only, saves new version, old version accessible via version history
- [ ] "Needs refresh" state fires correctly when data_as_of > 30 days
- [ ] Filing sidebar opens, AI match highlights correct project, "Yes" files the material
- [ ] AI suggestion banner appears after build if scope matches a project, dismisses on Yes/Skip/timeout
- [ ] "New Material" picker opens; Email navigates to email lab; "AI, surprise me" generates + saves
- [ ] Filed data (ItemsBoard) renders below, collapses when ≥3 materials exist
- [ ] `bunx next build` clean; no TS errors

### Phase 7 (recurring re-fill + send)
- [ ] `email_schedules` row with `template_id = 'block-canvas'` and `project_id` set fires scheduler lane
- [ ] Scheduler loads saved doc, AI-patches with fresh scope data, renders HTML, sends via existing broadcast
- [ ] `DRY_RUN=true` logs patched doc + HTML, does NOT send, does NOT mutate saved deliverable row
- [ ] Saved deliverable row is NOT overwritten by scheduled sends (sends are ephemeral)
- [ ] GHA `email-scheduler.yml` picks up block-canvas rows with zero new workflow config

---

## 16. Out of Scope

- Multi-address campaign emails (platform-level, not project-level)
- Sub-folders within a project
- Collaborative editing (single-user editing at a time per the Task 50 spec)
- Deliverable → PDF export pipeline changes (exists already via `/api/deliverables/[id]`)
- Audience management (existing email_audiences table, unchanged)
