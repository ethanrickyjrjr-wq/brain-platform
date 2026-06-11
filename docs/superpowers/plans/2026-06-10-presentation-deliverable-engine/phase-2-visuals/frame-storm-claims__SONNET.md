# Phase 2f — Frame: Storm Claims Timeline · SONNET · PARALLEL (after 2a)

> **Contract (inherited):** own ChartSpec registry; per-visual as-of; PROVENANCE never prose-policed;
> NO `git push`. Depends on **Phase 2a**. Independent of the other 4 frames.

## Design source
`SWFL-Visuals-UI-Kit.html` visual **#06 — Storm claims timeline** (NFIP paid claims per named storm).

## Data source
`env-swfl` brain (NFIP paid claims by storm/event).

## 2-pre data-availability check (DO FIRST — ~30 min)
Confirm `env-swfl` emits per-storm paid-claim events (event label + date + amount). If absent, **park**
+ note in README.

## Task
1. `components/charts/registry/frames/TimelineFrame.tsx` taking `{ spec: ChartSpec }` — events over
   time (named markers + magnitude). Parameterize via `spec.options` so it's a reusable event-timeline,
   not storm-specific.
2. Register with `accepts: ["timeline"]`.
3. Fixture-bind; stamp `spec.asOf`; render the as-of caption.

## Acceptance
- Renders from a fixture spec; events placed in time with magnitude; as-of caption present; `tsc`
  clean; data-adapter test.

## §DATA-PARK — pre-check result (2026-06-11)

env-swfl does NOT emit per-storm paid-claim amounts individually. `NfipSwflAggregate` only carries
`storm_year_total_usd` (combined across all named storms) and `baseline_annual_usd`. Per-storm
breakdown exists in `NfipCountyYear` fragments emitted by `fema-nfip-source.mts` but is NOT
surfaced in the brain's `BrainOutput` (no `detail_tables`, no per-storm key_metrics).

**Resolution:** frame built fixture-bound. To wire live data, surface per-storm yearly totals from
the `NfipCountyYear` fragments — add a `by_storm` array to `NfipSwflAggregate` or a new
`nfip-storm-breakdown` fragment — then populate `spec.options.events` from the brain OUTPUT.
`SWFL_STORM_YEARS` in `refinery/sources/fema-nfip-source.mts` already has `{ name, year,
landfall_date }` — amounts just need to be paired.

## Wrap
Commit locally. SESSION_LOG + build-queue. Update README status row 2f. **No push.**
