-- Aggregate view: FL CBP data by NAICS sector (2-digit codes only).
-- Replaces the 43k-row selectAllPaged in macro-florida-cbp-source.mts
-- with a single ~20-row fetch.
-- Column aliases match the CbpRow interface in the TS source.
CREATE OR REPLACE VIEW data_lake.census_cbp_fl_agg_by_naics AS
WITH max_yr AS (
  SELECT MAX(year) AS yr FROM data_lake.census_cbp_fl
)
SELECT
  c.naics_code,
  c.naics_label,
  max_yr.yr                        AS year,
  SUM(c.establishment_count)       AS fl_establishments,
  SUM(c.employment)                AS fl_employment,
  SUM(c.annual_payroll)            AS fl_annual_payroll
FROM data_lake.census_cbp_fl c
CROSS JOIN max_yr
WHERE c.year = max_yr.yr
  AND c.fips_state = '12'
  -- Sector-level only: plain 2-digit (e.g. "23") or compound (e.g. "44-45").
  -- Excludes sub-sector (3-6 digit) codes and the "-" all-industries total.
  AND (
    c.naics_code ~ '^\d{2}$'
    OR c.naics_code ~ '^\d{2}-\d{2}$'
  )
GROUP BY c.naics_code, c.naics_label, max_yr.yr
ORDER BY fl_establishments DESC;

GRANT SELECT ON data_lake.census_cbp_fl_agg_by_naics TO service_role;
NOTIFY pgrst, 'reload schema';
