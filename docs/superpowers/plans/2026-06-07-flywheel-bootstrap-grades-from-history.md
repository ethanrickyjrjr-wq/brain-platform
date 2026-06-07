# Bootstrap the flywheel — graded outcomes from history, before users

**Date:** 2026-06-07
**Status:** PLAN (brief, not a status board — obligations live in `public.checks`, per RULE 2)
**One-liner:** Take the backtest decision function from N=1 (Ian demo) to N=hundreds on the
series we can honestly reconstruct point-in-time, so we have a graded track record to
_calibrate confidence and tune weighting against_ — today, before a single live user grade exists.

---

## Why (the problem Tariq named, the answer we already half-built)

The weighting machinery (Yager, constitution, critique loop) is being built ahead of any graded
outcomes to tune it against. Tuning weights against gut isn't a system. The fix is to **grade
calls against reality first**, then let the weighting earn its place against the grades.

We don't have to wait years for live predictions to resolve. We have **point-in-time history**.
For a vintaged series we can reconstruct "what the data said as-of date T," make the call as-of T,
then resolve it against what actually happened by T+window — all from data already in the lake.
That manufactures graded outcomes _today_.

This plan is the **volume** step. It sits between two things that already exist:

- **Below it (settled / exists):** the deterministic decision function
  `refinery/lib/backtest/decision-fn.mts` (`computeBacktestCall(asOf, gradeConfig)`) + skill baseline
  `refinery/lib/backtest/skill-baseline.mts` (`computeSkillScore`), unit-tested 29/29, proven end-to-end
  at N=1 by `refinery/tools/ian-retrodiction-demo.mts`.
- **Above it (deferred — Goal 9, stays deferred):** re-running the _entire master LLM/synthesis_ against
  a historical lake snapshot. We do **not** need that for grades. We backtest at the
  **metric / decision-function grain**, not the full-master grain. The refinery's missing as-of-date
  parameter is therefore _not a blocker_ for this plan.

---

## Hard honesty guardrails (these are the whole point — break one and the grades are fiction)

1. **Only point-in-time-honest series.** Backtest **only** where we can recover the as-of-then value
   without look-ahead:
   - **Vintaged:** ALFRED LAUS — `FLLEEC7URN` (Lee), `FLCOLL0URN` (Collier), 231 vintages, `realtime_start`
     recovers the value originally published on date T (`ingest/pipelines/fred_laus_alfred/`).
   - **Immutable transactions:** LeePA sales by `sale_date`, building permits by issue date — a sale
     never un-happens, so a date filter is honest even on overwrite.
   - **EXCLUDED (look-ahead — would be cheating):** ZORI (forward-only, Zillow re-publishes history),
     any revised aggregate without retained vintages. Excluded slugs are **logged, never silently dropped.**
2. **Synthetic grades stay physically apart from live grades.** Backtest rows carry
   `grade_method = 'retrodicted'` and land in a **separate** `backtest_grades` table — never blended into
   `predictions`/`outcomes`. A retrodicted grade must never inflate a live skill number by accident.
3. **The public moat is the LIVE record, not this one.** Backtest grades are **internal tuning fuel** —
   they calibrate confidence and weight slugs. They are **NOT** a marketing accuracy number. We do not
   tell anyone "we're X% accurate" off retrodicted grades. That headline only ever comes from live calls
   resolving in the `outcomes` table. (Structural-guarantee discipline — see memory `project_structural-guarantee-not-ai-virtue`.)
4. **Report N with every score.** Never a bare percentage. `68% (N=31)` always, never `68%`.
5. **Systematic grid, not cherry-picked events.** The corpus is built from a regular as-of grid across
   the whole vintage window (every month/quarter), not hand-picked anchor events — hand-picking is
   survivorship bias. (The hand-seeded event-study corpus in
   `docs/superpowers/specs/2026-05-30-event-study-backfill-design.md` is a _separate_ Goal-7 effort; do
   not conflate.)

---

## Phases

### Phase 0 — Settle the decision function + skill baseline (lift the HOLD)

