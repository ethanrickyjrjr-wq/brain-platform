# 04 — PIECE 4: Editing + Live Refresh + Trash  ✅ BUILT (HELD for push, 2026-06-17)

> The RESOLVED PLAN below was the build contract — it is the approved design (no separate
> brainstorm needed; operator decree). Build shipped 2026-06-17; status lives in
> SESSION_LOG + the `checks` ledger (`piece4_edit_refresh_trash_verify`), not here.

## Intent

Make deliverables **live and mutable**. Open a thumbnail → **current data** (not the frozen snapshot). Change a past
deliverable — a section, a color, add/delete a piece, or rebuild it new. And **deleted work is saved for a few days**
somewhere recoverable. This is what turns the cockpit from "see what you built" into "keep working on it."

## Contract

**Depends on (from P1):** `components/ui/Modal.tsx` · `DeliverableModal`/`DeliverableThumbnail`/`DeliverableLanes` ·
`ProjectWorkspace` mount points. **Depends on (existing):** the deliverable build pipeline
(`lib/deliverable/assemble.ts`, `build.ts`, `schedule-recipe.ts`).
**Provides:** rebuild-with-fresh-data (the Emailing lane's live "this week's email" preview becomes real) · deliverable
editing/versioning · soft-delete trash + retention.

## Scope (proposed)

1. **Open-to-current (live refresh).** In `DeliverableModal`, offer "refresh with current data": re-run
   `assembleDeliverable` for that template+items against today's lake, render the result (don't silently overwrite the
   shareable `/p/[id]` — decide: in-place update vs. new version). Frozen `/p/[id]` link semantics must stay intact for
   already-shared links.
2. **Edit a past deliverable.** Change a section / branding color / add or remove an item / regenerate one section.
   Likely a guided edit (adjust items + instruction → rebuild) rather than free-form prose editing, to keep the
   no-invention guarantees (`spec-validator`, lints). Brainstorm the exact edit surface.
3. **Trash / retention.** Soft-delete: `deliverables.deleted_at` (+ a daily sweep that hard-deletes after N days) **or**
   a `trash` table. Same pattern could cover deleted project items. "A few days" = pick the window at brainstorm.

## Reuse / what exists

`lib/deliverable/assemble.ts` (freeze → narrative → insert) · `build.ts` (`gateNarrative`, lints, TTL gate) ·
`schedule-recipe.ts` (`deliverableToScheduleRecipe`) · `app/api/projects/[id]/build/route.ts` · `app/p/[id]/page.tsx`
(`force-dynamic`; re-signs file URLs each view — the place live re-fetch would slot in) · `deliverables.status`
(ready/building/revoked — extend rather than reinvent) · `/api/deliverables/[id]/revoke`.

## Critical guardrails (do not break)

- **No-invention is structural.** Any rebuild/edit must pass `spec-validator` + `facts-only-lint` +
  `inference-bait-lint` + `smoothing-lint` (Brain Factory rule 7). Editing must not become a hole that lets unsourced
  prose in.
- **Frozen-link integrity.** A shared `/p/[id]` is a capability link people already have. Decide explicitly whether
  refresh mutates it or forks a new id; don't surprise an external viewer.
- **Monetization model.** Builds are free forever; **send** is the paywall (memory: `build-monetization-model`). Editing
  is part of build (free); don't gate it.

## Open decisions for brainstorm
- Refresh = mutate `/p/[id]` in place vs. new version id? (Link integrity vs. simplicity.)
- Edit surface: guided (items+instruction→rebuild) vs. section-level regen vs. both.
- Trash: `deleted_at` column vs. `trash` table; retention window; does it cover project items too?
- Emailing-lane "this week's email" preview: render via `lib/email/grounded-report.ts` (sends already pull fresh) — reuse that path for the modal. **May already ship in P1** (see `01-…` §D/decision 5); P4 owns the heavier **Built-lane** open-to-current rebuild.

## Likely key files
`app/project/[id]/workspace/DeliverableModal.tsx` (P1) · `lib/deliverable/assemble.ts` · `lib/deliverable/build.ts` ·
`app/api/projects/[id]/build/route.ts` (+ maybe a new edit/refresh route) · `app/p/[id]/page.tsx` ·
`lib/email/grounded-report.ts` · new `docs/sql/<date>_deliverables_soft_delete.sql`.

