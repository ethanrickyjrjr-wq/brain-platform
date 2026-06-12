# Pivoted Views Pattern — Design Spec
**Date:** 2026-06-12  
**Status:** APPROVED (LittleBird review complete, all flags closed)  
**First implementation:** `data_lake.zhvi_pivoted` (wide display view) + `data_lake.zhvi_zip_latest` (latest-per-ZIP brain-input view) + `app/charts/page.tsx`
**Build folder:** `docs/superpowers/plans/2026-06-12-pivoted-views-build/` (adjudicated, sectioned build plan — execute §01 spec corrections first)

---

## Problem

Brain packs currently fetch large raw tables (e.g. 19k rows from `data_lake.zhvi_swfl`),
pivot and aggregate in TypeScript, and compute derived metrics (YoY %, moving averages)
inline. This means:

- The same math runs twice if a chart page also needs it
- LLM synthesis (master) works on numbers the pack computed — math on the LLM path
- No single authoritative source for a derived number (chart vs brain can disagree silently)

---

## Architecture

```
data_lake.raw_table
  → data_lake.<brain>_pivoted   (math done ONCE — pure SQL, deterministic, cited)
    ├── /charts                  (reads view directly — display only, no new math)
    ├── brain pack               (reads view as input → key_metrics + detail_tables)
    │     └── detail_tables → L0 binder → brain report chart (established path)
    └── side-master (R&D)        (reads same views cold, diffed in public.checks)

master cross-correlates brain OUTPUTS only
— never raw tables, never /charts output, no DAG inversion
```

### What "math done once" means

The pivoted view is the single authoritative source for any derived number. `/charts`
reads it. The brain pack reads it and stops recomputing the same number. Master reads
brain output (which already consumed the view). No number is computed in two places.

---

## Rules (all load-bearing)

### R1 — Views emit pure math only
A pivoted view may only contain:
- Pivots: `AVG(CASE WHEN city = 'X' THEN col END)`
- Pure aggregations: AVG, COUNT, SUM, PERCENTILE_CONT, STDDEV
- Pure time-series math: `(current - prior) / prior` = a number, not a claim
- Window functions: LAG, LEAD, rolling averages over an ORDER BY

A pivoted view must NEVER contain:
- Directional/conditional columns: `trend = 'bullish'`, `signal = 'threshold_crossed'`
- Scored signals or labels
- Any column a human would interpret as a brain conclusion

Directional output re-enters the brain gate. The pack decides what a number means.

### R2 — GRANT + NOTIFY on every new view (no exceptions)
Views do NOT inherit grants from the schema or the underlying tables. After every
`CREATE OR REPLACE VIEW data_lake.<x>`:

```sql
GRANT SELECT ON data_lake.<x> TO authenticator, anon, service_role;
NOTIFY pgrst, 'reload schema';
```

Skipping this = view passes local test, 404s on live read (same failure class as the
FIPS/phantom-data incident). Add this to every view creation runbook step.

### R3 — Two consumers, one source (not two mechanisms)
- `/charts` reads the view directly → display-only path, no binder, no brain
- Brain report charts go through `detail_tables → L0 binder` (established path)

Same view, two consumers. The display path does not replace the binder path for brain
deliverable charts.

### R4 — Citation branches on env.source
When a brain pack reads a pivoted view, the citation must branch on `env.source`
(live vs fixture) — the same pattern as all other sources. Never hardcode a
`data_lake.*` path string. Phantom-data/citation lesson applies.

### R5 — Master never reads raw crossed numbers
Master cross-correlates domain signals only after reading individual brain OUTPUTS.
It never reads raw tables directly, never reads `/charts` output (DAG inversion),
never reads a view from a domain it doesn't own.

---

## Cutover Gates (transition only — applies when flipping a brain from self-compute to view-as-input)

### GATE A — Cutover parity (silent value-shift trap)
Before flipping any brain from "computes the number itself" to "reads view-as-input":

1. Run the view and the existing brain output in parallel for N periods (minimum 3 rebuild cycles)
2. Diff the numbers. If `view_value != brain_current_value` for any period, investigate before flipping
3. Only flip after the diff is clean

A silent value shift at cutover looks like "working" — both paths produce a number,
no error, but the live figure changed without an alert. This gate prevents that.

### GATE B — Null-view fail behavior (view is now load-bearing)
Once the brain stops self-computing, the view is on the prod critical path. Define
explicitly what the brain does when the view returns null (missing GRANT, empty raw
partition, unfilled ODD window):

