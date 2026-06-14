-- =====================================================================
-- 20260614 — Hard-delete the orphaned SBA franchise-outcomes DB artifact.
-- =====================================================================
-- WHY: the franchise table + its pass-through aggregation function were a
-- one-time copy from the retired Premise Engine project (seeded 2026-05-17 in
-- 20260517_brains_data_tables.sql). There is NO ingest pipeline and NO cadence
-- entry — it has never refreshed and never will. The live table (275 brands,
-- ~flat survival) also contradicted the franchise-outcomes brain's curated
-- reference fixture (15 brands), so anything querying it live disagreed with the
-- brain's published numbers. The brain now reads ONLY its committed fixture
-- (refinery/sources/franchise-source.mts is fixture-only), so this table + the
-- function are dead weight.
--
-- ⚠️ SEQUENCING: deploy the fixture-pin code (franchise-source.mts +
--    refinery/config/packs.mts) BEFORE running this. Otherwise a nightly running
--    the old live-RPC path would error on the missing object.
--
-- Idempotent. The DDL still lives in git history (20260517_brains_data_tables.sql)
-- if it ever needs to be recreated.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS get_franchise_outcomes_aggregated();
DROP TABLE IF EXISTS sba_loans_franchise_outcomes;
