-- Lee County building permits — Tier 2 working cache for permits-swfl brain.
-- Brain-first ingest gate satisfied: refinery/packs/permits-swfl.mts ships in the same PR.

CREATE TABLE IF NOT EXISTS data_lake.lee_building_permits (
  permit_id            text PRIMARY KEY,
  issued_date          date NOT NULL,
  permit_type_raw      text,
  permit_description_raw text,
  bucket               text NOT NULL CHECK (bucket IN (
                         'commercial_new', 'commercial_alteration',
                         'residential', 'demolition', 'other'
                       )),
  address              text,
  zip_code             text,
  lat                  double precision,
  lon                  double precision,
  declared_value_usd   numeric,
  status               text,
  _ingest_metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  _loaded_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lee_building_permits_issued_date
  ON data_lake.lee_building_permits (issued_date);
CREATE INDEX IF NOT EXISTS idx_lee_building_permits_bucket
  ON data_lake.lee_building_permits (bucket);
CREATE INDEX IF NOT EXISTS idx_lee_building_permits_zip
  ON data_lake.lee_building_permits (zip_code);

GRANT SELECT ON data_lake.lee_building_permits TO service_role;

-- Append a row to _tier1_inventory only if/when we archive older years to Parquet (v2).
-- v1 retention: trailing 5 years in this table; older rolls to Tier 1 Parquet via
-- quarterly cleanup job (deferred).
