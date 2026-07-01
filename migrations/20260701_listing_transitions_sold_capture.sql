-- migrations/20260701_listing_transitions_sold_capture.sql
-- Phase-2 Part A — organic sold capture (property-tax-history off-market hook + holding re-check).
--
-- Additive-only. When a tracked for-sale listing leaves the active sweep, the pipeline fires one
-- /property-tax-history probe (budget-sampled) to resolve WHY it left. A confirmed recent Sold event
-- stamps the sold PRICE + real close DATE onto the transition (distinct from `at`, the detection date).
-- `sold_check_at` on listing_state records the last probe so the daily re-check rotates through the
-- holding backlog instead of re-burning the paid call budget on the same (highest-value) homes.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS); safe to re-run. psql is NOT installed on this box, so apply
-- via Bun.SQL: `bun scripts/run-migration.ts migrations/20260701_listing_transitions_sold_capture.sql`.

-- Transition history: the sold price + the real close date (both NULL unless to_state='sold').
ALTER TABLE data_lake.listing_transitions ADD COLUMN IF NOT EXISTS sold_price bigint;  -- confirmed sale price (never the list price — that stays in `price`)
ALTER TABLE data_lake.listing_transitions ADD COLUMN IF NOT EXISTS sold_date  date;    -- realtor.com property_history close date (distinct from `at` = the day we detected departure)

-- State machine: when we last fired a property-tax-history probe for this listing (NULL = never).
-- Drives holding-re-check eligibility + prevents re-probing the same holding more than ~monthly.
ALTER TABLE data_lake.listing_state ADD COLUMN IF NOT EXISTS sold_check_at timestamptz;

-- Flow index over the new terminal state (sold rows the sold-price dataset is built from).
CREATE INDEX IF NOT EXISTS ix_listing_transitions_sold ON data_lake.listing_transitions (sold_date) WHERE to_state = 'sold';

GRANT SELECT, INSERT, UPDATE, DELETE ON data_lake.listing_transitions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON data_lake.listing_state TO service_role;
NOTIFY pgrst, 'reload schema';
