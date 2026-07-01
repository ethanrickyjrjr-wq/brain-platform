-- docs/sql/20260630_market_aggregates_tables.sql
-- SteadyAPI Layer-B market aggregates (realtor.com origin; the access layer is never surfaced).
-- Two Tier-2 tables (time-series, append-with-captured_date — never a destructive replace) + one view
-- for the weekly momentum brain (derived from our OWN listing_state, no new raw table).
--
-- Consuming brains (brain-first gate, same PR):
--   data_lake.listing_price_histogram_swfl -> price-distribution-swfl
--   data_lake.market_details_swfl          -> market-temperature-swfl
--   data_lake.listing_momentum_stats (view)-> listing-momentum-swfl
--
-- Apply via Bun.SQL (psql not installed): bun scripts/run-migration.ts docs/sql/20260630_market_aggregates_tables.sql

CREATE SCHEMA IF NOT EXISTS data_lake;

-- ── Piece 2: price distribution (weekly, ~2 calls) ─────────────────────────────
CREATE TABLE IF NOT EXISTS data_lake.listing_price_histogram_swfl (
  county          text        NOT NULL,
  band_min        bigint      NOT NULL,
  band_max        bigint,
  band_range      text,
  listing_count   int         NOT NULL DEFAULT 0,
  total_listings  int,
  status          text,
  captured_date   date        NOT NULL,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  source_tag      text        NOT NULL DEFAULT 'realtor.com',
  PRIMARY KEY (county, band_min, captured_date)
);

-- ── Piece 3: per-ZIP market details (monthly, ~57 calls) ───────────────────────
-- Net-new headline = sold_to_rent_ratio (sold ÷ annual rent). The rest ride as cited context.
CREATE TABLE IF NOT EXISTS data_lake.market_details_swfl (
  zip_code               text        NOT NULL,
  county                 text,
  median_sold_price      bigint,
  median_listing_price   bigint,
  median_rent_price      bigint,
  median_days_on_market  int,
  median_price_per_sqft  int,
  local_hotness_score    numeric,
  list_to_sold_ratio_pct numeric,
  sold_to_rent_ratio     numeric,
  market_strength        text,
  is_competitive         boolean,
  captured_date          date        NOT NULL,
  captured_at            timestamptz NOT NULL DEFAULT now(),
  source_tag             text        NOT NULL DEFAULT 'realtor.com',
  PRIMARY KEY (zip_code, captured_date)
);

-- ── Piece 1: weekly leading momentum from our OWN active inventory ─────────────
-- Point-in-time flag shares off the SteadyAPI /search sweep (source_name='api_feed'). Works on week
-- one (no history replay), no metered calls. Empty-tolerant until the sweep runs. GROUPING SETS give
-- region / county / ZIP grains in one read (mirrors listing_active_stats).
CREATE OR REPLACE VIEW data_lake.listing_momentum_stats AS
WITH active AS (
  SELECT county, zip_code, flag_price_reduced, flag_new_listing, scraped_at
  FROM data_lake.listing_state
  WHERE source_name = 'api_feed'
    AND state = 'active'
    AND sale_or_rent = 'sale'
)
SELECT
  county,
  zip_code,
  count(*)::int                                                       AS active_listing_count,
  round(100.0 * avg((flag_price_reduced)::int), 1)                    AS price_reduced_share,
  round(100.0 * avg((flag_new_listing)::int), 1)                      AS new_listing_share,
  max(scraped_at)                                                     AS latest_scraped_at
FROM active
GROUP BY GROUPING SETS ((county, zip_code), (county), ());

-- ── Latest-snapshot views (the brains read these; keeps reads under the PostgREST 1000-row cap as the
--    time-series history grows) ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW data_lake.listing_price_histogram_swfl_latest AS
SELECT *
FROM data_lake.listing_price_histogram_swfl
WHERE captured_date = (SELECT max(captured_date) FROM data_lake.listing_price_histogram_swfl);

CREATE OR REPLACE VIEW data_lake.market_details_swfl_latest AS
SELECT *
FROM data_lake.market_details_swfl
WHERE captured_date = (SELECT max(captured_date) FROM data_lake.market_details_swfl);

GRANT SELECT ON data_lake.listing_price_histogram_swfl TO service_role;
GRANT SELECT ON data_lake.market_details_swfl TO service_role;
GRANT SELECT ON data_lake.listing_price_histogram_swfl_latest TO service_role;
GRANT SELECT ON data_lake.market_details_swfl_latest TO service_role;
GRANT SELECT ON data_lake.listing_momentum_stats TO service_role;
NOTIFY pgrst, 'reload schema';
