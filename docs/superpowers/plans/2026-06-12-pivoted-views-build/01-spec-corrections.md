# §01 — Spec corrections

**Model:** Opus (correctness-sensitive: the YoY SQL + the consumer mapping must be exactly right)
**Gate:** none — **but this MUST land before anyone executes against the original spec.** It is build step 1, not optional cleanup.
**Parallel with:** everything (doc-only).
**Target file:** `docs/superpowers/specs/2026-06-12-pivoted-views-pattern-design.md`

## Why

The approved spec's first-implementation and backlog sections name the wrong consumer brain and carry a YoY SQL bug. Executing against them as written would diff the wrong numbers on the wrong brain and ship a silently-wrong YoY. Fix the spec first so every downstream section reads a correct source.

## Edits to make

1. **Consumer mapping (the big one).** Everywhere the spec says `housing-swfl` consumes `zhvi_swfl`/`zori_swfl` (lines 171, 194-195, and the "Brain pack cutover (housing-swfl …)" heading), correct to:
   - ZHVI → **`home-values-swfl`** (slugs `home_value_zhvi_regional_median`, `home_value_yoy_pct_regional_median`, …)
   - ZORI → **`rentals-swfl`** (slugs `rental_rent_index_zori_regional_median`, …)
   - Note explicitly that `housing-swfl` is the **Redfin** brain (sale price / DOM / months-of-supply) and is **not** in this backlog.
2. **The YoY SQL (lines 149-152).** Replace the `LAG(<col>, 12) OVER (ORDER BY month)` row-offset with the **faithful 7-day-tolerance calendar self-join** (the exact SQL is specified in §02). Add one sentence: "Row-offset `LAG` and bare month-bucketing both diverge from the pack on a missing/drifted month; the graded view must replicate `lookbackObservation`'s MAX-within-±7-days rule."
3. **Two views, not one.** Amend "First Implementation — ZHVI" to describe two artifacts: a wide **display view** `zhvi_pivoted` (for `/charts`) and a latest-per-ZIP **brain-input view** `zhvi_zip_latest` (for the cutover). State that the median/polarity/top-N rollup stays in TS (R1).
4. **Backlog table naming.** `tourism-swfl` → `tourism-tdt`; note LAUS lives in `macro-swfl` (not a standalone). Add a "consuming brain must be live" gate column/note.
5. **Status line.** Update "First implementation" to `zhvi_pivoted` + `zhvi_zip_latest` + `app/charts/page.tsx`, and add a pointer to this build folder.

## Verification

- The spec no longer references `housing-swfl` as a ZHVI/ZORI consumer (`grep -n housing-swfl` on the spec returns only the Redfin-clarification note).
- `grep -rn "housing-swfl" docs/ | grep -i zhvi` returns nothing (no other doc carries the wrong mapping).
- The YoY SQL block matches §02's tolerance self-join verbatim.
- `tsc`/lints unaffected (doc-only).
