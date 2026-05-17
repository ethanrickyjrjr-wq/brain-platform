-- =====================================================================
-- 20260516 — Base tables: source_connectors + confidence_calibration.
--
-- HISTORY NOTE (2026-05-17): the table now named `confidence_calibration`
-- was originally created in this file as `outcomes`. It was retroactively
-- renamed when the §6.1.4 prediction-truthing work (see
-- 20260517_predictions_outcomes.sql) needed the `outcomes` name for a
-- semantically different table (predicted conclusion vs observed reality).
-- The two loops are different jobs:
--   confidence_calibration  — was the deterministic confidence honest?
--                             (feeds the Adaptive Trust Tiers SGD loop,
--                             arsenal Tier 4 #27)
--   outcomes                — was the master conclusion right?
--                             (roadmap §6.1.4 backtest corpus)
-- Prior databases that applied the original version of this file under
-- the old `outcomes` name are repaired by an idempotent RENAME guard at
-- the top of 20260517_predictions_outcomes.sql.
--
-- Context: the 20260516_source_trust_tier_score.sql migration assumed
-- these two tables already existed in the target Supabase project (see
-- its lines 15-19). They did not — neither this repo nor the Brain
-- Factory Blueprint v1.1 (Notion page 36135f3b-7faf-813d-b9b8-dfc16ee7da0b)
-- ever shipped a CREATE TABLE for them. This file fills that gap.
--
-- Spec lineage (no single doc owns these tables; this is a synthesis):
--   • docs/arsenal-master-stack.md Pillar 1 §5 — names both tables and
--     describes the columns the May 16 ALTERs add (trust_tier_score,
--     attribution), but does not define the base shape.
--   • refinery/lib/confidence.mts lines 22-44, 119-172 — defines the
--     TIER_SCORE map (tiers 1-4), the TrustTier type, the WeightedSource
--     shape (source_id: string, trust_tier_score: number in [0,1]), and
--     the AttributionEntry shape persisted to
--     confidence_calibration.attribution.
--   • docs/sql/20260516_source_trust_tier_score.sql lines 47-64 — the
--     backfill DO block UPDATEs source_connectors by an integer
--     `trust_tier` column. That column must exist here for backfill to
--     do work.
--
-- Run order in the Supabase SQL editor:
--   1. THIS FILE                                           ← creates the tables
--   2. 20260516_source_trust_tier_score.sql                ← adds trust_tier_score + attribution
--
-- Paste-and-run: this file is meant for the Supabase SQL editor. There
-- is no `supabase/migrations/` infrastructure in this repo.
--
-- Safety: every CREATE / INDEX / DO is `IF NOT EXISTS` or guarded by a
-- catalog check, so this file is idempotent and safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. source_connectors
--
-- Catalog of every data source the refinery can fetch from. `source_id`
-- is the natural key — it matches WeightedSource.source_id in
-- refinery/lib/confidence.mts:122 exactly, and is the join key the
-- attribution engine emits in confidence_calibration.attribution[].source_id.
--
-- `trust_tier` is a 1-4 SMALLINT matching the TrustTier type (the
-- TypeScript union `1 | 2 | 3 | 4` in refinery/types/pack.mts) and the
-- TIER_SCORE map in confidence.mts. Note the Phase 1 Notion plan used a
-- 1-5 scale (1=federal/state ... 5=social); the implemented code
-- consolidated to 1-4 and that is what gates the May 16 backfill, so
-- this CHECK constraint matches the code, not the older plan.
--
-- `kind` is a discriminator over the source-connector implementations
-- in refinery/sources/*.mts:
--     supabase    — refinery/sources/supabase.mts client
--     sanity      — refinery/sources/sanity.mts client
--     api         — third-party HTTP/JSON API
--     llm         — LLM-derived (low trust, tier 4 typical)
--     brain-input — refinery/sources/brain-input-source.mts (already
--                   distilled upstream brain output; bypasses fitScore)
--     fixture     — refinery/__fixtures__ / __scratch__ test data
-- Extending the enum later is a non-breaking ALTER ... DROP CONSTRAINT
-- + new CHECK.
--
-- DELIBERATELY OMITTED from this table:
--   • trust_tier_score — added by 20260516_source_trust_tier_score.sql.
--     Keeping it out here preserves the two-file separation so the
--     already-reviewed May 16 migration is the single owner of that
--     column's definition, default, and CHECK.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_connectors (
  source_id     TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (
    kind IN ('supabase', 'sanity', 'api', 'llm', 'brain-input', 'fixture')
  ),
  trust_tier    SMALLINT NOT NULL DEFAULT 2
                  CHECK (trust_tier BETWEEN 1 AND 4),
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS source_connectors_kind_idx
  ON source_connectors (kind);
CREATE INDEX IF NOT EXISTS source_connectors_trust_tier_idx
  ON source_connectors (trust_tier);

COMMENT ON TABLE source_connectors IS
  'Catalog of refinery data sources. source_id is the natural key and '
  'the join key the attribution engine (refinery/lib/confidence.mts) '
  'emits in confidence_calibration.attribution[].source_id. trust_tier seeds '
  'trust_tier_score via the 20260516_source_trust_tier_score.sql '
  'backfill (1->1.00, 2->0.80, 3->0.60, 4->0.40).';

COMMENT ON COLUMN source_connectors.source_id IS
  'Matches WeightedSource.source_id (refinery/lib/confidence.mts:122) '
  'and AttributionEntry.source_id. Free-form lowercase slug.';

COMMENT ON COLUMN source_connectors.trust_tier IS
  '1-4 integer tier. 1=primary (Fed/BLS/county GIS), 2=first-party '
  'verified (Sanity corridorProfile, Supabase RPC), 3=aggregator, '
  '4=inferred/LLM-derived. Mirrors TrustTier type in '
  'refinery/types/pack.mts. The May 16 trust_tier_score migration '
  'derives the mutable 0-1 score from this column on first install.';

COMMENT ON COLUMN source_connectors.kind IS
  'Discriminator over refinery/sources/*.mts implementations. '
  'Extending later is a non-breaking ALTER ... DROP CONSTRAINT + new CHECK.';

-- ---------------------------------------------------------------------
-- updated_at maintenance for source_connectors
--
-- Mirrors the trigger style in brain_registry.sql (sync_consumer_brains).
-- Keeps updated_at honest without callers having to remember to set it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_source_connectors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS source_connectors_touch_updated_at ON source_connectors;
CREATE TRIGGER source_connectors_touch_updated_at
  BEFORE UPDATE ON source_connectors
  FOR EACH ROW EXECUTE FUNCTION touch_source_connectors_updated_at();

-- ---------------------------------------------------------------------
-- 2. confidence_calibration  (originally named `outcomes` — see HISTORY
--    NOTE at top of file)
--
-- One row per refine event. The Adaptive Trust Tiers SGD job (arsenal
-- Tier 4 #27, gated on calibration-row count per SM-2) consumes
-- (predicted_confidence, actual_confidence, attribution) to update
-- source_connectors.trust_tier_score without a code deploy.
--
-- Design notes:
--
-- • brain_id is NOT a foreign key to brain_registry(id). Rationale:
--   brain_registry.sql lines 14-17 state explicitly that the registry
--   is catalog-only and the in-memory PACKS export is the build-time
--   source of truth — the refinery is required to build correctly in
--   fixture / offline mode when brain_registry is empty or unreachable.
--   A FK would couple a live-calibration table to an optional catalog
--   and break the offline-fixture contract. A length>0 CHECK is the
--   minimum honest guard.
--
-- • predicted_confidence is NOT NULL — Stage 4 always emits a confidence
--   number (see refinery/lib/confidence.mts computeConfidence). If
--   Stage 4 can't compute one, the refine should fail, not write a NULL.
--
-- • actual_confidence IS nullable — it stays NULL until a downstream
--   review or outcome signal labels the row. The
--   confidence_calibration_unlabeled_idx partial index supports the SGD
--   job's "find unlabeled work" query.
--
-- DELIBERATELY OMITTED from this table:
--   • attribution JSONB — added by 20260516_source_trust_tier_score.sql.
--     Same two-file-separation reasoning as trust_tier_score above.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS confidence_calibration (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brain_id              TEXT NOT NULL CHECK (length(brain_id) > 0),
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  predicted_confidence  NUMERIC(3, 2) NOT NULL
                          CHECK (predicted_confidence BETWEEN 0 AND 1),
  actual_confidence     NUMERIC(3, 2)
                          CHECK (
                            actual_confidence IS NULL
                            OR actual_confidence BETWEEN 0 AND 1
                          ),
  notes                 TEXT
);

CREATE INDEX IF NOT EXISTS confidence_calibration_brain_id_recorded_at_idx
  ON confidence_calibration (brain_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS confidence_calibration_unlabeled_idx
  ON confidence_calibration (recorded_at)
  WHERE actual_confidence IS NULL;

COMMENT ON TABLE confidence_calibration IS
  'One row per refine event. Adaptive Trust Tiers SGD job (Tier 4 #27 '
  'in docs/arsenal-master-stack.md) reads (predicted_confidence, '
  'actual_confidence, attribution) to update '
  'source_connectors.trust_tier_score without a code deploy. '
  'attribution JSONB is added by 20260516_source_trust_tier_score.sql. '
  'Renamed from `outcomes` on 2026-05-17 to free that name for the '
  '§6.1.4 prediction-truthing table.';

COMMENT ON COLUMN confidence_calibration.brain_id IS
  'Intentionally NOT a FK to brain_registry(id) — registry is catalog-'
  'only and the refinery must build offline. length>0 CHECK is the '
  'minimum honest guard.';

COMMENT ON COLUMN confidence_calibration.actual_confidence IS
  'NULL until the row is labeled by review or downstream signal. '
  'confidence_calibration_unlabeled_idx partial index supports the SGD '
  'job''s "find work" query.';
