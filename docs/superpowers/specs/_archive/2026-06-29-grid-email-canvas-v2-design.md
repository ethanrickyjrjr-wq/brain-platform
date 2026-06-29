# Grid Email Canvas v2 — persistence, friction features, AI sections

**Date:** 2026-06-29
**Status:** Design — awaiting review before writing-plans
**Check:** `grid_email_canvas_v2_live_verify`
**Supersedes:** the two draft plans `docs/superpowers/plans/2026-06-29-grid-email-file-persistence.md` and `docs/superpowers/plans/2026-06-29-grid-email-canvas-ux.md` (both kept their good bones; this corrects a DB blocker and cuts two low-value features + a misframed one).

---

## Problem

The paid grid email lab (`/email-lab/grid`, `EmailLabGridShell`) is the north-star surface, but today it:

1. **Loses work on tab close** — no autosave, no draft.
2. **Can't save or reload a named design** — every session starts from a seed.
3. **Has avoidable canvas friction** — content gets clipped by a fixed cell height, you can't drop an image from the desktop, and editing text means round-tripping through the right-panel inspector.

Two draft plans were written for this, but in-session probes + crawl4ai research found defects that must be corrected before any code:

- A **hard DB blocker**: the persistence plan saves designs with `project_id: null`, but `deliverables.project_id` is `string` **NOT NULL** (typed Insert + DB constraint) — it won't compile and won't insert.
- Two **low-value features** for this audience/medium: snap guides and a drag-to-reorder layers panel.
- A **misframed feature**: manual "grouping," which helps neither this end user nor the AI.

## Goal

Make the paid grid lab feel like a modern, trustworthy builder — **never lose work, save/reload designs, edit by clicking** — and put the real leverage where it compounds: **give the AI author engine a richer section vocabulary so it produces better layouts and we can ship better examples.** Cut anything that doesn't earn its place for the end user (real-estate agents, not designers) or for the AI.

---

## Evidence base (gathered in-session, 2026-06-29)

**crawl4ai** (per RULE 0.4): react-grid-layout v2 README, dnd-kit sortable docs, and Graphite (`GraphiteEditor/Graphite`) README + user manual. The NN/g autosave + inline-editing URLs 404'd (hallucinated links) — so the UX keep/cut calls below are reasoned from the **code reality + medium constraints**, not an external UX citation. The vendor-contract research did land and is reflected below.

**Code probes** (per RULE 0.5): `EmailLabGridShell.tsx`, `GridCanvas.tsx`, `EmailLabGridClient.tsx`, `lib/email/doc/{types,schema,default-docs}.ts`, `lib/email/grid-schema.ts`, the typed Supabase clients, the generated `deliverables` types, the installed RGL/dnd-kit type surfaces, and the AI author engine (`lib/email/author-doc.ts`, `app/api/email-lab/ai/route.ts`).

**Decisive findings:**

