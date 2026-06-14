-- 20260614_tier_divergence_views.sql
-- tier-divergence-swfl (the K-Shaped Market indicator) — two read-only views
-- over data_lake.tier_divergence_swfl.
--
-- Design spec: docs/superpowers/specs/2026-06-14-tier-divergence-swfl-design.md (§4.3)
-- Pairs with (does NOT touch): seller-stress-swfl.
--
-- WHY TWO VIEWS (grain mismatch — mirrors the zhvi_pivoted split):
--   A. data_lake.tier_divergence_pivoted    — display view, ONE ROW PER MONTH:
--      the regional median top/bottom spread ratio + the count of both-tier ZIPs.
--      Display-only / non-graded.
--   B. data_lake.tier_divergence_zip_latest — brain-input view, ONE ROW PER
--      both-tier ZIP (~107). Anchor = each ZIP's latest period where BOTH tiers
--      are non-null. All three YoY columns faithfully replicate the ZHVI pack's
--      lookbackObservation rule: MAX-within-±7-days-of-target (NEWEST in window,
--      NOT closest-to-target), NULL when no partner row falls in the window.
--      Values are cast to float8 (a no-op — the raw columns are already double
--      precision — kept explicit so the view's arithmetic is provably the same
--      double-precision math the JS oracle does). YoY is NOT rounded here: the
--      pack medians over full precision and rounds only at emit; pre-rounding
--      would shift the median.
--
-- POLARITY NOTE (NOT enforced in SQL — the brain owns polarity, spec §5.1):
--   the view emits raw signed YoY %; rising tier_spread_yoy / falling bottom_yoy
--   are BEARISH drivers in the pack, and top_yoy is informational-only. The view
--   makes no directional claim — it is pure arithmetic.
--
-- RAW (not seasonally adjusted): the underlying tier index has no `_sm_sa`
--   variant; YoY (used here) cancels seasonality by construction. Level/MoM are
--   seasonally noisy and are intentionally NOT emitted by view B.
--
-- RUN THIS DIRECTLY (CLAUDE.md RULE 1) — a session runs migrations, the operator
-- does not. IDEMPOTENT + REVERSIBLE: CREATE OR REPLACE VIEW only; no table
-- touched; nothing consumes these views yet → zero live impact. Re-running is a
-- no-op.
--
-- ACCESS: service_role ONLY — the brain reads data_lake with the service-role
-- key. Add anon ONLY if a client-side reader is ever introduced.

BEGIN;

-- ── A. Display view — data_lake.tier_divergence_pivoted (one row per month) ───
-- Regional median luxury/starter spread ratio + both-tier ZIP count per month.
-- Both-present filter: only months/ZIPs where BOTH tiers are non-null contribute
-- (a spread ratio is undefined otherwise). percentile_cont(0.5) is the median.
--
-- median_top_tier / median_bottom_tier (added 2026-06-14 for the /charts indexed
-- two-line panel): the regional median of EACH tier's raw value per month — the
-- monthly medians the chart indexes to 100 at a base month. NOTE these are NOT
-- algebraically tied to median_spread_ratio: median(top/bottom) ≠ median(top) /
-- median(bottom). The ratio is the median of per-ZIP spreads; these are the
-- medians of each tier's level. Both are honest, different cuts.
--
-- COLUMN ORDER MATTERS: the two new columns are APPENDED after both_tier_zip_count.
-- Postgres CREATE OR REPLACE VIEW can only add columns at the END — inserting them
-- mid-list makes it try to RENAME the existing trailing column and aborts
-- ("cannot change name of view column ..."). Consumers select by name, so trailing
-- position is irrelevant to them.
CREATE OR REPLACE VIEW data_lake.tier_divergence_pivoted AS
SELECT
  to_char(period_end, 'YYYY-MM')                                          AS month,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY top_tier_value::float8 / NULLIF(bottom_tier_value::float8, 0)
  )                                                                        AS median_spread_ratio,
  count(*)                                                                 AS both_tier_zip_count,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY top_tier_value::float8
  )                                                                        AS median_top_tier,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY bottom_tier_value::float8
  )                                                                        AS median_bottom_tier
FROM data_lake.tier_divergence_swfl
WHERE top_tier_value IS NOT NULL
  AND bottom_tier_value IS NOT NULL
GROUP BY to_char(period_end, 'YYYY-MM')
ORDER BY month;

