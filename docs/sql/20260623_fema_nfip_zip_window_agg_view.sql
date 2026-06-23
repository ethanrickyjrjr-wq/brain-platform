-- Per-ZIP aggregate view: paid totals, claim count, and median building value
-- for the most recent AAL_WINDOW_YEARS (10) calendar years, for SWFL ZIPs only.
-- Replaces per-row processing in aggregateZipRollupTop6() for the live path.
-- The window anchors on MAX(year_of_loss) computed inside the view so it
-- stays current as new data arrives without code changes.
CREATE OR REPLACE VIEW data_lake.fema_nfip_zip_window_agg AS
WITH max_yr AS (
  SELECT MAX(year_of_loss) AS yr
  FROM data_lake.fema_nfip_claims
  WHERE state = 'FL'
    AND county_code IN ('12071','12021','12015','12043','12051','12115')
)
SELECT
  c.reported_zipcode                                                          AS zip,
  c.county_code,
  SUM(
    COALESCE(c.amount_paid_on_building_claim, 0) +
    COALESCE(c.amount_paid_on_contents_claim, 0) +
    COALESCE(c.amount_paid_on_ico_claim, 0)
  )                                                                           AS paid_total_in_window_usd,
  COUNT(*)                                                                    AS claim_count_in_window,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c.building_property_value)      AS median_building_property_value_usd,
  max_yr.yr                                                                   AS window_end_year
FROM data_lake.fema_nfip_claims c
CROSS JOIN max_yr
WHERE c.state = 'FL'
  AND c.county_code IN ('12071','12021','12015','12043','12051','12115')
  AND c.reported_zipcode ~ '^\d{5}$'
  AND c.year_of_loss IS NOT NULL
  AND c.year_of_loss >= max_yr.yr - 9
GROUP BY c.reported_zipcode, c.county_code, max_yr.yr
ORDER BY c.county_code, c.reported_zipcode;

GRANT SELECT ON data_lake.fema_nfip_zip_window_agg TO service_role;
NOTIFY pgrst, 'reload schema';
