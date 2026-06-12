-- 20260612_zhvi_pivoted_views.sql
-- Pivoted-views build §02 — the SPINE. Two read-only views over data_lake.zhvi_swfl.
--
-- Companion plan: docs/superpowers/plans/2026-06-12-pivoted-views-build/02-zhvi-views.md
-- Adjudication (load-bearing corrections): .../00-ADJUDICATION.md
-- Risk register (silent-corruption traps these views must avoid): .../99-slug-coverage-and-risk-register.md
--
-- WHY TWO VIEWS (grain mismatch — adjudication R1):
--   A. data_lake.zhvi_pivoted    — wide display view for /charts (<ZHVIAreaChart>),
--      one row per month, city columns. YoY here is display-only / non-graded.
--   B. data_lake.zhvi_zip_latest — brain-input view, ONE ROW PER ZIP, emits exactly
--      the ZipSnapshot shape (refinery/packs/home-values-swfl.mts:37-47) so the
--      §05 cutover is a transparent source swap. The YoY/MoM faithfully replicate
--      the pack's lookbackObservation (home-values-swfl.mts:94-115): MAX-within-
--      ±7-days-of-target (NEWEST in window, NOT closest-to-target), NULL when no
--      partner row falls in the window. home_value is cast to float8 (a no-op —
--      the raw column is already double precision — kept explicit so the view's
--      arithmetic is provably the same double-precision math the JS pack does).
--      YoY/MoM are NOT rounded here: the pack medians over full precision and
--      rounds only at emit; pre-rounding would shift the median (silent·high #2).
--
-- VERIFIED AGAINST LIVE DB (RULE 3 C1) before authoring:
--   data_lake.zhvi_swfl: period_end IS date (not timestamptz → no tz pin needed),
--   home_value IS double precision, columns zip_code/metro/county_name/city present,
--   109 distinct ZIPs, 316 distinct months. City values 'Cape Coral'/'Fort Myers'/
--   'Naples' all present.
--
-- RUN THIS DIRECTLY (CLAUDE.md RULE 1) — a session runs migrations, the operator
-- does not. IDEMPOTENT + REVERSIBLE: CREATE OR REPLACE VIEW only; no table touched;
-- nothing consumes these views yet → zero live impact. Re-running is a no-op.
--
-- ACCESS: service_role ONLY — /charts is server-side (§03/§05) and the brain reads
-- data_lake with the service-role key. Add anon ONLY if a client-side reader is ever
-- introduced (risk register #15).

BEGIN;

-- ── A. Display view — data_lake.zhvi_pivoted (wide, ~1 row per month) ─────────
-- Levels per city per month for the area chart. Hard-coded city FILTERs go all-NULL
-- if Zillow renames a city (risk register #11) — the brain path (view B) is keyed
-- per-ZIP and is unaffected; review this city list on Zillow geography changes.
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

-- ── B. Brain-input view — data_lake.zhvi_zip_latest (one row per ZIP, ~109) ───
-- Per-ZIP DISTINCT ON latest anchor (each ZIP's YoY is anchored to that ZIP's own
-- latest period — matches the pack; NOT one global latest, risk register #8).
CREATE OR REPLACE VIEW data_lake.zhvi_zip_latest AS
WITH latest AS (
  SELECT DISTINCT ON (zip_code)
    zip_code, metro, county_name, city,
    period_end          AS latest_period,
    home_value::float8  AS home_value_latest
  FROM data_lake.zhvi_swfl
  ORDER BY zip_code, period_end DESC
)
SELECT
  l.zip_code, l.metro, l.county_name, l.city,
  l.latest_period, l.home_value_latest,
  -- 12-month YoY: NEWEST (MAX period_end) within ±7d of (latest − 12 months).
  -- ORDER BY period_end DESC LIMIT 1 inside the BETWEEN window == MAX-within-window
  -- == the pack's lookbackObservation selection. NULLIF(...,0) → NULL when the
  -- partner value is 0 (pack guards yearAgo.home_value > 0); no partner row in the
  -- window → the subquery is NULL → NULL YoY (pack returns null). Not rounded.
  ( l.home_value_latest
    / NULLIF((SELECT z.home_value::float8 FROM data_lake.zhvi_swfl z
               WHERE z.zip_code = l.zip_code
                 AND z.period_end BETWEEN l.latest_period - INTERVAL '12 months' - INTERVAL '7 days'
                                      AND l.latest_period - INTERVAL '12 months' + INTERVAL '7 days'
               ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100      AS value_yoy_pct,
  -- 1-month MoM: same rule, 1 month back.
  ( l.home_value_latest
    / NULLIF((SELECT z.home_value::float8 FROM data_lake.zhvi_swfl z
               WHERE z.zip_code = l.zip_code
                 AND z.period_end BETWEEN l.latest_period - INTERVAL '1 month' - INTERVAL '7 days'
                                      AND l.latest_period - INTERVAL '1 month' + INTERVAL '7 days'
               ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100      AS value_mom_pct
FROM latest l;

-- ── C. Grants (R2 — mandatory) ───────────────────────────────────────────────
GRANT SELECT ON data_lake.zhvi_pivoted    TO service_role;
GRANT SELECT ON data_lake.zhvi_zip_latest TO service_role;

COMMIT;

-- Views do NOT inherit table grants and PostgREST only exposes them to the
-- service-role client after a schema reload (risk register #9 — the 404 class).
NOTIFY pgrst, 'reload schema';

-- Verify after running:
--   SELECT count(*) FROM data_lake.zhvi_pivoted;      -- ~ months of history (>0)
--   SELECT count(*) FROM data_lake.zhvi_zip_latest;   -- ~109 ZIPs (>0)
--   -- plus a LIVE PostgREST read (not psql) of both to prove the grant landed.
