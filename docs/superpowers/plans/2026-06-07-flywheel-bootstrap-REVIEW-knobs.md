# Flywheel bootstrap — the dials to review (Ricky)

Companion to the plan (`2026-06-07-flywheel-bootstrap-grades-from-history.md`) and the explainer.
**Everything here is a proposal, not locked.** Edit in place when you're home — strike a row, bump a
number, add a slug. These are the only real decisions; the rest of the plan is plumbing.

Mark changes however you like, e.g. `~~strike~~`, `<-- CHANGE`, or `ADD:` lines.

---

## DIAL 1 — Volume targets (how many graded calls before we trust the scorecard)

| Target                              | Proposed                                     | Why this number                                                         | Your call |
| ----------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------- | --------- |
| Per-slug minimum                    | **≥ 30 graded calls**                        | Below ~30 the hit-rate is too noisy to mean anything                    |           |
| Total corpus, first read            | **≥ 100 graded calls**                       | Enough to see if we beat naive + draw a rough calibration curve         |           |
| Calibration buckets                 | **5 confidence bands** (e.g. 0–.2, .2–.4, …) | Fewer = too coarse, more = too few calls per band                       |           |
| Grid step (LAUS)                    | **Quarterly** (monthly optional)             | Quarterly over 19 yr ≈ 70+ points/series; monthly ≈ 220 if we want more |           |
| Grid step (immutable sales/permits) | **Monthly**                                  | Limited by how deep the LeePA window goes                               |           |

> Rule that doesn't move: every score is reported **with its N**. "68% (N=31)", never "68%".

---

## DIAL 2 — The slug universe (what we grade, and what we deliberately refuse to)

### ✅ Backtestable — replay is honest (point-in-time or immutable)

| Slug / signal          | Source                                          | Why it's honest                                       | Keep? |
| ---------------------- | ----------------------------------------------- | ----------------------------------------------------- | ----- |
| Lee unemployment       | ALFRED LAUS `FLLEEC7URN` (231 vintages, ~19 yr) | We kept the as-of-then snapshot — no revision peeking |       |
| Collier unemployment   | ALFRED LAUS `FLCOLL0URN`                        | same                                                  |       |
| LeePA sale-velocity    | `data_lake.leepa_parcels` by `sale_date`        | A sale never un-happens — immutable                   |       |
| Building-permit counts | `data_lake.lee_building_permits` by issue date  | Issue date never revised                              |       |

### ⛔ Excluded — replay would be look-ahead cheating (LISTED, not silently dropped)

| Slug / signal                 | Why excluded                               | Could it ever qualify?                            |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------- |
| ZORI rent                     | Zillow re-writes history; no kept vintages | Only if we start archiving vintages going forward |
| Census ACS aggregates         | Revised; no point-in-time archive held     | Same — needs vintage retention                    |
| BLS QCEW / revised aggregates | Benchmark revisions overwrite the past     | Same                                              |
| TDT collections               | Fixture-only, self-ingest still pending    | After self-ingest lands                           |

> If you want a signal moved from ⛔ to ✅, it needs **kept as-of-then snapshots** first — otherwise the
> grade is fiction. Add candidates under either list and I'll tell you which bucket it honestly lands in.

---

## DIAL 3 — Table design (where the replay grades live)

**Proposed: a separate `backtest_grades` table.** Not blended into the live `predictions`/`outcomes`.

| Option                                              | Pros                                                                          | Cons                                                                                                           | Your call |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------- |
| **A — separate `backtest_grades` table** (proposed) | Physically can't contaminate live grades; clean audit; easy to drop & rebuild | One more table to create                                                                                       |           |
| B — flag column on existing `predictions`           | One table                                                                     | Risk of a query forgetting the filter and blending replay into a live number — exactly the line we don't cross |           |

Proposed columns: `slug`, `as_of_date`, `predicted_direction`, `baseline_value`, `window_end_date`,
`observed_value`, `grade` (hit/miss/partial/neutral), `magnitude_error`, `confidence`,
`grade_method = 'retrodicted'`. Idempotent on `(slug, as_of_date, grade_method)` so re-runs don't dupe.

---

## DIAL 4 — Order of attack (what gets done first)

| Step | What                                                                     | Hand to Tariq?          |
| ---- | ------------------------------------------------------------------------ | ----------------------- |
| 0    | Lock the grade rules + the "beat naive" baseline; lift the existing HOLD | Good first task for him |
| 1    | Build the as-of replay loop (the one new piece of code)                  | His lane                |
| 2    | Run the grid → fill `backtest_grades` to ≥100                            |                         |
| 3    | Read the scorecard: beat-naive? confidence calibrated?                   |                         |
| 4    | Tune weighting from the scorecard                                        | The payoff              |

---

### Quick parking lot (drop notes here for when you're home)

-
-
-
