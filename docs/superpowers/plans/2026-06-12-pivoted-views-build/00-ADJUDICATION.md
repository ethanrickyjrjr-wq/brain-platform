# §00 — Adjudication (decision record, no code)

This records *what was judged right and wrong* across three review rounds (assessment → LittleBird → operator flags → operator catches), each verified against code this session (RULE 3 C1). Read it before executing any section — it is why the build differs from the spec.

## Verified-against-code claims (the load-bearing ones)

| Claim | Verdict | Evidence (file:line) |
|---|---|---|
| Master reads upstream OUTPUTS only; DAG not inverted | **TRUE** | `refinery/packs/master.mts:77-81` (extracts `n.output` from brain-input fragments; pure-code synthesizer, no `data_lake` reads) |
| Grading immune to view drift (past grades frozen) | **TRUE — bankable, retroactive-revision only** | `refinery/lib/metric-observations-log.mts:48` (`observed_at = brainOutput.refined_at`) + append-only unique key `(slug, brain_id, observed_at)` + `ignoreDuplicates`; table `docs/sql/20260531_grading_loop.sql:30-42` |
| `refined_at` is a stable data-vintage | **FALSE — it's wall-clock** | `refinery/stages/4-output.mts:355` (`const refined_at = isoTimestamp()`). So a cutover writes a *new* observation (forward seam), not a frozen-log overwrite. |
| The spec's ZHVI/ZORI consumer is `housing-swfl` | **FALSE — wrong brain** | `home-values-swfl.mts:308-378` is the ZHVI consumer; `rentals-swfl.mts:310-381` the ZORI consumer; `housing-swfl.mts:358-435` is the Redfin brain (sale price/DOM/MoS) |
| YoY `LAG(col,12)` in the spec is a real bug | **TRUE — view-introduced** | spec lines 150-152; pack is already calendar-honest (`home-values-swfl.mts:94-115` `lookbackObservation`, 7-day tolerance) |
| Headline number is median-over-finite-YoY-subset | **TRUE** | `home-values-swfl.mts:170` (`regional_median_yoy_pct = median(yoys.filter(finite))`); polarity keys on it `:184` |
| Backtest reader tolerates >1 vintage/period | **TRUE (idempotency non-issue)** | `refinery/lib/backtest/grid.mts:62-69` (`pitInitial` picks latest `observation_date` with `realtime_start ≤ asOf`) |
| ZHVI/ZORI backtest-EXCLUDED (no vintages) | **TRUE** | `refinery/tools/flywheel-backtest.mts:83` ("Zillow re-writes history; no retained vintages") |
| `investor-zip-swfl` is a 2nd raw ZHVI consumer | **FALSE — thin-pipe OUTPUT consumer** | `investor-zip-swfl.mts:11,599,604` (`makeBrainInputSource`, DAG edge); reads `home_value_zhvi` cell `:182`, computes a yield, not a ZHVI YoY |
| `tourism-tdt` is live-emitting | **NOT CONFIRMED** | registered (`index.mts:66`) but zero `metric:` literals in the pack; TDT self-ingest migration/backfill pending (project memory) |
| Pack lookback = MAX-within-window (not closest-to-target) | **TRUE** | `home-values-swfl.mts:94-115` & `rentals-swfl.mts:94-115` (byte-identical) — walks newest→oldest, returns first in-window row = newest = MAX |

## Round 1 — assessment + LittleBird

- **Folded in:** the YoY fix (refined — bug is *view-introduced*; replicate the 7-day tolerance, not a bare `month−12` join); `view_vintages` as a *separate* operator yes (it is entirely absent from the spec); discount the "moat/unrecoverable" rhetoric but keep the true core (ZHVI/ZORI have no vintages).
- **Improved:** the two confidence claims LittleBird said "verify later" were verified *now* (master OUTPUTS-only, grading immunity) → bankable. ODD check resolved (none of the six series are ODD-fed; capture narrows to ZHVI+ZORI, both ingest by day 22).
- **Pushed back:** the idempotency edge is a non-issue (`pitInitial` tolerates duplicates).
- **My corrections to the spec:** wrong cutover brain (→ `home-values-swfl`); grain mismatch means one wide view can't serve both consumers (→ two views); keep the median/polarity/top-N rollup in TS (R1-respecting; makes GATE A tractable).

## Round 2 — operator's five flags

1. **YoY equivalence (my error):** month-bucketing does **not** reproduce the 7-day tolerance — it agrees only on today's month-end-aligned data (the fixture trap). → replicate the tolerance faithfully in SQL; add a drifted/gapped-row equivalence test.
2. **investor-zip (pushed back):** thin-pipe OUTPUT consumer → cutover propagates transparently. New constraint: preserve the detail_table contract → GATE A diffs detail_tables.
3. **Consuming-brain gate (folded in):** registration ≠ live; `tourism-tdt` view stays display-only until proven live.
4. **Scope "immune" (folded in):** immunity is retroactive-only; the forward cutover seam is defended only by GATE A clean ×3, machine-diffed.
5. **Grant scope (confirmed):** `/charts` is server-side → `service_role`-only is correct.

## Round 3 — operator's two catches

- **CATCH 1 (fixed):** registering ZHVI/ZORI in `BACKTESTABLE` is **not** inert — it would grade on near-zero N before vintages exist. §08 is now three phases; the flip is §08c, gated on ~9 months of real history, reporting N + a capture-start caveat. Never in the code half.
- **CATCH 2 (confirmed in our favor):** the pack picks **MAX-within-window** (newest), not closest-to-target; `rentals-swfl` is byte-identical. SQL `MAX` matches exactly. Added a two-rows-in-window fixture to §04 to pin the selection rule.

## Things deliberately NOT done

- **Side-master** (R&D, reads views cold, diffed in `public.checks`) — deferred to a later phase, not dropped.
- **`housing-swfl` (Redfin) view** — not in this backlog; a separate effort if ever wanted.
- **LAUS/QCEW/OEWS/TDT/rainfall vintage capture** — LAUS already has ALFRED; the rest are revised-aggregate/fixture/annual and can't be made PIT-honest by snapshotting. Only ZHVI+ZORI capture.
