-- Aggregate view: NFIP paid claims per (county, year) for the 6 SWFL counties.
-- Replaces the bulk of the 86.6k-row selectAllPaged in fema-nfip-source.mts.
-- ~200 rows back; feeds county-year fragments + aggregateSwflRollup() directly.
-- Column aliases match NfipCountyYearViewRow in the TS source.
CREATE OR REPLACE VIEW data_lake.fema_nfip_county_year AS
SELECT
  county_code,
  year_of_loss              AS year,
  COUNT(*)                  AS claim_count,
  SUM(
    COALESCE(amount_paid_on_building_claim, 0) +
    COALESCE(amount_paid_on_contents_claim, 0) +
    COALESCE(amount_paid_on_ico_claim, 0)
  )                         AS paid_total_usd
FROM data_lake.fema_nfip_claims
WHERE state = 'FL'
  AND county_code IN ('12071','12021','12015','12043','12051','12115')
  AND year_of_loss IS NOT NULL
GROUP BY county_code, year_of_loss
ORDER BY county_code, year_of_loss;

GRANT SELECT ON data_lake.fema_nfip_county_year TO service_role;
NOTIFY pgrst, 'reload schema';
