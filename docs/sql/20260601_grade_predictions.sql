-- 20260601_grade_predictions.sql
-- Phase 2 of the prediction grading loop — the deterministic grader's DB surface.
--
-- Companion code: refinery/grade/grade-predictions.mts (the grader) calls grade_prediction().
-- Schema/state for Phase 1 (metric_observations + the gradeable columns on predictions
-- and outcomes) shipped in 20260531_grading_loop.sql — this migration adds ONLY the
-- atomic write RPC + the calibration read view. It depends on outcomes_machine_uidx
-- (the partial unique index on outcomes(prediction_id) WHERE grade_method='machine')
-- existing already — that index is what makes grade_prediction idempotent.
--
-- RUN THIS IN SUPABASE (operator decree: schema is never auto-run by a session, but a
-- session DOES run migrations directly per CLAUDE.md RULE 1). IDEMPOTENT: CREATE OR
-- REPLACE throughout, so re-running is a no-op. (Caveat: CREATE OR REPLACE FUNCTION
-- cannot change an argument's name/type on replace — if the signature is ever edited,
-- DROP FUNCTION first.)
--
-- DESIGN NOTE: the verdict is written in ONE database transaction. A plpgsql function
-- body is atomic — the outcomes INSERT and the predictions UPDATE either both land or
-- neither does. If the call throws, grade_status stays 'gradeable'/'pending_data' and
-- the row is retried on the next run. There is no fake two-step in TypeScript.

BEGIN;

-- 1. grade_prediction(...) -----------------------------------------------------
-- Atomic: INSERT the immutable numeric verdict into outcomes, then flip the
-- prediction to 'graded'. predictions has NO graded_at column — graded_at lives
-- on the outcomes row. actual_value (the pre-existing NOT NULL TEXT column for
-- operator prose) is satisfied with observed_value::text.
--
-- ON CONFLICT (prediction_id) WHERE grade_method = 'machine' DO NOTHING infers the
-- partial unique index outcomes_machine_uidx as the conflict arbiter (verified
-- against postgresql.org/docs INSERT conflict_target grammar — the WHERE clause is
-- the index_predicate used for partial-unique-index inference). A second grade of
-- the same prediction is therefore a no-op insert; the verdict is write-once.
CREATE OR REPLACE FUNCTION public.grade_prediction(
  p_prediction_id       UUID,
  p_observed_value      NUMERIC,
  p_baseline_value      NUMERIC,
  p_predicted_direction TEXT,
  p_observed_direction  TEXT,
  p_direction_correct   BOOLEAN,
  p_error               NUMERIC,
  p_observed_at         TIMESTAMPTZ,
  p_source_url          TEXT,
  p_grade_config        JSONB
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO outcomes (
    prediction_id, actual_value, observed_value, baseline_value,
    predicted_direction, observed_direction, direction_correct, error,
    observed_at, source_url, graded_at, grade_method, grade_config
  ) VALUES (
    p_prediction_id, p_observed_value::text, p_observed_value, p_baseline_value,
    p_predicted_direction, p_observed_direction, p_direction_correct, p_error,
    p_observed_at, p_source_url, now(), 'machine', p_grade_config
  )
  ON CONFLICT (prediction_id) WHERE grade_method = 'machine' DO NOTHING;

  UPDATE predictions SET grade_status = 'graded' WHERE id = p_prediction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grade_prediction(
  UUID, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, NUMERIC, TIMESTAMPTZ, TEXT, JSONB
) TO service_role;

-- 2. grade_accuracy_by_slug ----------------------------------------------------
-- Direction-hit rate per gradeable slug — the flywheel's first calibration read.
-- DISTINCT ON collapses repeat predictions of the SAME (slug, baseline, window_end)
-- to a single real-world call (a daily re-refine that lands identical anchors is not
-- a new bet), keeping the most-recently graded. Machine grades only; rows still
-- awaiting a magnitude/direction verdict (direction_correct IS NULL) are excluded.
CREATE OR REPLACE VIEW public.grade_accuracy_by_slug AS
WITH deduped AS (
  SELECT DISTINCT ON (p.gradeable_slug, p.baseline_value, p.window_end_date)
    p.gradeable_slug,
    o.direction_correct
  FROM outcomes o
  JOIN predictions p ON o.prediction_id = p.id
  WHERE o.grade_method = 'machine'
    AND o.direction_correct IS NOT NULL
  ORDER BY p.gradeable_slug, p.baseline_value, p.window_end_date, o.graded_at DESC
)
SELECT
  gradeable_slug,
  count(*)                                      AS n,
  round(avg(direction_correct::int) * 100, 1)   AS pct_correct
FROM deduped
GROUP BY gradeable_slug
ORDER BY n DESC;

GRANT SELECT ON public.grade_accuracy_by_slug TO anon, authenticated;

COMMIT;

-- Verify after running:
--   SELECT * FROM public.grade_accuracy_by_slug;   -- expect 0 rows, no error
--   \df public.grade_prediction                     -- function exists
