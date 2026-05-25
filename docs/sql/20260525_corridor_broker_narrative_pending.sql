-- 20260525_corridor_broker_narrative_pending.sql
--
-- Adds the pending column for the broker-narrative human-spot-check gate.
-- The corridor_narratives quarterly GitHub Actions pipeline writes to
-- character_broker_narrative_pending; cre-swfl reads character_broker_narrative
-- (the non-pending column). Newly-ingested rows are inert until a human
-- spot-checks them and runs:
--
--   UPDATE corridor_profiles
--   SET character_broker_narrative = character_broker_narrative_pending,
--       character_broker_narrative_pending = NULL
--   WHERE corridor_name IN ('...');
--
-- This mirrors the verified=false gate on data_lake.marketbeat_swfl — both
-- Firecrawl ingest paths require a human spot-check before the brain consumes
-- the data.
--
-- Apply via Supabase SQL editor; idempotent on re-run.

ALTER TABLE corridor_profiles
  ADD COLUMN IF NOT EXISTS character_broker_narrative_pending JSONB;

COMMENT ON COLUMN corridor_profiles.character_broker_narrative_pending IS
  'Quarterly broker narrative from Firecrawl ingest, pending human spot-check. Promote to character_broker_narrative via UPDATE; clear back to NULL after promotion.';
