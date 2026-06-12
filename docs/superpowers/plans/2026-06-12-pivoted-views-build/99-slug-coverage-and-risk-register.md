# §99 — Slug coverage + risk register (reference)

## Slug coverage

**A cutover does not change which slugs a pack emits** — it changes the *source* of the number (SQL view vs in-TS loop). So **no `brain-vocabulary.json` change and no orphan-linter impact** for a cutover. The build keeps every slug below identical and registers nothing new. *Exception:* if a view ever exposes a **new** derived series that becomes a new slug, register it in `brain-vocabulary.json` in the **same commit** (ship-contract-together; `--all` is the gate).

| Brain (real consumer) | Series | Slugs (kept identical across cutover) |
|---|---|---|
| **home-values-swfl** (ZHVI) | `zhvi_swfl` | `home_value_zhvi_regional_median`, `home_value_yoy_pct_regional_median`, `home_values_zips_covered`, `home_value_yoy_pct_top_appreciating_zips` (string ranking), `home_value_yoy_pct_zip_${zip}`, `home_value_zhvi_zip_${zip}` (dynamic top-N) |
| **rentals-swfl** (ZORI) | `zori_swfl` | `rental_rent_index_zori_regional_median`, `rental_rent_yoy_pct_regional_median`, `rentals_swfl_zips_covered`, `rental_rent_yoy_pct_top_heating_zips` (string), `rental_rent_yoy_pct_zip_${zip}`, `rental_rent_index_zori_zip_${zip}` (dynamic top-N) |
| **macro-swfl** (LAUS+QCEW) | `bls_laus`, `bls_qcew` | `laus_{lee,collier,fl}_unemployment_rate`, `laus_lee_unemployment_rate_yoy_delta`; `qcew_{lee,collier}_private_avg_wkly_wage(_yoy_pct)`, `qcew_{lee,collier}_private_employment` (QCEW conditional) |
| **labor-demand-swfl** (OEWS) | `bls_oews_swfl` | `${areaTag}_top_occupation_employment`, `${areaTag}_construction_loc_quotient`, `${areaTag}_healthcare_employment`, `${areaTag}_construction_median_hourly_wage`, `${areaTag}_total_employment_yoy_pct` |
| **tourism-tdt** (TDT) | `tdt_swfl` | **GATED — not confirmed live-emitting.** Confirm slug set at build; display-only until live. No capture. |
| **env-swfl** (rainfall) | `noaa_ghcn_rainfall` | `env_rainfall_swfl_annual_in` (+ confirm seasonal-deviation slugs); flood slugs `swfl_zip_*_flood_*` untouched |

**Downstream (auto-inherits cutover):** `investor-zip-swfl` reads `home-values-swfl` + `rentals-swfl` OUTPUTS via the thin pipe — needs no separate cutover; depends on the detail_table contract `home_values_by_zip.home_value_zhvi` / `rentals_by_zip.rent_index_latest` (GATE A part 4 holds it byte-stable). **Not** in this backlog: `housing-swfl` (Redfin).

## Risk register (ranked by silent-corruption severity)

1. **[SILENT·HIGH] YoY period-matching** — `LAG(…,12)` (row offset) *and* bare month-bucketing both diverge from the pack on a missing/drifted month. *Fix:* faithful 7-day-tolerance `MAX`-within-window self-join (§02); §04 equivalence test.
2. **[SILENT·HIGH] Aggregation mismatch** — view `AVG`-over-cities vs pack `median`-over-finite-YoY-subset would change the headline `*_regional_yoy_pct`, possibly crossing a polarity band. *Fix:* rollup stays in TS; §04 recomputes + diffs the median.
3. **[SILENT·HIGH] Top-N ranking flip** — a sub-epsilon tie changes which `*_zip_*` slugs exist → `metric_observations` grades a different series set. *Fix:* §04 slug-SET equality.
4. **[SILENT·HIGH] Detail_table contract break** — a renamed/dropped cell silently starves `investor-zip-swfl`. *Fix:* §04 part 4 diffs cell names + values; §05 holds the OUTPUT contract byte-stable.
5. **[SILENT·HIGH] Premature `BACKTESTABLE` flip** — grading ZHVI/ZORI before vintages exist = near-zero-N phantom grades. *Fix:* §08c gated on ~9mo real history; reports N + caveat; never in §08a.
6. **[SILENT·MED] Forward cutover seam** — `refined_at` is wall-clock (`4-output.mts:355`), so a cutover writes a new observation for the same month. Grading immunity is *retroactive-only*; it does NOT cover this. *Fix:* GATE A clean ×3, machine-diffed (the only defense).
7. **[SILENT·MED] PostgREST 1000-row truncation** — a bare `.select()` on a long view silently renders 1000. *Fix:* brain path uses the ~109-row latest-per-ZIP view; any all-months reader uses `selectAllPaged`, `minRows` live-branch-only.
8. **[SILENT·MED] `regional_latest_period` anchor skew** — pack anchors each ZIP's YoY to that ZIP's own latest; a view anchoring to one global latest mis-anchors laggards. *Fix:* per-ZIP `DISTINCT ON` latest in the view; §04 surfaces mismatch.
9. **[LOUD·MED] Missing GRANT/NOTIFY → 404** — views don't inherit grants. *Fix:* R2 in every runbook step; verify via live PostgREST read; §07 catches regressions.
10. **[ROADMAP-HYGIENE] View without a live consuming brain** — `tourism-tdt`. *Fix:* §06 consuming-brain-live hard gate; else display-only.
11. **[FUTURE-DATA] Zillow adds/removes/renames a city or ZIP** — a hard-coded wide-pivot `FILTER (WHERE city=…)` silently goes all-NULL. *Mitigation:* brain path is keyed per-ZIP; coverage/row-count check; review the display view's city list on Zillow geography changes.
12. **[FUTURE-DATA] YoY equivalence drift** — SQL vs pack agree today only because Zillow ships one month-end-aligned row per ZIP per month. *Mitigation:* tolerance port (not bucketing) + a one-row-per-zip-per-month tripwire; §04's two-rows-in-window test is the standing guard.
13. **[FUTURE-DATA] More series/rows** — runbook scales linearly; `view_vintages` grows ~1 row per (view, period, series_key)/month, indexed `(view_name, as_of)`. View renames break vintage continuity → views manifest + §07 liveness.
14. **[FUTURE-DATA] DST/timezone** — if `period_end` becomes `timestamptz`, pin a timezone or a month shifts. *Mitigation:* bucket on the date; assert column type (§02).
15. **[DECISION·LOW] `anon` grant** — widens the public REST surface; `/charts` is server-side so it's unneeded. *Default:* `service_role` only.
