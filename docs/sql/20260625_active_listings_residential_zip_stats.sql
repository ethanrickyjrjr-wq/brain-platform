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
--
-- UPDATED 2026-06-26 (rental-contamination fix): two WHERE filters added so consumers read clean.
--   1. listing_type = 'sale'  — exclude monthly/seasonal RENTALS the scrape mixes into the same
--      table (a $1,200/mo lease was inflating count and dragging the median to a backwards $315k).
--      listing_type is set in ingest/pipelines/active_listings/distill.py (price-suffix span +
--      sub-$50k residential backstop). This makes the brain's "sale listings only" claim TRUE.
--   2. scraped_at recency  — the upsert never prunes, so delisted listings accumulate as stale rows
--      (~35% of the table). Keep only rows from the last 3 days of scrapes (relative to the freshest
--      row, so a paused cron degrades gracefully — the pack is empty-tolerant). Excludes the stale
--      tail that was inflating inventory counts.
-- NOTE: land (property_type='land') is still INCLUDED here (the brain's existing design + caveat).
-- The housing daily layer will read a residential-only (homes) cut via a separate filtered source.

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
WHERE source_name = 'active_listings_seed'
  AND status = 'active'
  AND list_price IS NOT NULL
  AND listing_type = 'sale'
  AND scraped_at >= (SELECT max(scraped_at) FROM data_lake.active_listings_residential)
                    - interval '3 days'
GROUP BY GROUPING SETS ((county, zip_code), (county), ());

GRANT SELECT ON data_lake.active_listings_residential_zip_stats TO service_role;
NOTIFY pgrst, 'reload schema';