- Brain MUST fail LOUD — throw, log, abort the build for that slug
- Brain MUST NOT emit a silent null where it previously computed a real value
- Required for any ODD-fed slug (ODD windows are moving targets — Standing Duty #6)

Null-view = loud failure. Never a silent empty metric.

---

## Side-Master Experiment (R&D — separate build)

A second master variant, fed the same pivoted views, run cold, outputs diffed against
real master in `public.checks`. Purpose: discover whether a better master+AI synthesis
is possible with pre-computed numeric inputs.

Rules:
- Reads pivoted views as inputs — never `/charts` output (DAG inversion)
- Never touches prod until N-period parity is explained
- Adjudicated in `public.checks` shadow/parity seam (locked 2026-06-03)
- Fail-open: if side-master errors, real master is unaffected

---

## First Implementation — ZHVI

**Two views, not one.** ZHVI's `/charts` display path and the brain-input cutover read at
*different grains* (wide-by-city for the chart vs. one-row-per-ZIP for the pack), so a single
view cannot serve both. Build:

- **`data_lake.zhvi_pivoted`** — wide **display view** (levels per city per month) for `/charts`.
  Display-only / non-graded; bucketed YoY is acceptable here.
- **`data_lake.zhvi_zip_latest`** — latest-per-ZIP **brain-input view** for the cutover, emitting
  exactly the `ZipSnapshot` shape (`home-values-swfl.mts:117-142`).

The median / polarity / top-N rollup **stays in TypeScript** (R1 — a view emits pure math only;
"which ZIPs are top-appreciating" and the headline polarity are pack conclusions, not view columns).
The brain-input view supplies per-ZIP levels + faithful YoY/MoM; the pack medians over the finite-YoY
subset (`home-values-swfl.mts:162-170`) and classifies polarity off that median.

Full SQL for both views (verbatim) lives in `docs/superpowers/plans/2026-06-12-pivoted-views-build/02-zhvi-views.md`.

### Display view — `data_lake.zhvi_pivoted`

```sql
CREATE OR REPLACE VIEW data_lake.zhvi_pivoted AS
SELECT
  to_char(period_end, 'YYYY-MM')                          AS month,
  AVG(home_value) FILTER (WHERE city = 'Cape Coral')      AS cape_coral,
  AVG(home_value) FILTER (WHERE city = 'Fort Myers')      AS fort_myers,
  AVG(home_value) FILTER (WHERE city = 'Naples')          AS naples
FROM data_lake.zhvi_swfl
WHERE city IN ('Cape Coral', 'Fort Myers', 'Naples')
GROUP BY to_char(period_end, 'YYYY-MM')
ORDER BY month;
```

### Brain-input view — `data_lake.zhvi_zip_latest` (the graded path)

The graded YoY/MoM must replicate the pack's calendar-honest lookback, **not** a row-offset `LAG`.
Row-offset `LAG(<col>, 12) OVER (ORDER BY month)` and bare month-bucketing both diverge from the pack
on a missing/drifted month (they agree only on today's month-end-aligned data — the fixture trap); the
graded view must replicate `lookbackObservation`'s MAX-within-±7-days rule (`home-values-swfl.mts:94-115`).

```sql
CREATE OR REPLACE VIEW data_lake.zhvi_zip_latest AS
WITH latest AS (
  SELECT DISTINCT ON (zip_code)
    zip_code, metro, county_name, city,
    period_end AS latest_period,
    home_value::float8 AS home_value_latest
  FROM data_lake.zhvi_swfl
  ORDER BY zip_code, period_end DESC
)
SELECT
  l.zip_code, l.metro, l.county_name, l.city,
  l.latest_period, l.home_value_latest,
  -- 12-month YoY: MAX(period_end) within ±7d of (latest − 12 months)
  ( l.home_value_latest
    / NULLIF((SELECT z.home_value::float8 FROM data_lake.zhvi_swfl z
               WHERE z.zip_code = l.zip_code
                 AND z.period_end BETWEEN l.latest_period - INTERVAL '12 months' - INTERVAL '7 days'
                                      AND l.latest_period - INTERVAL '12 months' + INTERVAL '7 days'
               ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100      AS value_yoy_pct,
  -- 1-month MoM: same rule, 1 month back
  ( l.home_value_latest
    / NULLIF((SELECT z.home_value::float8 FROM data_lake.zhvi_swfl z
               WHERE z.zip_code = l.zip_code
                 AND z.period_end BETWEEN l.latest_period - INTERVAL '1 month' - INTERVAL '7 days'
                                      AND l.latest_period - INTERVAL '1 month' + INTERVAL '7 days'
               ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100      AS value_mom_pct
FROM latest l;
```

`ORDER BY z.period_end DESC LIMIT 1` within the ±7-day window = MAX-within-window = the pack's exact
selection (newest in window, **not** closest-to-target). Cast to `float8` so the view does the same
double-precision arithmetic as the JS pack. **Do NOT round** YoY/MoM in the view — the pack medians
over full precision and rounds at emit; pre-rounding would shift the median.

Post-create (mandatory — both views):
```sql
GRANT SELECT ON data_lake.zhvi_pivoted    TO service_role;
GRANT SELECT ON data_lake.zhvi_zip_latest TO service_role;
NOTIFY pgrst, 'reload schema';
```

### Page

- Route: `app/charts/page.tsx` — Server Component, public, no auth
- Queries `data_lake.zhvi_pivoted` via service-role Supabase client
- Maps rows to `ZHVITrendEntry[]` (already matches column names)
- Passes to existing `<ZHVIAreaChart>` component (no changes to component)
- `asOf` = latest `month` in result set

### Brain pack cutover (home-values-swfl — deferred until GATE A passes)

The ZHVI consumer is **`home-values-swfl`** (slugs `home_value_zhvi_regional_median`,
`home_value_yoy_pct_regional_median`, the top-N per-ZIP slugs, …) — it reads `data_lake.zhvi_swfl`
and pivots/aggregates in TS today. The ZORI consumer is **`rentals-swfl`** (slugs
`rental_rent_index_zori_regional_median`, `rental_rent_yoy_pct_regional_median`, …).

> **Not the Redfin brain.** `housing-swfl` is the **Redfin** brain (sale price / DOM /
> months-of-supply — slugs `housing_median_sale_price_swfl`, `housing_median_dom_swfl`,
> `housing_months_of_supply_swfl`). It does **not** consume ZHVI/ZORI and is **not** in this backlog.
> A separate `housing-swfl` (Redfin) view is a future effort if ever wanted.

Cutover steps (per consumer):
- Cut `home-values-swfl` against `zhvi_zip_latest` first; `rentals-swfl` follows the same runbook
  against its own `zori_zip_latest` view (built in a later section).
- Run the brain-input view and current pack output in parallel for 3 rebuild cycles (GATE A)
- Diff the per-ZIP `value_yoy_pct` / `value_mom_pct` and the rolled-up regional-median slug per cycle
- Flip only after the diff is clean ×3

> `investor-zip-swfl` is a downstream thin-pipe OUTPUT consumer (`makeBrainInputSource`) — it reads
> `home-values-swfl` / `rentals-swfl` OUTPUTS, not raw ZHVI, so the cutover propagates transparently;
> GATE A must hold the `home_values_by_zip.home_value_zhvi` detail-table contract byte-stable.

---

## Runbook — Adding a new pivoted view

1. Identify the raw table and the math needed (pure aggregation only — R1)
2. Write `CREATE OR REPLACE VIEW data_lake.<brain>_pivoted AS ...`
3. Run the view locally, verify row count and column values against raw table
4. Run: `GRANT SELECT ON data_lake.<brain>_pivoted TO authenticator, anon, service_role; NOTIFY pgrst, 'reload schema';`
5. Verify live read via PostgREST (not just local Postgres connection)
6. If wiring to a brain pack: run GATE A parity check for N periods before flipping
7. Define GATE B null behavior in the pack before removing self-compute

---

## Brains that benefit from this pattern (backlog)

| Consuming brain | Raw table | Key math to move | Consuming brain live? |
|---|---|---|---|
| home-values-swfl | zhvi_swfl | YoY % / MoM per ZIP, regional median | yes |
| rentals-swfl | zori_swfl | Rent YoY / MoM per ZIP, regional median | yes |
| macro-swfl | bls_laus | Unemployment rate trend, MoM (LAUS lives in `macro-swfl`, not a standalone brain) | yes |
| labor-demand-swfl | bls_oews_swfl | Wage YoY per occupation | yes |
| tourism-tdt | tdt_swfl | Tourism revenue YoY | **not confirmed** — TDT self-ingest migration/backfill pending; view stays display-only until live |
| env-swfl | noaa_ghcn_rainfall | 30-day rolling, seasonal deviation | yes |

> **Consuming-brain-live gate.** Registration ≠ live. A `*_pivoted` / brain-input view may be built
> for `/charts` (display-only) before its consuming brain emits, but the **brain cutover** (view-as-input,
> GATE A) only runs once the consuming brain is actually emitting its slugs. `tourism-tdt` is registered
> but not yet emitting `metric:` literals — its view stays display-only until the TDT ingest lands.

Priority: ZHVI first (`zhvi_pivoted` + `zhvi_zip_latest` + `/charts` page). Others follow the same runbook.
