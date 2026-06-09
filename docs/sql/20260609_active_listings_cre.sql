-- Active CRE listings table — corridor-gap filler for Estero + Fort Myers Beach.
-- These submarkets have no MarketBeat broker-survey coverage.
-- Source: Crexi (initial), LoopNet (future).
-- Consumer: refinery/sources/active-listings-source.mts → cre-swfl pack.

CREATE TABLE IF NOT EXISTS data_lake.active_listings_cre (
  id               TEXT PRIMARY KEY,
  source_name      TEXT NOT NULL,
  corridor_name    TEXT,
  address          TEXT,
  city             TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'FL',
  property_type    TEXT,
  sqft             INTEGER,
  asking_price_psf NUMERIC,
  status           TEXT NOT NULL,
  listed_date      DATE,
  source_url       TEXT,
  _ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_name, source_url)
);

GRANT SELECT ON data_lake.active_listings_cre TO service_role;
NOTIFY pgrst, 'reload schema';
