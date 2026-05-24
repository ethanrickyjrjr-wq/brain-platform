-- Zillow ZORI rent index — Tier 2 working cache for rentals-swfl brain.
-- Brain-first ingest gate satisfied: refinery/packs/rentals-swfl.mts ships in the same PR.
--
-- Source: Zillow Research ZIP-level smoothed all-homes rent index.
-- Tier 1 Parquet at s3://lake-tier1/market/zori_swfl.parquet.
-- Loader: ingest/pipelines/zori_swfl/ (dlt resource, write_disposition=merge).
--
-- Paste-and-run in the Supabase SQL editor — there is no migration infra.

CREATE TABLE IF NOT EXISTS data_lake.zori_swfl (
  zip_code     text        NOT NULL,
  period_end   date        NOT NULL,
  rent_index   numeric     NOT NULL,
  metro        text,
  county_name  text,
  city         text,
  ingested_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zip_code, period_end)
);

-- The PK already indexes (zip_code, period_end) — covers every ZIP-leading
-- filter for free. The standalone period_end index supports time-leading
-- rollups ("latest month across all ZIPs", vintage windows) that the PK
-- can't serve (wrong leading column).
CREATE INDEX IF NOT EXISTS idx_zori_swfl_period_end
  ON data_lake.zori_swfl (period_end);

GRANT SELECT ON data_lake.zori_swfl TO service_role;
