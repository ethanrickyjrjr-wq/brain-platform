-- Aggregate view: length-weighted AADT + median truck factor per (county, year).
-- Replaces the 4.6k-row selectAllPaged + TS aggregateCountyYear() in fdot-source.mts.
-- tfctr stored as a percentage (0-92) in the raw table; the view normalises it
-- to a fraction (0-0.92) by dividing by 100 to match the fixture convention.
-- Column aliases match TrafficCountyYearNormalized in the TS source.
CREATE OR REPLACE VIEW data_lake.fdot_aadt_county_year AS
SELECT
  county,
  yearx                                                                        AS year,
  SUM(aadt::float * shape_length) / NULLIF(SUM(shape_length), 0)              AS weighted_avg_aadt,
  COALESCE(
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tfctr::float / 100), 0
  )                                                                            AS median_tfctr,
  SUM(shape_length)                                                            AS sum_shape_length,
  COUNT(*)                                                                     AS segment_count
FROM data_lake.fdot_aadt_fl
WHERE county IN ('Lee', 'Collier', 'Charlotte')
  AND aadt IS NOT NULL
  AND shape_length IS NOT NULL
  AND shape_length > 0
GROUP BY county, yearx
ORDER BY county, yearx;

GRANT SELECT ON data_lake.fdot_aadt_county_year TO service_role;
NOTIFY pgrst, 'reload schema';