---

# RESOLVED PLAN (brainstorm output — 2026-06-17)

> The draft above is the scope. Below is the decided plan — the open questions resolved, the implementation
> spelled out, and the end-user bar set. Build happens **after Piece 1** ships the modal/lanes seams; this plans
> the one piece, it does not build everything.

## Context (why)

Today a deliverable is a **frozen snapshot** — once built it never changes, you can't edit it, and deleting it
is permanent. For the broker that means a report goes stale the moment the data moves, a typo or wrong color is
a full rebuild, and a fat-finger delete is gone forever. Piece 4 makes deliverables **live and mutable**: open
one and refresh it to *current* data, edit it (swap a chart, add a metric, fix a color, rebuild a section), and
recover anything deleted in the last few days — without breaking the no-invention guarantee and without
surprising anyone holding a shared `/p/[id]` link.

## Decisions (the open questions above — now resolved)

1. **Refresh/edit forks a NEW version; the old `/p/[id]` stays frozen.** A shared `/p/[id]` is a capability link
   people may already hold — silently mutating it surprises an external viewer. So "refresh with current data"
   and content edits **build a new deliverable id** (a fresh snapshot at today's data) and lineage-link it via a
   new `supersedes_id` column. The old link keeps working, frozen, forever. The Built lane shows the newest by
   default; older versions collapse under a "versions" affordance.
   - **Carve-out:** purely **cosmetic** changes (branding color / logo) update **in place** — facts are
     unchanged, it's presentation only, so no new version and no narrative regen.
2. **Edit = guided rebuild through the existing gated pipeline — never free-text.** The broker adjusts *inputs*
   (add/remove an item, change template, change a branding color, an optional one-line steer) and the narrative
   is regenerated through the **same** `assembleDeliverable → gateNarrative → 4 lints` path that originally built
   it. **No free-form editing of generated prose** — that would be exactly the hole that lets unsourced claims
   in. Section-level "regenerate just this section" is a v2 nicety; v1 is whole-deliverable guided rebuild.
3. **Trash = a `deleted_at` column + a 7-day daily sweep.** Soft-delete sets `deliverables.deleted_at`; a daily
   cron hard-deletes rows where `deleted_at < now() - 7 days` (guarded: only ever touches rows where
   `deleted_at IS NOT NULL`). Restore clears `deleted_at`. The Built lane gets a "Recently deleted" affordance
   with Restore. **v1 scope = deliverables only** (project items live in `projects.items` jsonb, not rows — a
   soft-delete inside the bag is a separate v2). Extends `deliverables.status`/`revoke` rather than a new table.
4. **Emailing-lane "this week's email" is inherently live** (renders via `lib/email/grounded-report.ts`, which
   already pulls fresh on every send). That preview may already ship in **P1**; Piece 4 owns the heavier
   **Built-lane** open-to-current rebuild.

## What already exists (reuse — confirmed in code)

- `lib/deliverable/assemble.ts` → `assembleDeliverable({db, projectId, ownerId, items, branding, template, instruction, scope_kind?, scope_value?})` — the build engine; supports every template + scope.
- `lib/deliverable/build.ts` → `buildDeliverableNarrative` + `gateNarrative` (runs `facts-only-lint` + `inference-bait-lint` + `smoothing-lint`, hard-strips offending sentences; TTL gate flag-gated).
- `app/p/[id]/page.tsx` — `force-dynamic`, re-signs file URLs on every view (the natural slot for live re-fetch).
- `app/p/[id]/print/route.ts` — PDF via `window.print()` (works on any version's id; no change needed).
- `app/api/deliverables/[id]/revoke/route.ts` + `deliverables.status` (`ready|building|revoked`) — mirror for trash.
- `deliverables` table: `id, project_id, user_id, template, instruction, narrative, items_snapshot, branding, status, created_at, scope_kind, scope_value` — **no `deleted_at`, no version lineage today** (both net-new below).

## Depends on (from Piece 1 — build P4 code after these land)

`components/ui/Modal.tsx` · `DeliverableModal` / `DeliverableThumbnail` / `DeliverableLanes` · `ProjectWorkspace`
mount points. Piece 4 plugs edit/refresh/trash controls into the P1 modal; it does not re-architect the lanes.

## Implementation

### 1. Migration (additive, idempotent — run directly per RULE 1)
```sql
-- docs/sql/<date>_deliverables_soft_delete.sql
ALTER TABLE public.deliverables
  ADD COLUMN IF NOT EXISTS deleted_at    timestamptz,
  ADD COLUMN IF NOT EXISTS supersedes_id text;            -- lineage: this version replaced that id
CREATE INDEX IF NOT EXISTS deliverables_deleted_at_idx ON public.deliverables (deleted_at)
  WHERE deleted_at IS NOT NULL;
NOTIFY pgrst, 'reload schema';
```

### 2. Routes (all free — editing is part of build; send stays the only paywall)
- `POST /api/deliverables/[id]/refresh` — load the source row's `template/items_snapshot/branding/scope_*`,
  re-run `assembleDeliverable` against today's lake, insert a **new** row with `supersedes_id = [id]`, return
  the new slug. Old `[id]` untouched.
- `POST /api/deliverables/[id]/edit` — body `{items?, template?, branding?, instruction?}`. **Only** branding
  changed → PATCH `branding` on the same row, re-render in place (no LLM, no new id). Otherwise → new row,
  `supersedes_id = [id]`. (May reuse `app/api/projects/[id]/build/route.ts` with a `from_deliverable_id`
  param instead of a separate route — same logic.)
- `POST /api/deliverables/[id]/trash` → set `deleted_at = now()`; `POST .../restore` → clear it. Owner-scoped
  via existing RLS, mirroring `revoke`.

### 3. Retention sweep (cron wrapper + `--dry-run` in the same PR — pipeline-freshness rule)
Daily: `DELETE FROM deliverables WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '7 days'`.
Inherently guarded (never touches live rows). Ship the GHA cron + a `--dry-run` that prints the would-delete
count. Bounded delete, not a fetch — no PROBE concern.

### 4. UI (inside P1's `DeliverableModal`)
- **Refresh with current data** → swaps the modal to the new version (toast: "Updated to today's data — your
  shared link still shows the old snapshot").
- **Edit** → guided panel: add/remove items, template select, branding color, one-line steer → Rebuild → new
  version in the modal.
- **Delete** → trash → removed from the Built lane.
- **Built lane** gains a small **"Recently deleted"** disclosure with **Restore**; superseded versions collapse
  under a **"versions"** toggle on the current one.

## Guardrails (do not break)
- **No-invention is structural.** Every refresh/edit goes through `gateNarrative` → `spec-validator` +
  `facts-only-lint` + `inference-bait-lint` + `smoothing-lint`. Inputs-in / gated-rebuild-out, never prose-in.
- **Frozen-link integrity.** Content changes fork a new id; a shared `/p/[id]` never changes under an external
  viewer. Only cosmetic re-skins update in place.
- **Monetization.** Every edit and refresh is **free forever**; **send** is the only paywall. Never gate editing.

## Verification (end-to-end) — J3 acceptance bar

> **J3 done means:** Built lane thumbnail opens big; edit a section/color → rebuild passes `spec-validator` + 3 lints; shared `/p/[id]` link semantics explicit (fork-on-content-edit, cosmetic-in-place); deleted deliverable recoverable for the retention window.

> **Migration sequencing note:** P4's `deleted_at`/`supersedes_id` migration and the G3 scope migration (`20260616_deliverables_scope.sql`) both alter `public.deliverables`. Run the scope migration first (it's W0; it adds columns that the build route uses); run P4's soft-delete migration at P4 build time. Never run both in a single transaction — they can land cleanly in sequence.

1. Build → open → **Refresh** → new slug renders today's data; original slug still loads **frozen**; `supersedes_id` links them.
2. **Edit**: add a metric → Rebuild → new version; an unsourced steer gets stripped by the lints, not published.
3. **Cosmetic**: change accent color → **same id**, re-rendered, no new version.
4. **Trash**: delete → gone from Built lane, present under "Recently deleted"; **Restore** → returns.
5. **Sweep `--dry-run`**: reports only rows with `deleted_at` older than 7 days; never a live row.
6. `bun test` + `next build` + lint green (watch `react-hooks/set-state-in-effect` in the modal controls).

## Out of scope (v2)
Section-level "regenerate just this section"; soft-delete/restore of individual **project items** (jsonb bag);
diff/compare-versions UI. v1 ships fork-on-content-edit + cosmetic-in-place + 7-day trash.