| Finding | Source | Consequence |
|---|---|---|
| `deliverables.project_id` is `string` NOT NULL (no `\| null` in Row or Insert) | `database-generated.types.ts` | Standalone designs can't be saved as-is → **migrate to nullable** (see A1) |
| The email renderer orders blocks by `y`→`x`→array-index-tiebreak | `compile-grid.ts:106` (`groupRows`) | Reordering `doc.blocks` is a **no-op** in canvas *and* email → **cut layers drag-reorder** |
| RGL v2 already snaps every block to integer 12-col cells; `dragConfig`/`gridConfig` API is live | `GridCanvas.tsx:31–36,181–189`; RGL v2 README | ±0 snap guides mostly confirm what the grid already forces → **cut snap guides** |
| The AI author engine **does not emit x/y/w/h** — the model emits `span` + `new_row`; code derives bounds-correct `{x,y,w,h}` | `author-doc.ts:22,81–85,366–422` | Spatial grouping gives the AI nothing; the lever for "better examples" is **semantic sections + a template library** (see WS-C) |
| RGL v2 `EventCallback` = `(layout, oldItem, newItem, placeholder, event, element)`; `LayoutItem` (single) and `Layout` (array) both exported | installed `react-grid-layout/dist/*.d.ts` | Any future drag wiring is type-correct as the drafts assumed; **do not** add `@types/react-grid-layout` (v2 bundles its own) |
| `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2 all installed | `package.json` | dnd-kit is available **if** we ever do reorder — but selection-only layers (B4) needs none of it |
| Paid AI = `ai: "build+fill"` is already a PAID-ONLY capability | `lib/email/lab/capabilities.ts:67` | WS-C extends an existing paid capability — **no new tier flag needed** |

---

## Scope decisions

**IN (this spec):**
- WS-A: Design persistence — nullable-`project_id` migration, designs API, localStorage auto-draft, a **left rail** "My Designs" picker.
- WS-B: Canvas friction features — resize-to-fit, image drag-drop, inline double-click editing, a **selection-only** layers list (shares the left rail).
- WS-C: AI section lever — a richer **section-template library** (concrete) + an optional **semantic `section`** concept for the author engine (Phase 2, own design pass).

**CUT (with evidence):**
- **Snap guides** — RGL already snaps to integer cells; ±0 guides are confirmation, not assistance. Independent of image text-overlay (that's `ImageProps.overlayTitle/overlayBody`, already shipped), so cutting costs nothing there.
- **Layers drag-to-reorder** — `compile-grid.ts:106` proves array order doesn't affect canvas or email. A reorder control would be a no-op.
- **Manual grouping (light `groupId` or Graphite-style nested groups)** — low value for a non-designer building a ~5–15-block linear email; the genuine "these belong together" cases are already single blocks (`image` + overlay) or the `multi-column` row. And it gives the AI nothing, because the AI authors structure (`span`/`new_row`) rather than moving clusters. Reserved as a possible future "pro" marquee feature; **not** a v1 gate. If a real "combine two" need surfaces, the email-native answer is a "make these a side-by-side row" action over the existing `multi-column`/row machinery — not a transform-group.

---

## Tier contract (read first — `lib/email/CLAUDE.md`)

The free/paid line lives **only** in `lib/email/lab/capabilities.ts`. Everything in this spec lands on the **already-paid** grid shell (`EmailLabGridShell`, the entire `/email-lab/grid` route), so these are additive paid-surface features, **not** free/paid toggles of a shared panel — they do **not** each need a capability flag. WS-C extends the existing paid `ai: "build+fill"` capability. No change to `capabilities.ts` or its contract test is required by this spec. (If any feature later becomes a shared-panel toggle, declare it there per the contract.)

---

## Workstream A — Design persistence

### A1 — Migration: `deliverables.project_id` → nullable

The chosen storage model: a standalone design **is** a `deliverables` row (so it rides the same send/paywall pipeline — `send` is the paywall), distinguished by `project_id IS NULL` + `template = 'block-canvas'`. Two facts verified this session make this clean (and rule out the per-user-sentinel-project alternative):

- **Send works project-lessly.** `openSend` (shell:582) only needs a deliverable id back from `onSave`; contacts are user-scoped, not project-scoped. So a null-`project_id` design can be saved and **sent**. Only **Schedule** is project-gated (the button at shell:721 and the modal at shell:1105 require `projectId`) — acceptable, since scheduling is inherently project-scoped. Designs are not stranded from the paywall. (Confirm the server send endpoint also accepts a null-project deliverable during A2 — the client flow indicates it will.)
- **No RLS surgery.** `deliverables` SELECT is `USING (true)` — public select (`docs/sql/20260613_deliverables.sql:37`). Ownership is enforced in **app code** via `.eq("user_id", user.id)`, not a project-join. A null-`project_id` row is therefore fully readable by its owner's filtered query, and **no new SELECT policy is required**. This is precisely why nullable `project_id` is the right call here — the project-join blast radius doesn't exist on this table.

Steps:
- SQL migration (idempotent; run via `Bun.SQL`, creds in `.dlt/secrets.toml`, `sslmode=require` — psql is not installed): `ALTER TABLE deliverables ALTER COLUMN project_id DROP NOT NULL;`. Verify the column is nullable afterward.
- `bun run gen:types` to regenerate `database-generated.types.ts` (so the typed Insert accepts `project_id: null`).
- **Reduced blast-radius audit:** since RLS isn't project-based, the only risk is *code* that assumes `project_id` is non-null (joins, `!`-assertions, `.project_id` deref). Grep `deliverables` consumers for that before relying on the column; record findings in the implementation plan.

**Naming column:** the design name is stored in `instruction`. Note this **overloads** the column (on a normal deliverable `instruction` holds the AI prompt). Acceptable for v1; if it gets confusing, add a dedicated `name`/`title` column later rather than fight the overload.

### A2 — Designs API

Two routes, `runtime = "nodejs"`, mirroring the **verified** existing INSERT shape at `app/api/projects/[id]/materials/route.ts:53–64`:

- `GET /api/email-lab/designs` → `{ designs: { id, name, created_at }[] }` — cookie client, `.eq("user_id", user.id).eq("template","block-canvas").is("project_id", null).is("deleted_at", null)`, newest first, limit 50.
- `POST /api/email-lab/designs` `{ doc, name? }` → `{ id }` (201) — validate `EmailDocSchema.safeParse(doc)` (400 on fail); insert via **service-role** client (no owner INSERT policy on `deliverables`) with the full required column set: `id` (`crypto.randomUUID()`), `user_id`, `project_id: null`, `template: "block-canvas"`, `doc`, `instruction` (= trimmed name ≤100, default `"Untitled Email"`), `data_as_of`, `narrative: { exec_summary:"", sections:[], inference_notes:[] }`, `items_snapshot: []`, `status: "ready"`. (`narrative` + `items_snapshot` are NOT-NULL-no-default — must be supplied.)
- `GET /api/email-lab/designs/[id]` → `{ id, name, doc, created_at }` — 401/404/403 (ownership by `user_id`).
- `PATCH /api/email-lab/designs/[id]` `{ doc }` → `{ ok:true }` — ownership check, then service-role `update({ doc })`.

**Ownership model (consistent across all four):** `deliverables` SELECT is public (`USING (true)`), so RLS is not the gate — the explicit `.eq("user_id", user.id)` (collection) and `data.user_id !== user.id → 403` (single) checks **are** the ownership enforcement. Reads may use the cookie client; writes must use the service-role client (no owner INSERT/UPDATE policy on `deliverables`).

Full `bun:test` coverage for both routes (auth, validation, ownership, the insert shape) following the drafts' test scaffolds — corrected so `project_id: null` is now valid.

### A3 — localStorage auto-draft

On `EmailLabGridShell`, behind a new optional `draftKey?: string` prop (absent → no drafting; the project-scoped shell already persists via `onSave`):

- 3-second debounced write of `{ doc, savedAt }` to `localStorage[draftKey]` on `doc` change (quota errors swallowed).
- On mount (once, guarded by a ref against StrictMode double-fire): if a draft exists, is `<7` days old, and `EmailDocSchema.safeParse`s, restore it into history and show a `sonner` toast with a **Discard** action. Skip restore when a design is being loaded via `?did=` (don't clobber an explicit load).
- Clear the draft after a successful explicit save (note: `onSave` is also invoked by Send/Schedule, so a sent/scheduled design clears its draft too — acceptable).

### A4 — Left rail: "My Designs"

The shell is currently two panes (`<main>` canvas + right `<aside>` AI). Add a **new collapsible left rail** (the conventional home for a designs list — Canva/Figma both put it left). It hosts:

- "New design" + a lazy-loaded list from `GET /designs`; click a row → fetch `GET /designs/[id]`, `safeParse`, `applyBrand`, `commit()` onto the canvas; `?did=` URL sync so refresh reloads the same design.
- First-save gate: `EmailLabGridClient` passes `onSave` + `draftKey="email-grid-draft"`; first save opens a `SaveDesignModal` (name input) → `POST /designs`; subsequent saves `PATCH /designs/[id]`.
- Rename/delete are fast-follows (not v1-blocking).
- The B4 layers list lives in this same rail (see WS-B).

---

## Workstream B — Canvas friction features

All new `GridCanvas` props are **optional** (no existing caller breaks). All edits stay in `GridCanvas.tsx` + `EmailLabGridShell.tsx` plus two small new components.

### B1 — Resize-to-fit content
Extract the inline per-block JSX into a local `GridBlock` component (so each block owns a `useLayoutEffect` + `ResizeObserver`). When measured `scrollHeight > offsetHeight`, show a "↕ Fit" control in the action pill; clicking calls `onFitBlock(id, ceil(scrollHeight / GRID_ROW_HEIGHT) + 1)`, and the shell commits the new `layout.h`. **Pass the real `doc.globalStyle`** to `BlockRenderer` (not `{} as never`). Keep `useMemo` in the React import (still used by `buildLayout`).

### B2 — Image drag-drop from filesystem
`onDragOver`/`onDragLeave`/`onDrop` on the canvas outer `<div>` with a teal drop-zone highlight; on drop of an image file, call `onImageDrop(file)` → the shell's existing `uploadNewPhoto(file)` (no shell changes beyond wiring).

### B3 — Inline double-click text editing
New `InlineTextEditor` (a `position:fixed` textarea positioned from the block's `getBoundingClientRect()`). Double-click an inline-editable block opens it pre-filled; Enter (no shift) commits, Escape/blur-to-commit closes; `onInlineEdit(id, field, value)` patches `block.props[field]` via `commit()`.

**v1 inline-editable set (verified against `types.ts:75–111`): `text → body` and `signal → title` only.** These are the only block types with a single, unambiguous, AI-writable text field. The draft's `content`/`headline`/`label` were wrong; my own first pass (`header → companyName`, `hero → value`) was also wrong — `companyName` is a user-owned field (not in the AI-writable set at `types.ts:73`), and `header`/`hero` are multi-field blocks (`companyName`/`tagline`; `kicker`/`value`/`label`/`prose`) with no single obvious double-click target. So **header/hero stay inspector-only** in v1. (A later pass could add per-field inline edit, but that's not v1.) All inline-edit targets must be AI-writable content fields per `types.ts:73`.

### B4 — Layers panel (selection-only)
A list in the left rail: every block as a row (type icon + label), click to select/locate it on the canvas (solves the real friction of stacked/hard-to-click blocks). Multi-select (shift-click) is optional polish. **No drag-reorder, no grouping, no dnd-kit** — those were cut. Pure selection + navigation.

---

## Workstream C — AI section lever ("better examples for the AI")

The author engine already insulates the model from coordinate math: it emits `span` + `new_row` and code derives the grid (`author-doc.ts:22`). So the way to make the AI produce better layouts is a **richer compositional vocabulary**, not spatial tools.

### C1 — Section-template library (concrete, buildable)
Expand the `seedBlockGrid` template set (`lib/email/doc/default-docs.ts`, ~24 today) with high-quality, **section-sized, reusable** patterns — e.g. a 3-stat band, an agent-bio row (photo + bio + CTA), a listing trio, a "by-the-numbers" market block, a CTA banner. These raise the floor of both the example gallery and what the author engine can assemble. **Zero schema change.** Each new template must register any new vocabulary it emits per the pack/vocab gate. This is the single biggest quality multiplier and can proceed in parallel with WS-A/B.

### C2 — Semantic `section` concept (Phase 2 — needs its own design pass)
Optionally let the author engine emit a labeled **section** (a named group of rows: intro / stats / listings / CTA) that the model plans at, and that code lays out — additive to the existing `new_row` model, role-based not spatial, no nesting, no renderer rewrite (sections flatten to the flat array the renderer already consumes — the one idea worth borrowing from Graphite: *a group is a transform-owner that flattens at output*). This is **not** fully designed; it gets its own brief before any code. Listed here so it isn't lost.

---

## Vendor-contract notes (verified, for the implementer)

- **react-grid-layout 2.2.3** is a TS rewrite: `<ReactGridLayout layout width gridConfig={{cols,rowHeight,margin}} dragConfig resizeConfig compactor onLayoutChange/>` — no `WidthProvider`/`isDraggable`/`data-grid`. The live `GridCanvas` already uses this correctly. `EventCallback = (layout, oldItem, newItem, placeholder, event, element)`; `LayoutItem` = single item, `Layout` = array. Do **not** install `@types/react-grid-layout`.
- **deliverables INSERT** must include the NOT-NULL-no-default columns `id, user_id, project_id (now nullable), template, narrative, items_snapshot`. Mirror `app/api/projects/[id]/materials/route.ts:53–64`.
- **dnd-kit** is installed (core/sortable/utilities) but **not used** by this spec (B4 is selection-only).

## Testing

- `bun:test` for both designs routes (auth/validation/ownership/insert-shape).
- Pure-logic unit test for the resize-to-fit `newH` computation.
- `bunx next build` clean (TS) after each workstream (per the verify-with-next-build rule).
- Manual live-verify at `/email-lab/grid` closes `grid_email_canvas_v2_live_verify`: autosave+restore, save→reload from the left rail, resize-fit, image drop, inline edit, layers-select.

## Risks / open questions

1. **Migration blast radius (A1)** — *resolved low* per the verified findings: `deliverables` RLS is public-select (no project-join), so the audit reduces to code that assumes `project_id` is non-null; send works project-lessly, schedule stays project-gated. Still grep `deliverables` consumers before relying on the nullable column. One residual: confirm the **server** send endpoint accepts a null-project deliverable during A2.
2. **Inline-edit field names (B3)** — must be read from `BlockPropsMap`, not assumed.
3. **C2 is under-designed** — do not build the semantic `section` concept from this spec; it needs its own brief.
4. **Left-rail density** — the shell gains a third pane; confirm the layout stays usable at the paid grid's target widths (`h-full`/`dvh`, never `h-screen`).
5. **Parallel-session collision on `EmailLabGridShell.tsx`** — a concurrent session is mid-refactor extracting both shells' **right-panel** sections into a stateless shared `EmailLabPanel` (`components/email-lab/panel/`, `lib/email/lab/`) driven by `capabilities` (spec: `docs/superpowers/specs/2026-06-29-email-lab-shared-panel-design.md`). That work is **substantively orthogonal** to this spec — it touches the right panel; we touch the canvas, the author engine, autosave on the shell's `doc`, and a new **left** rail. But both edit `EmailLabGridShell.tsx`. **Coordinate:** land the shared-panel refactor first (it keeps the shell as the stateful container, so our `draftKey` prop, autosave effects, left rail, and new `GridCanvas` props all remain valid against the refactored shell), or do this work in an isolated worktree (`scripts/worktree.mjs`) and rebase. Do **not** start WS-A4/WS-B against `EmailLabGridShell.tsx` while their refactor is uncommitted.

## Build order (suggested for writing-plans)

WS-A (A1 → A2 → A3 → A4) and WS-B are largely independent and can interleave; **A1 gates A2**. WS-C/C1 (templates) runs in parallel as content work. WS-C/C2 is deferred pending its own design.
