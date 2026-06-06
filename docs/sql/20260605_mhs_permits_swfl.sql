-- 20260605_mhs_permits_swfl.sql
--
-- ODD scaffold for Recipe 2 — MHS (Maxwell Hendry Simmons) building permits.
-- Source: 2026 Data Book, section "ISSUED PERMITS 2025".
--
-- DO NOT blend with data_lake.lee_building_permits or
-- data_lake.collier_building_permits (Accela feed). Those tables hold
-- ingestable permit streams; this table holds geometry-extracted annual
-- snapshots from a manual PDF. Blending before a verified crosswalk +
-- consumer brain update causes double-counting.
--
-- Grain: individual permit rows grouped by raw jurisdiction string.
-- Jurisdictions are NOT submarket slugs — a separate crosswalk is required.
-- Known jurisdictions (2025 cohort):
--   Unincorporated Lee County, City of Cape Coral, Unincorporated Collier,
--   City of Naples, City of Marco Island, Unincorporated Charlotte County,
--   City of Punta Gorda, Town of Fort Myers Beach.
-- Crosswalk spec: docs/littlebird-notes/2026-06-05.md (item D).
--
-- Period: full calendar year 2025 (confirmed from PDF — dates span 01/xx–12/xx).
-- Stamp as calendar_year = 2025. No explicit "January 1 – December 31" in PDF.
--
-- ODD provenance tag: source_name = 'mhs_databook' on every row so no future
-- Accela or other permit write can blend silently (NOT NULL, no default — same
-- hard gate as data_lake.marketbeat_swfl after the 20260605 migration).
--
-- id convention (deterministic composite the writer sets at upsert time):
--   source_name||'_'||sanitized_jurisdiction||'_'||issued_date::text||'_'||
--   substr(md5(coalesce(project_name,'')||'|'||coalesce(project_address,'')),1,12)
-- Widened from an 8-hex md5(project_name): two distinct permits on the same
-- jurisdiction+date whose project_name is identical (or collides in the first
-- 8 hex chars) would otherwise OVERWRITE each other on upsert — and permit rows
-- are individual-grain. Folding in project_address and using a 12-hex digest
-- makes that collision negligible.
-- issued_date + project_name are NOT NULL (below) so no id component is ever NULL
-- (a NULL component makes the whole `||` expression NULL → PK violation).

CREATE TABLE IF NOT EXISTS data_lake.mhs_permits_swfl (
  id                TEXT         PRIMARY KEY,
  -- ODD provenance — always 'mhs_databook'; NOT NULL, no default
  source_name       TEXT         NOT NULL,
  -- Raw jurisdiction string from the PDF (not a submarket slug)
  jurisdiction      TEXT         NOT NULL,
  calendar_year     INTEGER      NOT NULL,
  issued_date       DATE         NOT NULL,   -- "Date" column (MM/DD/YYYY in source); PK component
  asset_class       TEXT,                    -- "Asset Class" column
  project_address   TEXT,                    -- "Project Address" column (folded into id digest)
  project_name      TEXT         NOT NULL,   -- "Project Name" column; PK component
  permit_value_usd  NUMERIC,                 -- "Permit Value" column (USD)
  building_sf       BIGINT,                  -- "Building SF" column
  -- Spot-check gate (matches mhs_databook pattern on marketbeat_swfl).
  -- Land false; flip to true after review before wiring the consumer brain.
  verified          BOOLEAN      NOT NULL DEFAULT false,
  source_url        TEXT,
  _ingested_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Drop the placeholder default so a writer omitting source_name fails loud
-- (same hard gate applied to marketbeat_swfl on 2026-06-05).
ALTER TABLE data_lake.mhs_permits_swfl
  ALTER COLUMN source_name DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_mhs_permits_swfl_jurisdiction
  ON data_lake.mhs_permits_swfl (jurisdiction);
CREATE INDEX IF NOT EXISTS idx_mhs_permits_swfl_calendar_year
  ON data_lake.mhs_permits_swfl (calendar_year);
CREATE INDEX IF NOT EXISTS idx_mhs_permits_swfl_issued_date
  ON data_lake.mhs_permits_swfl (issued_date);

GRANT SELECT ON data_lake.mhs_permits_swfl TO service_role;
