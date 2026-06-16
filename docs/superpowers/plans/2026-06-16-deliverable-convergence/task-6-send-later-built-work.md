# Task 6 — Send-later handle on built work

**Builder:** Sonnet · **Wave:** D (parallel with Task 5) · **Depends on:** Task 7 (bridge), Task 4 (email deliverable)

## Goal

Every built deliverable carries a permanent **Send** and **Send weekly** handle, so a user can return days/weeks later and send something already made — re-entering the same flow with a **fresh** render (never mailing stale frozen numbers).

## Why this is Sonnet

UI affordances on existing surfaces (`/p/[id]`, `/project`) wired to the Task-7 bridge + Task-5 flow primitives. Pattern-following, low architectural risk.

## Build

1. **`/p/[id]` actions** (`app/p/[id]/DeliveryButtons.tsx`): add **Send** and **Send weekly** buttons. If a schedule already exists for this deliverable, show status ("Weekly → buyers, Mondays 7am — Pause") with a Pause control.
2. **Project list** (`app/project/page.tsx`): each deliverable card surfaces the same Send / Send-weekly affordance.
3. **Send-later renders fresh:** tapping Send re-runs the recipe (Task 7) for a current `renderGroundedReport`, shows "still look right?" before sending. The frozen `/p/[id]` snapshot is unchanged (historical record).
4. **Gate on auth/paywall** — same as Task 5 (send is the paywall; viewing the built work is free).

## Tests / acceptance

- `/p/[id]` and `/project` show Send / Send-weekly; an existing schedule shows status + Pause.
- Send-later produces a fresh render (new freshness token vs. the frozen snapshot) and re-asks before sending.
- "Send weekly" from built work creates one `email_schedules` row via Task 7 (no snapshot copied).

## Guardrails

Frozen `/p/[id]` never mutated. Send gated; view free. Per RULE 1.5, worktree-isolate if concurrent with Task 5. Open check `built_work_send_handle`.
