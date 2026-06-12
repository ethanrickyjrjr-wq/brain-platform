# §05 — GATE B + cutover (home-values-swfl)

**Model:** Opus (prod-critical path; fail-loud semantics; the OUTPUT contract must stay byte-stable for a downstream brain)
**Gate:** **§04 clean across 3 full cycles** (hard — do not flip on a partial/eyeballed pass). **Parallel with:** §06-other-DDL, §07. **Blocks:** nothing.
**Timing:** GATE A is 3 rebuild cycles, so on a nightly cadence this lands ≥3 days after §02 goes live.

## Why

Now `home-values-swfl` stops computing per-ZIP YoY in TS and reads `data_lake.zhvi_zip_latest` instead. The view becomes load-bearing, so the brain must fail loud if it's null, and the OUTPUT contract must not move (a downstream brain reads it).

## Build

1. **Swap the source, keep the rollup.** Replace the per-ZIP raw read + `buildZipSnapshot` loop with a read of `zhvi_zip_latest` (rows already in `ZipSnapshot` shape). **Keep `buildSnapshot`'s rollup, `classifyPolarity`, and top-N selection in TS unchanged** (R1 — the pack still decides what the number means). Only the per-ZIP derived math moved to SQL.
2. **Citation branches on `env.source` (R4).** Live → cite the view/source URL; fixture → the fixture path. Never hardcode a `data_lake.*` string. Mirror the existing `zhvi-source.mts` citation branch.
3. **GATE B — null-view = loud failure.** If the view returns null/empty (missing GRANT, empty partition), the brain MUST **throw / abort the build for that slug** — never emit a silent null where it previously computed a real value. Add an explicit guard + log.
4. **Preserve the OUTPUT contract byte-stable.** The `home_values_by_zip` detail_table (cell `home_value_zhvi`, `value_yoy_pct`, …) and every `key_metric` slug must be identical pre/post flip — `investor-zip-swfl` reads `home_values_by_zip.home_value_zhvi` through the thin pipe. GATE A part 4 already proved this; the cutover must not change it.
5. **Pagination discipline:** the brain-input view is ~109 rows (no paging needed), but if the reader ever uses `selectAllPaged`, pass `minRows` on the **live** branch only, never from fixture (`paginate.mts:50-54`).

## Then: ZORI / rentals-swfl

`rentals-swfl` is a structural clone (byte-identical `lookbackObservation`, `:94-115`). Repeat §02→§04→§05 for `zori_swfl` → `zori_zip_latest` → `rentals-swfl`, reusing the harness. (Its view DDL can be drafted in parallel with §02; only the cutover waits on the proven harness.)

## Verification

- After the flip, `metric_observations` for the boundary vintage matches pre-cutover within epsilon — **no forward seam** (§00, FLAG 4). The graded number didn't move.
- The full OUTPUT (key_metrics + detail_tables) is byte-identical pre/post → `investor-zip-swfl` rebuilds unchanged (rebuild it and diff its output).
- Force the view to null (revoke + reload, in a scratch run) → the build **aborts loudly** for the slug, does not emit an empty metric. Restore.
- `bun test refinery` + `tsc` clean; vocab unchanged (`--all` orphan check green — no new slug).
