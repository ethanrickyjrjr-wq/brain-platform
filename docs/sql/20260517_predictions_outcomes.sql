-- =====================================================================
-- 20260517 — Predictions + outcomes (roadmap §6.1.4).
--
-- Spec: docs/ontology-and-roadmap.md §6.1.4 (line 236):
--   "Seed the outcomes table. Two Supabase tables:
--      predictions(id, brain_id, refined_at, conclusion, confidence,
--                  prediction_window, metadata)
--      outcomes(prediction_id, actual_value, observed_at, delta,
--               correction_notes)
--    No UI yet. Just start logging every master refine. This is the seed
--    corpus for everything downstream — backtests, fine-tuning, drift
--    detection."
--
-- ---------------------------------------------------------------------
-- Naming conflict resolution
--
-- The prior 20260516_base_tables_source_and_outcomes.sql originally
-- created a table named `outcomes` for the SGD confidence-calibration
-- corpus. That file has since been edited so a fresh apply creates the
-- table as `confidence_calibration` directly (see its HISTORY NOTE).
-- The §6.1.4 spec's `outcomes` table is a different job — predicted
-- conclusion vs observed reality, joined to predictions via prediction_id.
-- The two loops are different:
--   confidence_calibration  — was the confidence number honest?
--   outcomes                — was the conclusion right?
--
-- Section 1 below is a one-shot safety-net RENAME for any Supabase
-- project that applied the ORIGINAL version of the 20260516 file under
-- the old `outcomes` name. On a clean install where the edited 20260516
-- already created `confidence_calibration`, the guard is a no-op.
--
-- Paste-and-run: Supabase SQL editor. No supabase/migrations infra.
-- Safety: every rename is IF EXISTS-guarded; every CREATE is
-- IF NOT EXISTS-guarded. Re-running is a no-op.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Safety-net rename for previously-applied databases.
--    No-op on a clean install (the edited 20260516 file now creates the
--    table as confidence_calibration directly). Only fires if an OLD
--    20260516 applied the table under the now-deprecated `outcomes` name.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'outcomes'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'confidence_calibration'
  ) THEN
    EXECUTE 'ALTER TABLE outcomes RENAME TO confidence_calibration';

    -- Rename the two indexes the old 20260516 created (best-effort; the
    -- IF EXISTS guard means a manually-renamed index won't break this block).
    EXECUTE 'ALTER INDEX IF EXISTS outcomes_brain_id_recorded_at_idx '
            'RENAME TO confidence_calibration_brain_id_recorded_at_idx';
    EXECUTE 'ALTER INDEX IF EXISTS outcomes_unlabeled_idx '
            'RENAME TO confidence_calibration_unlabeled_idx';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. predictions — one row per master refine.
--
-- Stage 4 inserts immediately after a successful master render. The
-- `conclusion` is the OUTPUT.conclusion string the synthesizer emitted;
-- `confidence` mirrors OUTPUT.confidence (deterministic, never LLM-set).
-- `prediction_window` is the analyst-facing revisit horizon ("18 months",
-- "Q1 2027", "next FRED release") kept as TEXT so the synthesizer can use
-- the same phrasing it puts in the brain. `metadata` is the bucket for
-- everything the SGD job or backtest harness might want later
-- (freshness_token, upstream_brain_ids, direction, contradicts).
--
-- brain_id is NOT a FK to brain_registry(id) for the same reason
-- confidence_calibration.brain_id isn't: the refinery must build offline
-- when brain_registry is empty (per docs/sql/brain_registry.sql header).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS predictions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brain_id           TEXT NOT NULL CHECK (length(brain_id) > 0),
  refined_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  conclusion         TEXT NOT NULL CHECK (length(conclusion) > 0),
  confidence         NUMERIC(3, 2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  prediction_window  TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS predictions_brain_id_refined_at_idx
  ON predictions (brain_id, refined_at DESC);

COMMENT ON TABLE predictions IS
  'Roadmap §6.1.4 seed corpus. One row per master refine. Stage 4 inserts '
  'immediately after a successful render. Joined 1-to-many by outcomes via '
  'prediction_id when the actual is observed (could be months later).';

COMMENT ON COLUMN predictions.conclusion IS
  'The OUTPUT.conclusion string the master synthesizer emitted. Narrative '
  'prose, not a number — by contract confidence is the only number here.';

COMMENT ON COLUMN predictions.prediction_window IS
  'Free-form revisit horizon ("18 months", "Q1 2027", "next FRED release"). '
  'Kept as TEXT so the synthesizer can reuse the same phrasing it puts in '
  'the brain. Normalize to interval/date only when backtest tooling needs it.';

COMMENT ON COLUMN predictions.metadata IS
  'Bucket for everything the SGD job or backtest harness might want later: '
  'freshness_token, upstream_brain_ids, direction, contradicts, top key_metrics.';

-- ---------------------------------------------------------------------
-- 3. outcomes — the §6.1.4 prediction-truthing table.
--
-- Joined to predictions via prediction_id. ON DELETE CASCADE because an
-- orphan outcome with no parent prediction is meaningless. `actual_value`
-- and `delta` are TEXT — conclusions are narrative, not numeric, so the
-- delta is the analyst's divergence story, not a regression residual.
-- Numeric delta can be derived from metadata.direction/metrics later.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outcomes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id    UUID NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  actual_value     TEXT NOT NULL CHECK (length(actual_value) > 0),
  observed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  delta            TEXT,
  correction_notes TEXT
);

CREATE INDEX IF NOT EXISTS outcomes_prediction_id_idx
  ON outcomes (prediction_id);

CREATE INDEX IF NOT EXISTS outcomes_observed_at_idx
  ON outcomes (observed_at DESC);

COMMENT ON TABLE outcomes IS
  'Roadmap §6.1.4 prediction-truthing log. One row per observed outcome '
  'against a stored prediction. Narrative actual_value + analyst delta '
  '(not a numeric residual). Backtests join predictions <-> outcomes via '
  'prediction_id. NOT to be confused with the SGD calibration table — '
  'that was renamed to confidence_calibration in this same migration.';

COMMENT ON COLUMN outcomes.actual_value IS
  'What actually happened in the world, in the analyst''s words. Free-form '
  'because predictions.conclusion is narrative.';

COMMENT ON COLUMN outcomes.delta IS
  'Narrative divergence between prediction and reality (e.g. "directionally '
  'right but 6 months early", "wrong sign on tourism"). Numeric residual '
  'belongs in a future backtest view, derived from metadata.';
