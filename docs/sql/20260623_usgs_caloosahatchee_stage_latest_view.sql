-- Single-row view: median surface-water stage (parameter_cd 00065) across
-- Caloosahatchee gages on the most recent available observation date.
-- Replaces the two selectAllPaged calls (sites + daily) in usgs-water-source.mts.
-- Uses HUC code (03090205*) to identify Caloosahatchee sites, matching the
-- isCaloosahatcheeSite() filter in the TS source.
CREATE OR REPLACE VIEW data_lake.usgs_caloosahatchee_stage_latest AS
WITH latest_date AS (
  SELECT MAX(d.obs_date) AS max_obs
  FROM data_lake.usgs_daily d
  JOIN data_lake.usgs_sites s ON s.site_no = d.site_no
  WHERE d.parameter_cd = '00065'
    AND s.huc_cd LIKE '03090205%'
    AND d.value IS NOT NULL
)
SELECT
  ROUND(
    CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.value) AS numeric),
    2
  )                                                          AS stage_median_ft,
  ld.max_obs                                                 AS as_of,
  ARRAY_AGG(DISTINCT d.site_no ORDER BY d.site_no)           AS site_nos
FROM data_lake.usgs_daily d
JOIN data_lake.usgs_sites s ON s.site_no = d.site_no
JOIN latest_date ld ON d.obs_date = ld.max_obs
WHERE d.parameter_cd = '00065'
  AND s.huc_cd LIKE '03090205%'
  AND d.value IS NOT NULL
GROUP BY ld.max_obs;

GRANT SELECT ON data_lake.usgs_caloosahatchee_stage_latest TO service_role;
NOTIFY pgrst, 'reload schema';
