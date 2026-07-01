-- docs/sql/20260701_rentals_swfl_table.sql
-- SteadyAPI active rental listing inventory (realtor.com origin; the access layer is never surfaced).
-- One Tier-2 table (time-series, append-with-captured_date — never a destructive replace) + a latest
-- view + an aggregate-at-source stats view (count + observed price MIN/MAX only — never a derived
-- median off the per-listing min/max ranges; the source-faithful median rent per ZIP already lives in
-- data_lake.market_details_swfl via market-temperature-swfl).
--
-- Consuming brain (brain-first gate, same PR): data_lake.rental_listing_stats -> active-rentals-swfl
--
-- Apply via Bun.SQL (psql not installed): bun scripts/run-migration.ts docs/sql/20260701_rentals_swfl_table.sql

CREATE SCHEMA IF NOT EXISTS data_lake;

CREATE TABLE IF NOT EXISTS data_lake.rental_listings_swfl (
  property_id     text        NOT NULL,
  county          text        NOT NULL,
  zip_code        text,
  city            text,
  address_line    text,
  property_type   text,
  price_min       int,
  price_max       int,
  beds_min        int,
  beds_max        int,
  baths_min       int,
  baths_max       int,
  sqft_min        int,
  sqft_max        int,
  captured_date   date        NOT NULL,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  source_tag      text        NOT NULL DEFAULT 'realtor.com',
  PRIMARY KEY (property_id, captured_date)
);

CREATE OR REPLACE VIEW data_lake.rental_listings_swfl_latest AS
SELECT *
FROM data_lake.rental_listings_swfl
WHERE captured_date = (SELECT max(captured_date) FROM data_lake.rental_listings_swfl);

-- Aggregate-at-source stats (region / county / ZIP via GROUPING SETS, mirrors
-- data_lake.listing_momentum_stats). count + observed price range only — MIN/MAX of the vendor's own
-- per-listing price.min/price.max fields is a safe aggregate function, never a synthesized median.
CREATE OR REPLACE VIEW data_lake.rental_listing_stats AS
WITH latest AS (
  SELECT *
  FROM data_lake.rental_listings_swfl_latest
)
SELECT
  county,
  zip_code,
  count(*)::int                AS rental_listing_count,
  min(price_min)                AS observed_price_min,
  max(price_max)                AS observed_price_max,
  max(captured_date)            AS captured_date
FROM latest
GROUP BY GROUPING SETS ((county, zip_code), (county), ());

GRANT SELECT ON data_lake.rental_listings_swfl TO service_role;
GRANT SELECT ON data_lake.rental_listings_swfl_latest TO service_role;
GRANT SELECT ON data_lake.rental_listing_stats TO service_role;
NOTIFY pgrst, 'reload schema';
