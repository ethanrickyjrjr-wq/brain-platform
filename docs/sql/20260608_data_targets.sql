-- 20260608_data_targets.sql
-- The Glass §4 — the auto-generated "Shopping List" surface.
--
-- Two objects:
--   1. public.data_targets   — ranked data-gap rows, upserted nightly by
--      ingest/scripts/generate_data_targets.py. Internal (Pane 4 reads it with the
--      service-role key); NEVER granted to anon (Glass guardrail 3 — a retrodicted-
--      derived number is not a public accuracy claim).
--   2. public.backtest_skill_by_slug — per-slug skill (lift over a persistence null),
--      a SQL re-expression of refinery/lib/backtest/skill-baseline.mts computeSkillScore.
--      Reconciled against the TS scorer (see plan Task 5).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE VIEW. Run via psycopg
-- per CLAUDE.md RULE 1 (creds in .dlt/secrets.toml); verify row counts after.

BEGIN;

-- 1. data_targets --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.data_targets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_key  text NOT NULL UNIQUE,
  kind        text NOT NULL CHECK (kind IN (
                'stale','low_skill','low_n','excluded_wanted','falsifiability_gap')),
  subject     text NOT NULL,        -- slug | source name | brain_id
  label       text NOT NULL,        -- human headline
  reason      text NOT NULL,        -- why it's a target, N-stamped
  status      text NOT NULL DEFAULT 'want'
                CHECK (status IN ('live','building','new','want')),
  priority    smallint NOT NULL DEFAULT 5,   -- 1 = most urgent
  metric      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {n, lift, age_days, ...}
  source      text NOT NULL DEFAULT 'generator'
                CHECK (source IN ('generator','manual')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_targets_priority_idx
  ON public.data_targets (priority, kind);

GRANT SELECT ON public.data_targets TO service_role;
-- Supabase default privileges auto-grant anon/authenticated on every new public object.
-- The table's RLS blocks anon, but REVOKE here too for defense-in-depth + intent clarity.
REVOKE ALL ON public.data_targets FROM anon, authenticated;

-- 2. backtest_skill_by_slug ----------------------------------------------------
-- Per-slug lift = system_accuracy - persistence_accuracy over the SHARED scored set:
--   • non-first-per-slug   → LAG(...) IS NOT NULL  (persistence needs a prior)
--   • non-neutral target   → observed_direction <> 'neutral'
--   • a neutral PRIOR is kept and scores as a persistence MISS (prior <> directional
--     target) — matches computeSkillScore's "neutral prior counts as a persistence
--     miss" pin, making naive carry-forward harder to beat (lift = clean lower bound).
CREATE OR REPLACE VIEW public.backtest_skill_by_slug AS
WITH ordered AS (
  SELECT
    slug, as_of_date, predicted_direction, observed_direction,
    LAG(observed_direction) OVER (PARTITION BY slug ORDER BY as_of_date) AS prior_observed
  FROM public.backtest_grades
  WHERE grade_method = 'retrodicted'
),
scored AS (
  SELECT
    slug,
    (predicted_direction = observed_direction)::int AS system_correct,
    (prior_observed     = observed_direction)::int  AS persistence_correct
  FROM ordered
  WHERE prior_observed IS NOT NULL
    AND observed_direction <> 'neutral'
)
SELECT
  slug,
  count(*)                                                              AS n,
  round(avg(system_correct)::numeric, 4)                               AS system_accuracy,
  round(avg(persistence_correct)::numeric, 4)                          AS persistence_accuracy,
  round((avg(system_correct) - avg(persistence_correct))::numeric, 4)  AS lift
FROM scored
GROUP BY slug
ORDER BY n DESC;

GRANT SELECT ON public.backtest_skill_by_slug TO service_role;
-- A view (security_invoker off) bypasses base-table RLS, so anon's blanket default grant
-- would expose retrodicted skill numbers on the public REST API — revoke it (guardrail 3).
REVOKE ALL ON public.backtest_skill_by_slug FROM anon, authenticated;

COMMIT;

-- Verify after running:
--   SELECT count(*) FROM public.data_targets;             -- table exists (0 until first run)
--   SELECT * FROM public.backtest_skill_by_slug;          -- 2 rows today (LAUS Lee/Collier)
