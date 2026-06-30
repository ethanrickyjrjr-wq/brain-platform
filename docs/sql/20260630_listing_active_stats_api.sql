-- docs/sql/20260630_listing_active_stats_api.sql
-- Re-point data_lake.listing_active_stats to the API feed (source_name='api_feed') and surface REAL
-- days-on-market. RentCast supplies a true daysOnMarket per active listing, so the column is no
-- longer forced NULL (the old view suppressed it because the Source-B scrape carried no real DOM and
-- our days_in_state tick under-counts for seed rows — see 20260627_listing_active_stats.sql header).
--
-- SteadyAPI-only listings carry no DOM and land days_on_market = NULL (never faked to 0), so
-- avg(days_on_market) — which skips NULL — reflects ONLY sourced RentCast DOM.
--
-- Same column shape as before (county, zip_code, listing_count, median_list_price,
-- avg_days_on_market, avg_list_price, latest_scraped_at), so the connector needs no column change.
--
-- APPLY ORDER (operator decree / advisor): seed source_name='api_feed' into listing_state FIRST,
-- THEN apply this CREATE OR REPLACE — otherwise the live brain reads 0 rows in the gap. The 10,459
-- existing source_name='lifecycle_seed' scrape rows are intentionally orphaned by this filter.
--
-- Apply via Bun.SQL (psql not installed): bun scripts/run-migration.ts docs/sql/20260630_listing_active_stats_api.sql

CREATE OR REPLACE VIEW data_lake.listing_active_stats AS
WITH active AS (
  SELECT *
  FROM data_lake.listing_state
  WHERE source_name = 'api_feed'
    AND state = 'active'
    AND sale_or_rent = 'sale'
    AND list_price IS NOT NULL
)
SELECT
  county,
  zip_code,
  count(*)::int                                                          AS listing_count,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY list_price))::bigint AS median_list_price,
  round(avg(days_on_market))::int                                        AS avg_days_on_market,  -- REAL now (RentCast); NULL-skipping avg
  round(avg(list_price))::bigint                                         AS avg_list_price,
  max(scraped_at)                                                        AS latest_scraped_at
FROM active
GROUP BY GROUPING SETS ((county, zip_code), (county), ());

GRANT SELECT ON data_lake.listing_active_stats TO service_role;
NOTIFY pgrst, 'reload schema';