-- ── B. Brain-input view — data_lake.tier_divergence_zip_latest (~107 ZIPs) ────
-- Per-ZIP DISTINCT ON latest BOTH-tier anchor (each ZIP's YoY is anchored to
-- that ZIP's own latest both-present period — NOT one global latest). ZIPs that
-- never carry both tiers (e.g. starter-less 33972/33974) never appear — they
-- have no both-present anchor row, so DISTINCT ON yields nothing for them.
CREATE OR REPLACE VIEW data_lake.tier_divergence_zip_latest AS
WITH latest AS (
  SELECT DISTINCT ON (zip_code)
    zip_code, metro, county_name, city,
    period_end                  AS latest_period,
    top_tier_value::float8      AS top_tier_value_latest,
    bottom_tier_value::float8   AS bottom_tier_value_latest
  FROM data_lake.tier_divergence_swfl
  WHERE top_tier_value IS NOT NULL
    AND bottom_tier_value IS NOT NULL
  ORDER BY zip_code, period_end DESC
),
-- 3-CALENDAR-month trailing average of each tier's RAW value (anchor month + the 2
-- preceding calendar months). The tier index is RAW (not seasonally adjusted), so the
-- spread LEVEL is smoothed to a 3-month trailing mean (mitigates raw single-month
-- noise). The YoY columns below stay on RAW monthly values — YoY already cancels
-- seasonality, and smoothing it would add lag.
-- WINDOW = date_trunc('month', period_end) > date_trunc('month', latest_period) - 3mo:
-- calendar-bounded, NOT a sliding `- 3 months - 7 days` interval. The interval form
-- silently averaged a 4th calendar month at a 30-day anchor (Apr-30 → Jan..Apr) because
-- `Apr-30 - 3mo = Jan-30 < Jan-31`; the calendar form yields exactly {Feb,Mar,Apr}, and
-- on a gapped interior month averages only the rows present in the trailing 3 calendar
-- months (honest partial mean) rather than reaching back a 4th. (Window-bug fix,
-- tier-divergence review, 2026-06-14; the JS oracle mirrors this verbatim.)
smoothed AS (
  SELECT l.*,
    (SELECT AVG(z.top_tier_value::float8) FROM data_lake.tier_divergence_swfl z
      WHERE z.zip_code = l.zip_code AND z.top_tier_value IS NOT NULL
        AND z.period_end <= l.latest_period
        AND date_trunc('month', z.period_end) > date_trunc('month', l.latest_period) - INTERVAL '3 months'
    )                                                                      AS top_tier_value_3m_avg,
    (SELECT AVG(z.bottom_tier_value::float8) FROM data_lake.tier_divergence_swfl z
      WHERE z.zip_code = l.zip_code AND z.bottom_tier_value IS NOT NULL
        AND z.period_end <= l.latest_period
        AND date_trunc('month', z.period_end) > date_trunc('month', l.latest_period) - INTERVAL '3 months'
    )                                                                      AS bottom_tier_value_3m_avg
  FROM latest l
)
SELECT
  s.zip_code, s.metro, s.county_name, s.city,
  s.latest_period,
  s.top_tier_value_latest,
  s.bottom_tier_value_latest,
  s.top_tier_value_3m_avg,
  s.bottom_tier_value_3m_avg,
  -- LEVEL: spread ratio from the 3-month trailing averages (SMOOTHED). NULLIF guards a
  -- zero starter. This is the only metric that uses the smoothed inputs.
  s.top_tier_value_3m_avg / NULLIF(s.bottom_tier_value_3m_avg, 0)         AS tier_spread_ratio,
  -- Spread YoY %: RAW latest spread vs RAW both-present spread within ±7d of
  -- (latest − 12 months). NEWEST row in window (ORDER BY period_end DESC LIMIT 1 inside
  -- the BETWEEN == MAX-within-window). NOT smoothed. NULL when no both-present partner.
  ( (s.top_tier_value_latest / NULLIF(s.bottom_tier_value_latest, 0))
    / NULLIF((SELECT z.top_tier_value::float8 / NULLIF(z.bottom_tier_value::float8, 0)
                FROM data_lake.tier_divergence_swfl z
               WHERE z.zip_code = s.zip_code
                 AND z.top_tier_value IS NOT NULL
                 AND z.bottom_tier_value IS NOT NULL
                 AND z.period_end BETWEEN s.latest_period - INTERVAL '12 months' - INTERVAL '7 days'
                                      AND s.latest_period - INTERVAL '12 months' + INTERVAL '7 days'
               ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100         AS tier_spread_yoy_pct,
  -- Bottom-tier YoY %: RAW, lookback in the BOTTOM-NON-NULL series, anchored to the SAME
  -- latest_period. ±7d MAX-window.
  ( s.bottom_tier_value_latest
    / NULLIF((SELECT z.bottom_tier_value::float8
                FROM data_lake.tier_divergence_swfl z
               WHERE z.zip_code = s.zip_code
                 AND z.bottom_tier_value IS NOT NULL
                 AND z.period_end BETWEEN s.latest_period - INTERVAL '12 months' - INTERVAL '7 days'
                                      AND s.latest_period - INTERVAL '12 months' + INTERVAL '7 days'
               ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100         AS bottom_tier_yoy_pct,
  -- Top-tier YoY %: RAW, lookback in the TOP-NON-NULL series, anchored to the SAME
  -- latest_period. ±7d MAX-window.
  ( s.top_tier_value_latest
    / NULLIF((SELECT z.top_tier_value::float8
                FROM data_lake.tier_divergence_swfl z
               WHERE z.zip_code = s.zip_code
                 AND z.top_tier_value IS NOT NULL
                 AND z.period_end BETWEEN s.latest_period - INTERVAL '12 months' - INTERVAL '7 days'
                                      AND s.latest_period - INTERVAL '12 months' + INTERVAL '7 days'
               ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100         AS top_tier_yoy_pct,
  -- Prior-month YoY columns — enable MoM K-shape direction (rising/falling/stable).
  -- Each compares the tier value at (latest_period − 1 month ±7d) to the same tier
  -- at (latest_period − 13 months ±7d). Same MAX-within-window logic as the current-
  -- period YoY columns above. NULL when either anchor is absent.
  ( (SELECT z.top_tier_value::float8
       FROM data_lake.tier_divergence_swfl z
      WHERE z.zip_code = s.zip_code
        AND z.top_tier_value IS NOT NULL
        AND z.period_end BETWEEN s.latest_period - INTERVAL '1 month' - INTERVAL '7 days'
                             AND s.latest_period - INTERVAL '1 month' + INTERVAL '7 days'
      ORDER BY z.period_end DESC LIMIT 1)
    / NULLIF(
      (SELECT z.top_tier_value::float8
         FROM data_lake.tier_divergence_swfl z
        WHERE z.zip_code = s.zip_code
          AND z.top_tier_value IS NOT NULL
          AND z.period_end BETWEEN s.latest_period - INTERVAL '13 months' - INTERVAL '7 days'
                               AND s.latest_period - INTERVAL '13 months' + INTERVAL '7 days'
        ORDER BY z.period_end DESC LIMIT 1)
    , 0) - 1) * 100                                                        AS top_tier_yoy_prior_month_pct,
  ( (SELECT z.bottom_tier_value::float8
       FROM data_lake.tier_divergence_swfl z
      WHERE z.zip_code = s.zip_code
        AND z.bottom_tier_value IS NOT NULL
        AND z.period_end BETWEEN s.latest_period - INTERVAL '1 month' - INTERVAL '7 days'
                             AND s.latest_period - INTERVAL '1 month' + INTERVAL '7 days'
      ORDER BY z.period_end DESC LIMIT 1)
    / NULLIF(
      (SELECT z.bottom_tier_value::float8
         FROM data_lake.tier_divergence_swfl z
        WHERE z.zip_code = s.zip_code
          AND z.bottom_tier_value IS NOT NULL
          AND z.period_end BETWEEN s.latest_period - INTERVAL '13 months' - INTERVAL '7 days'
                               AND s.latest_period - INTERVAL '13 months' + INTERVAL '7 days'
        ORDER BY z.period_end DESC LIMIT 1)
    , 0) - 1) * 100                                                        AS bottom_tier_yoy_prior_month_pct
FROM smoothed s;

-- ── C. Grants (mandatory) ─────────────────────────────────────────────────────
GRANT SELECT ON data_lake.tier_divergence_pivoted    TO service_role;
GRANT SELECT ON data_lake.tier_divergence_zip_latest TO service_role;

COMMIT;

-- Views do NOT inherit table grants and PostgREST only exposes them to the
-- service-role client after a schema reload (the 404 class) — reload here.
NOTIFY pgrst, 'reload schema';

-- Verify after running:
--   SELECT count(*) FROM data_lake.tier_divergence_pivoted;     -- ~ months of history (>0)
--   SELECT count(*) FROM data_lake.tier_divergence_zip_latest;  -- ~107 both-tier ZIPs (>0)
--   -- plus a LIVE PostgREST read (not psql) of both to prove the grant landed.
