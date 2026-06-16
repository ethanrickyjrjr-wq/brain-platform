# Task 7 — Build→schedule bridge (recipe, not snapshot)

**Builder:** Opus · **Wave:** C (solo) · **Depends on:** Task 4 (deliverable carries a recipe)

## Goal

Turning a built deliverable into a weekly send copies its **recipe** (template + scope + audience + cadence) into an `email_schedules` row — **never** the frozen snapshot. This is the bridge that makes "template stays the same, data updates" true: the schedule re-fetches fresh data each run through the same recipe.

## Why this is Opus

The correctness core of the two-object model. Getting "copy the recipe, not the photo" wrong silently re-sends stale numbers weekly (violates no-fabrication / freshness). Also the seam where the AI-setup, contacts, and scheduler meet.

## Build

1. **Recipe extraction** — from a built `"email"` deliverable (Task 4 stores template_id + scope + chosen metrics on the row), derive the `ScheduleRow` recipe: `template_id:"report"`, `scope_kind/scope_value/topic`, `audience_slug`, `cadence/day/hour`.
2. **Insert via the existing two-step path** — feed the recipe through `schedule-command.ts` propose → confirm → write to `email_schedules` (reuse `app/api/email/schedule-command/route.ts`; do not write a parallel insert path). Assert **no snapshot** is copied.
3. **Idempotence** — re-issuing "send weekly" for the same deliverable+audience+cadence updates the existing schedule rather than duplicating it.
4. **Contacts** — recipients come from the user's `email_audiences` (already populated by `/api/email/contacts/upload` + `/sync`); the bridge only references an `audience_slug`, never re-implements contact handling.

## Tests / acceptance

- Confirming "weekly" inserts exactly one `email_schedules` row carrying the recipe; the row has **no** snapshot/frozen-data column populated.
- The scheduler (Task 3) then renders that row with **fresh** data each run (verified via `DRY_RUN`).
- Re-issuing the same request updates, not duplicates, the schedule.

## Guardrails

Schedule stores recipe only (two-object model). No new scheduling primitive — extends `email_schedules` + `schedule-command` (RULE 3 C2). Open check `build_to_schedule_bridge`. Go-live cron stays paused (separate).
