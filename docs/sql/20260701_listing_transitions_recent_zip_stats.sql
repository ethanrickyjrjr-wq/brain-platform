-- docs/sql/20260701_listing_transitions_recent_zip_stats.sql
-- Lifecycle-event digest for the Email/Social AI shared data spine: price cuts, new holdings
-- (departures from the active market, cause unknown), resolved sales, and new listings, at
-- region/county/zip grain, over a 30-day AND a 90-day trailing window in one pass. The loader
-- (lib/email/market-context.ts loadLifecycleDigest) picks 30d if it has any signal, else 90d,
-- so a slow-moving ZIP never reads as "nothing happening" just because 30 days is too tight a
-- window for real estate. `seed = false` drops the SteadyAPI cutover baseline (the 25,616 api_feed
-- transitions dated 2026-07-01, re-stamped seed=true by the seed_baseline_heal migration) so counts
-- reflect real day-to-day activity only. `listing_transitions` carries no geography
-- column, so this joins `listing_state` for zip_code/county via the (address_key, sale_or_rent) key.
--
-- Apply: bun scripts/run-migration.ts docs/sql/20260701_listing_transitions_recent_zip_stats.sql

CREATE OR REPLACE VIEW data_lake.listing_transitions_recent_zip_stats AS
WITH recent AS (
  SELECT t.*, s.zip_code, s.county
  FROM data_lake.listing_transitions t
  JOIN data_lake.listing_state s USING (address_key, sale_or_rent)
  WHERE t.source_name = 'api_feed'
    AND t.seed = false
    AND t.at >= current_date - interval '90 days'
)
SELECT
  county,
  zip_code,
  count(*) FILTER (WHERE at >= current_date - interval '30 days' AND from_state = to_state AND price_delta < 0) AS price_cuts_30d,
  count(*) FILTER (WHERE at >= current_date - interval '30 days' AND from_state = to_state AND price_delta > 0) AS price_raises_30d,
  count(*) FILTER (WHERE at >= current_date - interval '30 days' AND to_state = 'holding')                     AS new_holdings_30d,
  count(*) FILTER (WHERE at >= current_date - interval '30 days' AND to_state = 'sold')                        AS sales_30d,
  count(*) FILTER (WHERE at >= current_date - interval '30 days' AND from_state IS NULL)                       AS new_listings_30d,
  count(*) FILTER (WHERE from_state = to_state AND price_delta < 0) AS price_cuts_90d,
  count(*) FILTER (WHERE from_state = to_state AND price_delta > 0) AS price_raises_90d,
  count(*) FILTER (WHERE to_state = 'holding')                     AS new_holdings_90d,
  count(*) FILTER (WHERE to_state = 'sold')                        AS sales_90d,
  count(*) FILTER (WHERE from_state IS NULL)                       AS new_listings_90d,
  max(at) AS latest_at
FROM recent
GROUP BY GROUPING SETS ((county, zip_code), (county), ());

GRANT SELECT ON data_lake.listing_transitions_recent_zip_stats TO service_role;
NOTIFY pgrst, 'reload schema';
