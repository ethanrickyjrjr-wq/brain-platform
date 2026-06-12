-- 20260612_zori_pivoted_views.sql
-- Pivoted-views build §06 (ZORI series) — clones §02 (the PROVEN ZHVI spine).
-- Two read-only views over data_lake.zori_swfl.
--
-- Companion plan: docs/superpowers/plans/2026-06-12-pivoted-views-build/06-additional-views.md
-- ZHVI template (proven): docs/sql/20260612_zhvi_pivoted_views.sql
-- Adjudication (load-bearing corrections): .../00-ADJUDICATION.md
-- Risk register (silent-corruption traps these views must avoid): .../99-slug-coverage-and-risk-register.md
--
-- WHY TWO VIEWS (grain mismatch — adjudication R1):
--   A. data_lake.zori_pivoted    — wide display view for /charts, one row per
--      month, city columns (per-city monthly rent levels). YoY here is display-only.
--   B. data_lake.zori_zip_latest — brain-input view, ONE ROW PER ZIP, emits exactly
--      the ZipSnapshot shape (refinery/packs/rentals-swfl.mts:37-47) so a later
--      cutover is a transparent source swap. The YoY/MoM faithfully replicate the
--      pack's lookbackObservation (rentals-swfl.mts:94-115 — byte-identical to ZHVI's):
--      MAX-within-±7-days-of-target (NEWEST in window, NOT closest-to-target),
--      NULL when no partner row falls in the window.
--      rent_index is cast to float8. YoY/MoM are NOT rounded here: the pack medians
--      over full precision and rounds only at emit; pre-rounding would shift the
--      median (silent-corruption #2).
--
-- VERIFIED AGAINST LIVE DB (RULE 3 C1) before authoring — DEVIATIONS FROM ZHVI:
--   * The rent value column is `rent_index` (NOT ZHVI's `home_value`). The pack
--     reads exactly this column (rentals-swfl source .select(), zori-source.mts:58).
--   * `rent_index` IS `numeric` (arbitrary precision; ZHVI's `home_value` was already
--     `double precision`). The `::float8` cast here is therefore a REAL cast, not a
--     no-op — it rounds the decimal numeric to the nearest IEEE-754 double. This is
--     IDENTICAL to what the JS pack receives: PostgREST serializes `numeric` to a
--     JSON number which JS parses to a float8 double; verified live that
--     `rent_index::float8` == the PostgREST-served JS number EXACTLY for every sampled
--     row. So the view's float8 arithmetic is provably the same double-precision math
--     the JS pack does (residual 0.0 on the raw value).
--   * period_end IS date (not timestamptz → no tz pin needed). zip_code/metro/
--     county_name/city all present.
--   * 94 distinct ZIPs, 136 distinct months, 5185 rows. Median rent ~$1,966/month,
--     range ~$714–$14,703/month (the ~$2k scale — NOT ZHVI's ~$350k).
--
-- RUN THIS DIRECTLY (CLAUDE.md RULE 1). IDEMPOTENT + REVERSIBLE: CREATE OR REPLACE
-- VIEW only; no table touched; nothing consumes these views yet (rentals-swfl is
-- UNMODIFIED, still self-computes) → zero live impact. Re-running is a no-op.
--
-- ACCESS: service_role ONLY — /charts is server-side and the brain reads data_lake
-- with the service-role key. Add anon ONLY if a client-side reader is introduced.

BEGIN;

-- ── A. Display view — data_lake.zori_pivoted (wide, ~1 row per month) ─────────
-- Per-city monthly rent levels for the area chart. Hard-coded city FILTERs go
-- all-NULL if Zillow renames a city (risk register #11) — the brain path (view B)
-- is keyed per-ZIP and is unaffected; review this city list on Zillow geography
-- changes. (Mirrors zhvi_pivoted's city set; same three SWFL cities.)
CREATE OR REPLACE VIEW data_lake.zori_pivoted AS
SELECT
  to_char(period_end, 'YYYY-MM')                          AS month,
  AVG(rent_index) FILTER (WHERE city = 'Cape Coral')      AS cape_coral,
  AVG(rent_index) FILTER (WHERE city = 'Fort Myers')      AS fort_myers,
  AVG(rent_index) FILTER (WHERE city = 'Naples')          AS naples
FROM data_lake.zori_swfl
WHERE city IN ('Cape Coral', 'Fort Myers', 'Naples')
GROUP BY to_char(period_end, 'YYYY-MM')
ORDER BY month;

-- ── B. Brain-input view — data_lake.zori_zip_latest (one row per ZIP, ~94) ────
-- Per-ZIP DISTINCT ON latest anchor (each ZIP's YoY is anchored to that ZIP's own
-- latest period — matches the pack; NOT one global latest, risk register #8).
-- Column names mirror rentals-swfl's ZipSnapshot: rent_index_latest, rent_yoy_pct,
-- rent_mom_pct (NOT ZHVI's home_value_latest / value_yoy_pct / value_mom_pct).
CREATE OR REPLACE VIEW data_lake.zori_zip_latest AS
WITH latest AS (
  SELECT DISTINCT ON (zip_code)
    zip_code, metro, county_name, city,
    period_end          AS latest_period,
    rent_index::float8  AS rent_index_latest
  FROM data_lake.zori_swfl
  ORDER BY zip_code, period_end DESC
)
SELECT
  l.zip_code, l.metro, l.county_name, l.city,
  l.latest_period, l.rent_index_latest,
  -- 12-month YoY: NEWEST (MAX period_end) within ±7d of (latest − 12 months).
  -- ORDER BY period_end DESC LIMIT 1 inside the BETWEEN window == MAX-within-window
  -- == the pack's lookbackObservation selection. NULLIF(...,0) → NULL when the
  -- partner value is 0 (pack guards yearAgo.rent_index > 0); no partner row in the
  -- window → the subquery is NULL → NULL YoY (pack returns null). Not rounded.
  ( l.rent_index_latest
    / NULLIF((SELECT z.rent_index::float8 FROM data_lake.zori_swfl z
               WHERE z.zip_code = l.zip_code
                 AND z.period_end BETWEEN l.latest_period - INTERVAL '12 months' - INTERVAL '7 days'
                                      AND l.latest_period - INTERVAL '12 months' + INTERVAL '7 days'
               ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100      AS rent_yoy_pct,
  -- 1-month MoM: same rule, 1 month back.
  ( l.rent_index_latest
    / NULLIF((SELECT z.rent_index::float8 FROM data_lake.zori_swfl z
               WHERE z.zip_code = l.zip_code
                 AND z.period_end BETWEEN l.latest_period - INTERVAL '1 month' - INTERVAL '7 days'
                                      AND l.latest_period - INTERVAL '1 month' + INTERVAL '7 days'
               ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100      AS rent_mom_pct
FROM latest l;

-- ── C. Grants (R2 — mandatory) ───────────────────────────────────────────────
GRANT SELECT ON data_lake.zori_pivoted    TO service_role;
GRANT SELECT ON data_lake.zori_zip_latest TO service_role;

COMMIT;

-- Views do NOT inherit table grants and PostgREST only exposes them to the
-- service-role client after a schema reload (risk register #9 — the 404 class).
NOTIFY pgrst, 'reload schema';

-- Verify after running:
--   SELECT count(*) FROM data_lake.zori_pivoted;      -- ~ months of history (>0)
--   SELECT count(*) FROM data_lake.zori_zip_latest;   -- ~94 ZIPs (>0)
--   -- plus a LIVE PostgREST read (not psql) of both to prove the grant landed.