The retrodiction harness sits behind the HOLD named `flywheel_backtest_decision_function` — a
code-level gate referenced in `decision-fn.mts` / `skill-baseline.mts`, and carried inside the open
ledger check `row_tier_build_remaining` (whose Track-B backward-engine clause is "held behind
flywheel_backtest_decision_function"). It is **not** a standalone closeable check row. The intent:
"don't scale until the decision rule + skill metric are settled." Settle them:

- Lock the per-slug **grade config** that `resolveGradeConfig(slug)` returns: direction polarity,
  `window_days`, `epsilon` (neutral band), gradeable y/n. Write these down per backtestable slug.
- Lock the **verdict bands**: hit / miss / partial / neutral-band, and how `magnitude` error is scored.
- Lock the **naive baseline** `computeSkillScore` measures against (persistence / random-walk). The
  decision function has to _beat naive_ or weighting is moot.
- Sanity-run the existing decision-fn on 3–5 hand-checked (slug, as-of) points; eyeball that grades
  aren't garbage.
- **Output:** a settled grade-config doc; lift the `flywheel_backtest_decision_function` HOLD and
  reconcile the `row_tier_build_remaining` ledger check that carries it (close or re-scope its
  Track-B clause) — there is no standalone `flywheel_backtest_decision_function` row to close.

### Phase 1 — As-of backtest harness (the one new piece of code)

A loop, not a re-synthesis. For a `(slug, as_of_date)`:

1. Reconstruct the as-of value from the vintaged/immutable source (`realtime_start ≤ as_of` for ALFRED;
   `sale_date ≤ as_of` for LeePA).
2. Compute the call: `computeBacktestCall(asOf, gradeConfig)`.
3. Resolve the outcome at `as_of + window_days` from the actual later data (which exists — it's the past).
4. Grade it deterministically (reuse the live grade-field logic in `refinery/lib/predictions-log.mts`).

Reuses everything already tested; the only new surface is the as-of loop + the outcome-resolution read.

- **First:** enumerate the **backtestable slug universe** honestly (LAUS Lee/Collier unemployment;
  immutable LeePA sale-velocity; permit counts). Print the excluded list and why.

### Phase 2 — Generate the grid + run at volume

- For each backtestable slug, build a regular as-of grid across its available history (LAUS ≈ 19 yr →
  monthly or quarterly steps; immutable series → whatever the lake window allows). Each `(slug, as_of)`
  with a resolvable outcome at `as_of + window` = one graded call.
- Write rows to a new **`backtest_grades`** table (idempotent on `(slug, as_of_date, grade_method)`,
  `grade_method='retrodicted'`). Create it via psycopg3 + `.dlt/secrets.toml`, idempotent SQL,
  `GRANT ... TO service_role` (mirror `docs/sql/20260517_predictions_outcomes.sql`).
- **Volume target:** ≥30 graded calls/slug, ≥100 total for a first read. Log per-slug N.

### Phase 3 — Score + calibrate (the payoff)

- **Skill:** `computeSkillScore(scoredCalls)` vs naive, per slug and overall. If we're not beating naive,
  that's the headline finding — the _call logic_ needs work before weighting does.
- **Calibration curve:** bucket calls by stated `confidence`, measure hit-rate per bucket. Does higher
  confidence actually mean higher accuracy? Produce the calibration table — this is what makes
  `confidence` honest instead of decorative.
- **Per-slug reliability:** which metrics are predictable, which are noise.

### Phase 4 — Feed weighting + hand off to live grades

- Use calibration + per-slug reliability to set/adjust the weighting (the place gut-tuning gets replaced).
  Document weights before/after and the skill delta.
- Wire the skill/calibration computation to read **both** `backtest_grades` (seed) and `outcomes`
  (live, as it fills). Backtest grades bootstrap the curve; live grades take over and eventually stand
  alone. Keep `grade_method` so we can recompute on live-only once live N is large enough.

---

## What gets written where

- New code: `refinery/tools/flywheel-backtest.mts` (the Phase-1 harness + Phase-2 grid runner).
- New table: `backtest_grades` (migration in `docs/sql/`, run via psycopg3).
- Reuse: `decision-fn.mts`, `skill-baseline.mts`, `predictions-log.mts` grade logic, `resolveGradeConfig`.
- No change to the live `predictions`/`outcomes` flow. No refinery as-of param (deferred Goal 9).

## Failure modes to watch

- **Look-ahead leak** — any non-vintaged series sneaking in. Excluded list is enforced, not advisory.
- **Tiny N** — some slugs won't have enough resolvable windows; report N, don't average it away.
- **Treating retrodicted as live** — guardrail 3. The day someone quotes a backtest % as a track record,
  the moat is corrupted.

## Open checks to file when this starts (RULE 2 — ledger, not markers here)

- `flywheel_decision_fn_settled` — Phase 0 grade-config + skill baseline locked, HOLD lifted.
- `flywheel_backtest_grades_corpus` — `backtest_grades` table live, ≥100 retrodicted grades written.
- `flywheel_calibration_read` — first skill + calibration read produced; beats-naive y/n recorded.
- `flywheel_weighting_tuned_from_grades` — weighting adjusted from the calibration curve.
