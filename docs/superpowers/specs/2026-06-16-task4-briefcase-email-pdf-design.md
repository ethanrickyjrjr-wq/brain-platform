# Spec (AS-BUILT): Task 4 — Briefcase `email` deliverable + PDF skin

**Date:** 2026-06-16
**Status:** BUILT — shipped in commit `48ef6eb` (single atomic commit). This doc is the
as-built record; it supersedes the pre-review draft and the chat-reviewed v2. Where v2
and the live code disagreed, the code (verified in-session) wins and is noted inline.
**Depends on:** Task 2 (convergence spine: `GroundedReportModel` + `renderGroundedReport`)
**Open check:** `briefcase_email_pdf_deliverable` (stays OPEN — prod-evidence gate below)
**Verified against:** ethanrickyjrjr-wq/brain-platform @ main `ed8e77e` (build baseline)

---

## Goal

Add an `"email"` deliverable template to the briefcase. A user passes a ZIP scope at
build time; the system freezes a `GroundedReportModel` from the project's snapshot and
renders it via the Task 2 spine — both as an inline email preview on `/p/[id]` and as a
letter-size PDF via a print route. Build + preview + PDF are free (watermark only); send
is the paywall (Tasks 5/6). Both skins share one render call; no numbers are invented.

---

## What shipped (and the 4 corrections vs the v2 draft)

The v2 draft was structurally right but rested on surfaces the code contradicted. The
in-session audit produced four corrections, all now in the shipped code:

1. **Reads come from the narrative PROSE, not a second copy of the metrics.**
   `renderGroundedReport` renders a read from `line.text` ONLY (`grounded-report.ts:218`);
   `source_url`/`source_citation` on a `ReportLine` are type-required but never rendered
   in this skin. v2's "lines from metric items" would have echoed each number 2–3× (hero +
   metrics table + reads) and dropped the analytical prose. So `lines` derive from
   `exec_summary` + section intros; the one rendered piece of provenance — the
   `freshness_token` — is lifted from the frozen items.
2. **The skin value is `"pdf"`, not a new `"doc"`.** `RenderGroundedOptions.skin` was
   already `"email" | "pdf"` with a `renderSkin` TODO reserving `"pdf"`. No union widen.
3. **`captured_at` is deterministic** (`row.created_at`), never `new Date()` — preserves
   the pure-function / "same row → same output" invariant.
4. **The print route is deliverable-keyed at `app/p/[id]/print/route.ts`**, NOT
   `app/api/projects/[id]/print` (project-keyed; that path is owned by an unmerged
   worktree for a different preview-card feature). Zero collision. A `route.ts` (not a
   `page.tsx`) is correct: it returns the standalone doc and bypasses the root layout, so
   the doc's `<html>` is never nested inside the app layout's `<html>`.

---

## Architecture

### Scope contract

ZIP-only, matching the recurring lane. Non-ZIP / blank scopes return `null` from
`buildEmailDeliverableModel` → `GlobalDigestFallback`. Never invented sub-grain precision.
Scope is passed explicitly at build time as `{ scope_kind, scope_value }` (same shape as
`email_schedules`) and persisted on the `deliverables` row so `/p/[id]` and the print
route reconstruct the model purely (no live fetch).

### The shared ZIP guard

`resolveReportZip(kind, value)` was extracted from `recurring-report.ts` (the inline guard
that normalizes `kind.trim().toLowerCase()` + `value.trim()`) into a named export, and BOTH
lanes import it. The normalization is preserved exactly — extracting it as a bare
`kind !== "zip"` check would have made the live recurring lane case/whitespace-sensitive.

---

## Files (all in commit `48ef6eb`)

### A. Migration — `docs/sql/20260616_deliverables_scope.sql`  ⚠ UNAPPLIED (operator-side)

```sql
ALTER TABLE deliverables
  ADD COLUMN IF NOT EXISTS scope_kind  text,
  ADD COLUMN IF NOT EXISTS scope_value text;
```

Additive, idempotent, no backfill. Old rows get NULL → `buildEmailDeliverableModel` returns
null → `GlobalDigestFallback` (correct fail-open). **Operator applies + prod-verifies the
columns** before the check closes (designated operator-side; 4th unapplied migration).

### B. `app/p/[id]/page.tsx` — `DeliverableRow` + email branch

- `DeliverableRow` gains `scope_kind: string | null` / `scope_value: string | null`
  (the page reads via `.select("*")`, so they flow once the migration lands).
