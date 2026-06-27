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
-- UPDATED 2026-06-26 (rental-contamination fix): two filters added so consumers read clean.
--   1. listing_type = 'sale'  — exclude monthly/seasonal RENTALS the scrape mixes into the same
--      table (a $1,200/mo lease was inflating count and dragging the median to a backwards $315k).
--      listing_type is set in ingest/pipelines/active_listings/distill.py (price-suffix span +
--      sub-$50k residential backstop). This makes the brain's "sale listings only" claim TRUE.
--   2. per-county LATEST BATCH  — the upsert never prunes, so delisted listings accumulate as stale
--      rows. Each county's daily run stamps one identical scraped_at (the pipeline upserts once per
--      county), so we keep only rows at each county's own newest scraped_at. This is per-COUNTY, not
--      a global window, on purpose: the cron scrapes 4 counties daily at staggered hours and does
--      NOT schedule Glades/Hendry — a global "max - N days" window would silently EVICT any county
--      whose batch ages past N days (the rural pair, or any county whose cron breaks). Per-county
--      never drops a county: each shows its last known batch, dated by latest_scraped_at, so staleness
--      is visible (the pack quotes the as-of), never hidden. Window is 20h relative to each county's
--      OWN newest scraped_at: under the 24h daily-cron interval so the prior day's batch is excluded,
--      but wide enough that a stray one-off write (a single-listing test row with a later timestamp)
--      can't EVICT the real batch the way an exact `= max` match would — the window still spans the
--      main batch. Same-day re-runs are unioned (upsert dedups by mls_id, so this is near-harmless).
-- NOTE: land (property_type='land') is still INCLUDED here (the brain's existing design + caveat).
-- The housing daily layer will read a residential-only (homes) cut via a separate filtered source.

CREATE OR REPLACE VIEW data_lake.active_listings_residential_zip_stats AS
WITH sale_listings AS (
  SELECT *,
         max(scraped_at) OVER (PARTITION BY county) AS county_latest
  FROM data_lake.active_listings_residential
  WHERE source_name = 'active_listings_seed'
    AND status = 'active'
    AND list_price IS NOT NULL
    AND listing_type = 'sale'
)
SELECT
  county,
  zip_code,
  count(*)::int                                                        AS listing_count,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY list_price))::bigint AS median_list_price,
  round(avg(days_on_market))::int                                      AS avg_days_on_market,
  round(avg(list_price))::bigint                                       AS avg_list_price,
  max(scraped_at)                                                      AS latest_scraped_at
FROM sale_listings
WHERE scraped_at >= county_latest - interval '20 hours'
GROUP BY GROUPING SETS ((county, zip_code), (county), ());

GRANT SELECT ON data_lake.active_listings_residential_zip_stats TO service_role;
NOTIFY pgrst, 'reload schema';
