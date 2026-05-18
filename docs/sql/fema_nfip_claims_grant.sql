-- Tier 2 grant for env-swfl brain.
--
-- The dlt promotion in ingest/pipelines/fema/resources.py:_promote_nfip_to_tier2
-- creates data_lake.fema_nfip_claims under the dlt loader role. brain-platform's
-- Supabase client authenticates as service_role and will read 0 rows silently
-- unless this grant is applied. See [[premise-engine-supabase-roles]] memory.
--
-- Apply by hand in Supabase Studio after the first dlt run:
--   python -m ingest.pipelines.fema.pipeline
-- then paste this file into the SQL editor.

GRANT USAGE ON SCHEMA data_lake TO service_role;
GRANT SELECT ON data_lake.fema_nfip_claims TO service_role;