- New branch BEFORE `buildRenderModel`: `template === "email"` → `buildEmailDeliverableModel`
  → `renderGroundedReport(model, { skin: "email" })` rendered in an `<iframe srcDoc>`
  (a full `<html>` doc can't go in a `<div>` — the browser strips its `<head>`/`<style>`).
  Null model → `<GlobalDigestFallback>`. A "Save as PDF" link opens `/p/[id]/print`.

### C. `lib/deliverable/templates.ts` — `TemplateId` + exhaustive switch

`"email"` added to `TemplateId`; `buildRenderModel` gains a `case "email"` that THROWS
(email never goes through the slot model — every render surface special-cases it first).
The throw is required for the `never` exhaustiveness check to compile (atomic type-lift).

### D. `lib/deliverable/assemble.ts`

`"email"` added to `DELIVERABLE_TEMPLATES`; `assembleDeliverable` opts gain optional
`scope_kind`/`scope_value`, written to the `deliverables` INSERT (NULL when absent).

### E. `lib/email/recurring-report.ts` — `resolveReportZip` (shared guard, see above)

### F. `lib/deliverable/email-deliverable.ts` (new) — the pure core

`buildEmailDeliverableModel(row, opts?)`:
- `resolveReportZip` guard → null for non-ZIP.
- `metrics`: each `kind:"metric"` item → `ReportMetric { key: metric_slug ?? id, label,
  value: null, display: item.value }` (the item stores a pre-formatted string; the renderer
  reads `display`).
- `lines`: `exec_summary` + one per `narrative.section` (`text = "title — intro"`), with the
  6 other `ReportLine` fields as safe placeholders (`source_url:""`, etc.).
- `freshness_token`: first item carrying one (metric/qa/report/table_slice/…).
- `snapshot`: `emptyActivationSnapshot(zip, row.created_at)` (5-field contract; never
  rendered because `delta:null`).
- Input typed as a local `EmailDeliverableRow` (the DB row is a structural superset — no
  import from the page file).

### G. `lib/deliverable/examples.ts`

`ExampleScenario` gains optional `scope_kind`/`scope_value`; `buildExampleDeliverable`
writes them into its INLINE `.upsert` (it does NOT route through `assembleDeliverable`).
New scenario `example-email` (`housing-swfl`, ZIP `33901`).

### H. `components/GlobalDigestFallback.tsx` (new)

Renders the plain narrative (`exec_summary` + `sections[]{title,intro}`) when scope is null.
Placed in root `components/` to match the repo's `@/components/*` convention (not
`app/components/`).

### I. `templates/html/email/doc-report.html` (new) + render wiring

- Cloned from `email/email-report.html` (so every token the shared renderer fills is
  present and it passes the unfilled-token gate), minus the CTA, plus
  `@page { size: letter; margin: 1in; }`, `print-color-adjust:exact`, and a
  "Built with SWFL Data Gulf" watermark.
- Registered as slug `doc-report` → `email/doc-report` in `EMAIL_TEMPLATES`.
- `renderSkin` now routes `skin === "pdf"` → `doc-report`, else `report`. The email skin is
  byte-identical (golden-equivalence test green).

### J. `app/p/[id]/print/route.ts` (new) — the PDF route

`GET /p/<id>/print`: service-role read (public-by-slug, revoked → 404), `template !== "email"`
→ 422, null model → 422, else `renderGroundedReport(model, { skin: "pdf" })` + an auto-print
script, `text/html`. Deliverable-keyed; no auth beyond the unguessable slug (mirrors the page).

---

## Frozen-snapshot guarantee

Both `/p/[id]` and `/p/[id]/print` call `buildEmailDeliverableModel(row)` — pure over the
frozen `items_snapshot` + `narrative` + persisted scope. No live fetch. Same row → same
model → same output. The moat is structural.

---

## Tests (all green)

- `lib/deliverable/email-deliverable.test.ts` — 21 unit (TDD, RED→GREEN): scope guard +
  normalization, metric mapping (`value:null`/`display`/`key`), **lines-from-prose +
  no-metric-echo**, freshness lift, determinism, snapshot shape, scope/delta invariants.
- `lib/email/grounded-report-briefcase.test.ts` — both skins render from a frozen row:
  ZIP + metric + token + prose present, no unfilled tokens, CTA only in email, watermark
  + `@page` only in pdf.
- Suites: `lib/deliverable` **198/0**, `lib/email` **356/0** (incl. golden-equivalence +
  recurring lane). `tsc --noEmit` clean, eslint clean.

---

## Open check — `briefcase_email_pdf_deliverable` (stays OPEN)

Close only after (prod evidence, not dev attestation):
1. Operator applies `20260616_deliverables_scope.sql` + confirms the columns in prod.
2. `/p/example-email` renders grounded email HTML with ZIP 33901 (needs the example
   rebuilt post-migration + a deploy).
3. `/p/example-email/print` returns letter-size HTML (skin `pdf`) with matching numbers.
4. Re-open `/p/example-email` shows identical output (snapshot frozen).
