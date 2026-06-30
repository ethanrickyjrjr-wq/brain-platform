-- migrations/20260630b_listing_state_budget_fix_columns.sql
-- Phase-1 budget-bomb fix, step 2: additive columns the SteadyAPI-sole rewrite needs to persist
-- property_id (so known_ids can be threaded from prior state — the fix for the 42k-call bomb),
-- plus status/reduced_amount/flags carried by /search (capture wide, slice late).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS); safe to re-run. psql is NOT installed on this box, so
-- apply via Bun.SQL: `bun scripts/run-migration.ts migrations/20260630b_listing_state_budget_fix_columns.sql`.

ALTER TABLE data_lake.listing_state ADD COLUMN IF NOT EXISTS property_id        text;    -- SteadyAPI property_id — permanent identity after first match, no re-matching daily
ALTER TABLE data_lake.listing_state ADD COLUMN IF NOT EXISTS status             text;    -- SteadyAPI raw status (for_sale/pending/...) — distinct from our internal lifecycle `state`
ALTER TABLE data_lake.listing_state ADD COLUMN IF NOT EXISTS reduced_amount     integer; -- price.reduced_amount when flag_price_reduced
ALTER TABLE data_lake.listing_state ADD COLUMN IF NOT EXISTS flag_pending          boolean;
ALTER TABLE data_lake.listing_state ADD COLUMN IF NOT EXISTS flag_contingent       boolean;
ALTER TABLE data_lake.listing_state ADD COLUMN IF NOT EXISTS flag_coming_soon      boolean;
ALTER TABLE data_lake.listing_state ADD COLUMN IF NOT EXISTS flag_foreclosure      boolean;
ALTER TABLE data_lake.listing_state ADD COLUMN IF NOT EXISTS flag_new_construction boolean;
ALTER TABLE data_lake.listing_state ADD COLUMN IF NOT EXISTS flag_price_reduced    boolean;
ALTER TABLE data_lake.listing_state ADD COLUMN IF NOT EXISTS flag_new_listing      boolean;

CREATE INDEX IF NOT EXISTS listing_state_property_id_idx ON data_lake.listing_state (property_id) WHERE property_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON data_lake.listing_state TO service_role;
NOTIFY pgrst, 'reload schema';
