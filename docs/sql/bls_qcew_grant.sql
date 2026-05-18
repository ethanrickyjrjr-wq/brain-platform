-- Grant brain-platform's service_role read access to the Tier 2 BLS QCEW table.
-- Apply ONCE after the first dlt run creates data_lake.bls_qcew
-- (python -m ingest.pipelines.bls_qcew.pipeline from brain-platform/ingest/).
--
-- Brain-platform's Supabase key is service_role (not anon). Without USAGE on
-- the schema + SELECT on the table, the bls-qcew-source connector returns 0
-- rows silently. See memory: feedback_premise-engine-supabase-roles.md.
--
-- Schema is auto-created by dlt with the 19 columns pinned in
-- ingest/pipelines/bls_qcew/resources.py:_BLS_QCEW_COLUMNS.
-- Primary key: surrogate "id" (pipe-delimited: area_fips|own_code|industry_code|size_code|year|qtr).
-- write_disposition="merge": 30 rows at steady state (3 areas x 5 ownership codes x 2 quarters).

GRANT USAGE ON SCHEMA data_lake TO service_role;
GRANT SELECT ON data_lake.bls_qcew TO service_role;
