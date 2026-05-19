-- TOMBSTONE: dlt now owns the _tier1_inventory table schema.
-- See ingest/lib/tier1_inventory.py for the current shape.
-- This file is retained for history only. Do not run it.

-- data_lake._tier1_inventory
-- Audit-trail table for Tier 1 Parquet files in Supabase Storage.
-- Every DuckDB-ingest pipeline writes one row per Parquet file it produces.
-- Required by Data Tier Policy rule §2.

CREATE TABLE IF NOT EXISTS data_lake._tier1_inventory (
    id           text PRIMARY KEY,                       -- "{bucket}/{path}"
    bucket       text NOT NULL,
    path         text NOT NULL,
    vintage      text,                                   -- free-form, e.g. "1996-2025", "2024-Q4"
    byte_size    bigint,
    pack_id      text,                                   -- consuming pack id, nullable for not-yet-consumed files
    source_url   text,                                   -- original upstream URL pattern, for re-fetch traceability
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tier1_inventory_pack ON data_lake._tier1_inventory (pack_id);
CREATE INDEX IF NOT EXISTS idx_tier1_inventory_bucket_path ON data_lake._tier1_inventory (bucket, path);

GRANT SELECT, INSERT, UPDATE ON data_lake._tier1_inventory TO service_role;
