-- data_lake.active_listings_residential — region-wide SWFL residential active listings.
--
-- "For now" source = John R. Wood scrape (source_name='john_r_wood'); the licensed RESO feed
-- (swfl_mls/nabor) drops into the SAME table later (RESO ListingKey -> mls_id, StandardStatus ->
-- status, PostalCode -> zip_code), so the consuming brain never rebuilds when the source swaps.
--
-- PK (source_name, mls_id): idempotent upsert, multi-source by construction. zip_code is the SITE
-- address ZIP parsed from the listing URL (ZIP gate G1: site address only, never mailing).

CREATE TABLE IF NOT EXISTS data_lake.active_listings_residential (
  source_name      TEXT NOT NULL,
  mls_id           TEXT NOT NULL,
  list_price       NUMERIC,
  street_address   TEXT,
  city             TEXT,
  community        TEXT,
  beds             INTEGER,
  baths            NUMERIC,
  sqft             INTEGER,
  acres            NUMERIC,
  days_on_market   INTEGER,
  status           TEXT NOT NULL DEFAULT 'active',
  property_type    TEXT,
  zip_code         TEXT,
  county           TEXT,
  state            TEXT NOT NULL DEFAULT 'FL',
  listing_url      TEXT,
  scraped_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  _ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_name, mls_id)
);

CREATE INDEX IF NOT EXISTS idx_active_listings_res_zip
  ON data_lake.active_listings_residential (zip_code);
CREATE INDEX IF NOT EXISTS idx_active_listings_res_county_status
  ON data_lake.active_listings_residential (county, status);
CREATE INDEX IF NOT EXISTS idx_active_listings_res_scraped
  ON data_lake.active_listings_residential (scraped_at);

-- Grant PostgREST access (required after any data_lake table creation).
GRANT SELECT, INSERT, UPDATE, DELETE ON data_lake.active_listings_residential TO service_role;
NOTIFY pgrst, 'reload schema';
