# Task 3 — Recurring lane adopts the spine (and the slot-break guard)

**Builder:** Opus · **Wave:** B (parallel with Task 4) · **Depends on:** Task 2

## Goal

A recurring schedule with `template_id:"report"` renders the **grounded** report with **fresh data each run** — and Phase 1's removal of the `[ BODY TEXT ]` slot does **not** silently break it.

## Why this is Opus

Subtle correctness: the recurring lane already maps `report → email/email-report` (`template-registry.ts`) and `schedule-command.ts` lets a tenant pick `template_id:"report"`. The scheduler renders via `renderEmailTemplate(slug, {body})` (`run-schedules.mts:266-269`) — the slot Phase 1 deletes. Left unguarded, a "report" schedule renders an empty masthead+footer.

## Build

1. **`buildContent` for the "report" template** (`scripts/email/run-schedules.mts`): when `resolveTemplateSlug(row.template_id) === "report"`, assemble a `GroundedReportModel` from the row's scope via the existing `assembleScopedContent` (`lib/email/scoped-content.ts`) → fresh data this run. Non-"report" templates keep the current `{subject, body, chart}` path unchanged.
2. **`renderHtml`**: route "report" through `renderGroundedReport(model, {skin:"email", brand})` (Task 2). Plain templates (hero/table/compare/ranked/hbar) keep `renderEmailTemplate(slug, {body, chart})` — `[ BODY TEXT ]` path **unchanged** (backward-compat).
3. **Guard:** if a "report" schedule can't assemble a model (out-of-footprint scope), fall back to the global digest (never invent below grain) — mirror the existing `assembleScopedContent` null-fallback.

## Tests / acceptance

- `DRY_RUN=true bun scripts/email/run-schedules.mts` on a seeded `template_id:"report"` schedule logs a grounded would-send carrying a **fresh** freshness token (not Phase-1's static sample).
- A seeded `template_id:"hero"` schedule's would-send is **byte-identical** to before (no regression).
- Scheduler unit tests (`lib/email/__tests__/scheduler.test.ts`) stay green; add a case asserting "report" routes to the grounded renderer.

## Guardrails

No double-send / re-arm semantics change — only `buildContent`/`renderHtml`. Idempotency + usage gates untouched. Open check `email_recurring_report_template`. Do **not** flip the paused cron (`email-scheduler.yml`) — go-live is separate.
