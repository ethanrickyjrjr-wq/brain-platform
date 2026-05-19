-- FAF5 tables migrated to Cold Lane (lake-tier1 S3 Parquet).
-- Run in Supabase SQL editor after faf5_to_parquet.py upload completes.
DROP TABLE IF EXISTS data_lake.faf_flows CASCADE;
DROP TABLE IF EXISTS data_lake.faf_zone_lookup CASCADE;
DROP TABLE IF EXISTS data_lake.faf_sctg_lookup CASCADE;

-- Remove null-table_name rows left from the pre-FEMA _tier1_inventory schema.
-- dlt cannot add NOT NULL constraints while these exist.
DELETE FROM data_lake._tier1_inventory WHERE table_name IS NULL;
