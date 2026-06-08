-- Glass §3 read views — GRANT service_role ONLY (never anon: internal accuracy page)
-- Apply via psycopg3 using creds from brain-platform/.dlt/secrets.toml
--
-- VETTED by brain-platform/Opus 2026-06-08 (Opus owns backtest_grades). View 2
-- (calibration) approved as-authored. View 1 (skill-over-time) CORRECTED: the
-- original "modal-direction baseline" (GREATEST(P(bullish),P(bearish))) is NOT the
-- persistence-null the rest of the system uses, so its `lift` was non-comparable and
-- would contradict §2's canonical -6.5pp. Replaced with the LAG-based persistence-null
-- — identical semantics to refinery/lib/backtest/skill-baseline.mts computeSkillScore
-- and public.backtest_skill_by_slug. Reconciled n-weighted to the TS scorer
-- (138 / 0.4203 / 0.4855 / -0.0652).
--
-- Prerequisites:
--   • backtest_grades table exists (§2 migration applied, 144 rows)
--   • outcomes table exists (docs/sql/20260601_grade_predictions.sql)
--   • outcomes.prediction_id → predictions.id FK exists
--   • backtest_grades columns (verified live): slug, as_of_date, predicted_direction,
--     observed_direction, grade ('hit'|'miss'|'partial'|'neutral'), confidence,
--     grade_method

-- ── View 1: Skill over time ────────────────────────────────────────────────
-- Monthly buckets of system accuracy + persistence-null baseline + lift.
--
-- PERSISTENCE-NULL (the honest baseline, matches computeSkillScore):
--   predict_t = observed_{t-1} for the same slug (LAG over as_of ordering). Scored set
--   (shared denominator, locked Option b): non-first-per-slug (a prior exists) AND
--   non-neutral observed target (a neutral observed is inconclusive for a directional
--   call). A neutral PRIOR is kept and scores as a persistence MISS (prior <> directional
--   target) — makes naive carry-forward harder to beat, so lift is a clean lower bound.
--
-- Honesty guarantees:
--   • source column distinguishes 'retrodicted' (§2 seed) from 'live' (outcomes) — never blended
--   • 'neutral'/'partial' grades excluded from accuracy (system_correct uses
--     predicted_direction = observed_direction, identical to the TS scorer's `correct`)
--   • LIVE half reports raw hit-rate only; persistence/lift are NULL until an ordered
--     per-slug live series exists (outcomes currently empty) — NEVER a modal fudge.

DROP VIEW IF EXISTS public.glass_skill_over_time;
CREATE VIEW public.glass_skill_over_time AS
WITH
  retro_ordered AS (
    SELECT
      slug,
      as_of_date,
      date_trunc('month', as_of_date)::date AS month,
      predicted_direction,
      observed_direction,
      LAG(observed_direction) OVER (PARTITION BY slug ORDER BY as_of_date) AS prior_observed
    FROM public.backtest_grades
    WHERE grade_method = 'retrodicted'
  ),
  retro AS (
    SELECT
      month,
      'retrodicted'::text                              AS source,
      (predicted_direction = observed_direction)::int  AS system_correct,
      (prior_observed     = observed_direction)::int   AS persistence_correct
    FROM retro_ordered
    WHERE prior_observed IS NOT NULL          -- non-first per slug (persistence needs a prior)
      AND observed_direction <> 'neutral'     -- non-neutral target (inconclusive for a directional call)
  ),
  live AS (
    SELECT
      date_trunc('month', o.graded_at)::date           AS month,
      'live'::text                                      AS source,
      (o.direction_correct)::int                        AS system_correct,
      NULL::int                                         AS persistence_correct
    FROM public.outcomes o
    JOIN public.predictions p ON p.id = o.prediction_id
    WHERE o.direction_correct IS NOT NULL
      AND p.predicted_direction IS NOT NULL
  ),
  combined AS (
    SELECT month, source, system_correct, persistence_correct FROM retro
    UNION ALL
    SELECT month, source, system_correct, persistence_correct FROM live
  )
SELECT
  month,
  source,
  COUNT(*)                                                            AS n_grades,
  ROUND(AVG(system_correct)::numeric, 4)                             AS system_accuracy,
  ROUND(AVG(persistence_correct)::numeric, 4)                        AS persistence_accuracy,  -- NULL for live
  ROUND((AVG(system_correct) - AVG(persistence_correct))::numeric, 4) AS lift                  -- NULL for live
FROM combined
GROUP BY month, source
ORDER BY month, source;

GRANT SELECT ON public.glass_skill_over_time TO service_role;
-- Supabase default privileges auto-grant anon/authenticated on every new public
-- object, and a view (security_invoker off) bypasses base-table RLS — so without this
-- REVOKE the retrodicted numbers leak to the public REST API (verified: anon read 73
-- rows pre-revoke). Internal page: service_role ONLY (Glass guardrail 3).
REVOKE ALL ON public.glass_skill_over_time FROM anon, authenticated;


-- ── View 2: Calibration ────────────────────────────────────────────────────
-- Stated confidence bucket vs actual hit-rate. 5 bands (0.2 width each).
-- Perfect calibration = stated == actual (the diagonal on a scatter plot).
-- source column distinguishes retrodicted (seed) from live, never blended.
--
-- backtest_grades.confidence is the prediction confidence at as_of_date (0–1 float).
-- outcomes join: outcomes.prediction_id → predictions.id (FK from grade_predictions migration).

DROP VIEW IF EXISTS public.glass_calibration;
CREATE OR REPLACE VIEW public.glass_calibration AS
WITH
  retro AS (
    SELECT
      confidence,
      CASE WHEN grade = 'hit' THEN 1.0 ELSE 0.0 END AS is_hit,
      'retrodicted'::text AS source
    FROM public.backtest_grades
    WHERE grade IN ('hit', 'miss')
      AND confidence IS NOT NULL
  ),
  live AS (
    SELECT
      p.confidence,
      CASE WHEN o.direction_correct THEN 1.0 ELSE 0.0 END AS is_hit,
      'live'::text AS source
    FROM public.outcomes o
    JOIN public.predictions p ON p.id = o.prediction_id
    WHERE o.direction_correct IS NOT NULL
      AND p.confidence IS NOT NULL
  ),
  combined AS (
    SELECT * FROM retro
    UNION ALL
    SELECT * FROM live
  )
SELECT
  source,
  CASE
    WHEN confidence < 0.2 THEN '0–20%'
    WHEN confidence < 0.4 THEN '20–40%'
    WHEN confidence < 0.6 THEN '40–60%'
    WHEN confidence < 0.8 THEN '60–80%'
    ELSE                       '80–100%'
  END                                        AS confidence_bucket,
  CASE
    WHEN confidence < 0.2 THEN 0.10
    WHEN confidence < 0.4 THEN 0.30
    WHEN confidence < 0.6 THEN 0.50
    WHEN confidence < 0.8 THEN 0.70
    ELSE                        0.90
  END                                        AS stated_confidence,
  COUNT(*)                                   AS n_grades,
  ROUND(AVG(is_hit)::numeric, 4)             AS hit_rate
FROM combined
GROUP BY source, confidence_bucket, stated_confidence
ORDER BY source, stated_confidence;

GRANT SELECT ON public.glass_calibration TO service_role;
REVOKE ALL ON public.glass_calibration FROM anon, authenticated;  -- internal only (see View 1 note)
