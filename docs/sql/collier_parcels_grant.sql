-- Grant service_role read access to the Tier 2 Collier parcels table + the
-- summary view the properties-collier-value parcel source reads.
-- Apply ONCE after the first dlt run creates data_lake.collier_parcels
-- (python -m ingest.pipelines.collier_parcels.pipeline).
--
-- service_role (not anon) needs USAGE on the schema + SELECT on the table+view,
-- or the source connector returns 0 rows silently (see
-- feedback_premise-engine-supabase-roles.md). 364k parcels is too many to pull
-- per refinery run, so the SOH aggregation lives in a Postgres view (like leepa).

GRANT USAGE ON SCHEMA data_lake TO service_role;
GRANT SELECT ON data_lake.collier_parcels TO service_role;


-- View: single-row Collier parcel snapshot — total parcels, homesteaded count
-- (jv_hmstd > 0), and the median Save-Our-Homes gap across the homesteaded set.
--
-- SOH gap = (just value of the homestead portion - assessed value of the
-- homestead portion) / just value, i.e. the accumulated Save-Our-Homes cap
-- benefit. percentile_cont ignores NULLs, so non-homestead parcels drop out of
-- the median. NOTE: this is the homestead-portion SOH differential — the
-- textbook Save-Our-Homes measure; Lee's number is the whole-parcel just-vs-
-- taxable proxy, so the two are directionally comparable, not identical.

CREATE OR REPLACE VIEW data_lake.collier_parcels_summary AS
SELECT
  COUNT(*)::int                                                     AS total_parcels,
  COUNT(*) FILTER (WHERE jv_hmstd > 0)::int                         AS soh_homesteaded_parcels,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY soh_gap_pct)::numeric AS soh_gap_median_pct
FROM (
  SELECT
    jv_hmstd,
    CASE
      WHEN jv_hmstd > 0 AND av_hmstd IS NOT NULL
      THEN ((jv_hmstd - av_hmstd)::numeric / jv_hmstd) * 100
    END AS soh_gap_pct
  FROM data_lake.collier_parcels
) src;

GRANT SELECT ON data_lake.collier_parcels_summary TO service_role;

NOTIFY pgrst, 'reload schema';
