-- data_lake.active_listings_residential_zip_stats — aggregate-at-source view for the
-- active-listings-swfl brain. Pushes COUNT + median (percentile_cont) + avg DOM into SQL at THREE
-- grains via GROUPING SETS, so the consuming pack reads ~110 small rows instead of hauling ~5,000
-- listings (operator decree: aggregate at source). Median is computed per-grain in SQL — never a
-- median-of-medians.
--
-- Row grains (distinguish by null-ness):
--   county NOT NULL, zip_code NOT NULL -> ZIP grain      (detail_tables)
--   county NOT NULL, zip_code NULL     -> county grain   (per-county key context)
--   county NULL,     zip_code NULL     -> region grain   (headline key_metrics)

CREATE OR REPLACE VIEW data_lake.active_listings_residential_zip_stats AS
SELECT
  county,
  zip_code,
  count(*)::int                                                        AS listing_count,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY list_price))::bigint AS median_list_price,
  round(avg(days_on_market))::int                                      AS avg_days_on_market,
  round(avg(list_price))::bigint                                       AS avg_list_price,
  max(scraped_at)                                                      AS latest_scraped_at
FROM data_lake.active_listings_residential
WHERE source_name = 'john_r_wood'
  AND status = 'active'
  AND list_price IS NOT NULL
GROUP BY GROUPING SETS ((county, zip_code), (county), ());

GRANT SELECT ON data_lake.active_listings_residential_zip_stats TO service_role;
NOTIFY pgrst, 'reload schema';
