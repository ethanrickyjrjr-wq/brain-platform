# §02 — ZHVI views (the spine)

**Model:** Opus (the calendar-honest YoY is the silent-corruption trap; get the `MAX`-within-window rule and the float8 casting exactly right)
**Gate:** raw `data_lake.zhvi_swfl` exists (it does). **Blocks** §03, §04, §06-cutover, §08-capture.
**Parallel with:** §01, §07, §08a.
**Commit the SQL** under `docs/sql/20260612_zhvi_pivoted_views.sql` (mirror the existing migration style — `BEGIN; … COMMIT;`, `CREATE OR REPLACE VIEW`, idempotent).

## Build two views

### A. Display view — `data_lake.zhvi_pivoted` (for `/charts`, wide, ~24 rows)

Levels per city per month for `<ZHVIAreaChart>`. Confirm the `ZHVITrendEntry` shape in `types/viz` before finalizing columns. YoY here is **display-only / non-graded** — bucketing is acceptable, but prefer the same tolerance rule for consistency if cheap.

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

### B. Brain-input view — `data_lake.zhvi_zip_latest` (for the cutover, one row per ZIP, ~109 rows)

Emits exactly the `ZipSnapshot` shape (`home-values-swfl.mts:132-141`). YoY/MoM use the **faithful 7-day-tolerance `MAX`-within-window** rule — confirmed against `lookbackObservation` (`:94-115`): newest observation within ±7 days of the target, **not** closest-to-target. Cast to `float8` so the view does the same double-precision arithmetic as the JS pack. **Do NOT round** YoY/MoM here — the pack's rollup medians over full precision and rounds at emit; pre-rounding would shift the median.

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

`ORDER BY z.period_end DESC LIMIT 1` within the ±7-day window = MAX-within-window = the pack's exact selection. `NULLIF(...,0)` → `NULL` YoY when no partner (matches the pack's `null`).

### C. Grants (R2 — mandatory, no exceptions)

```sql
GRANT SELECT ON data_lake.zhvi_pivoted   TO service_role;
GRANT SELECT ON data_lake.zhvi_zip_latest TO service_role;
NOTIFY pgrst, 'reload schema';
```

`service_role` only — `/charts` is server-side (§03/§05). Add `anon` only if a client-side reader is ever introduced. Run the migration directly (creds in `.dlt/secrets.toml`, psycopg3, idempotent), never hand it to the operator.

## Verification

- **Row counts:** `zhvi_pivoted` ≈ months of history; `zhvi_zip_latest` ≈ ZIP count (~109). Both > 0.
- **Live PostgREST read** (not psql) for both views after GRANT/NOTIFY — proves the grant landed (the 404 class).
- **Equivalence test (the load-bearing one):** for a sample of ZIPs, the view's `value_yoy_pct` == the pack's `buildZipSnapshot` YoY. Run it on three crafted cases: (1) a **gapped** ZIP (missing the 12-months-ago month → both NULL), (2) a **>7-day-drifted** row (outside tolerance → both NULL), (3) a **two-rows-in-±7d-window** ZIP (both pick the newer = MAX, not the closer). All three agree.
- **Spot-check** 3 months of YoY by hand against `data_lake.zhvi_swfl`.
- **DST/type guard:** confirm `period_end` is a `date` (not `timestamptz`); if ever `timestamptz`, pin a timezone in the bucket.
