# A-4 — Example deliverables, LIVE-generated — **SONNET**

## Goal
Seed the logged-out popup with real, current example deliverables that **dogfood the engine** and
never go stale — NOT a hardcoded fixture.

## Why live (future-proofing #1)
A frozen seed (and `demo-answer.ts`'s pinned `freshness_token: "SWFL-7421-v5-20260522"`) will
contradict live `/r/*` the moment data refreshes — showing a stale number as current, violating our
own freshness rule.

## Approach
- A **scheduled job** rebuilds the example deliverables through the real `lib/deliverable/build.ts`
  path (the same path `/api/projects/[id]/build` uses) from **live brain reads**, for a fixed set of
  scenario inputs. **Reuse the existing build/parity machinery — never fork a fixture.**
- Make the scenario set **data-driven** (a small registry the cron reads), e.g. FMB 33931 one-pager,
  a market-overview, etc. — so adding a 5th example is a data change, not a code edit.
- Each example carries a **live freshness token**.

## Identity / safety (correction 5 + future-proofing #2)
- `deliverables.user_id` is `uuid NOT NULL`, **no FK** to `auth.users`, public SELECT, ALL to
  service_role. Write examples via **service_role** under a **reserved sentinel UUID** + an
  `is_example` convention so they don't FK-fail, don't pollute user analytics, and stay filterable.

## Acceptance test
- Each `/p/example-*` opens, renders cited content, and quotes a **current** freshness token that
  matches live `/r/*` (live-gen proof).
- Re-running the job after a data refresh updates the example's numbers + token (no staleness).
- Examples are filterable by `is_example`/sentinel; they don't appear in user-scoped analytics.
