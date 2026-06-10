-- J2: Add site zip_code to collier_building_permits
-- Applied directly 2026-06-10 (creds in .dlt/secrets.toml).
-- MOAT gate: zip_code derives from site_address Census geocode only;
-- owner_zip / contractor_zip are mailing-grade and EXCLUDED by pipeline.py.
-- 2,072 of 4,975 rows backfilled; MOAT assertion: 0 out-of-scope ZIPs.
-- PostgREST reloaded via NOTIFY pgrst, 'reload schema'.

ALTER TABLE data_lake.collier_building_permits
    ADD COLUMN IF NOT EXISTS zip_code text;

CREATE INDEX IF NOT EXISTS idx_collier_permits_zip
    ON data_lake.collier_building_permits (zip_code);
