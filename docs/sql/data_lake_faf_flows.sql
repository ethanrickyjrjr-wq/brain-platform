-- =====================================================================
-- data_lake.faf_flows + faf_zone_lookup + faf_sctg_lookup
-- =====================================================================
-- FAF5 freight flows (and lookup tables) populated by the dlt pipeline at
-- ingest/pipelines/faf5/pipeline.py. Read live by refinery/sources/faf5-source.mts.
--
-- This file is version-controlled DDL — exact column shape is pinned in
-- ingest/pipelines/faf5/resources.py (_FLOW_COLUMNS + the zone/sctg lookup
-- resource definitions). dlt auto-creates the schema on first load using
-- those column hints; this DDL mirrors what dlt creates so the structure is
-- diff-able in code review without needing pg_dump access.
--
-- TIER: 2 (Postgres data_lake) — FAF5 is the documented exception to the
-- brain-first ingest gate per docs/API_BLUEPRINTS.md§five-locked-rules#5.
-- ORNL is the archive of record; this table is a working cache for
-- logistics-swfl.
--
-- DLT INTERNAL COLUMNS: dlt always adds _dlt_load_id (text) and _dlt_id
-- (text) as housekeeping columns. They're not consumed by faf5-source.mts
-- but their presence is part of the deployed schema and is therefore
-- documented here.
--
-- VERIFIED 2026-05-18: probed via refinery/__scratch__/probe-wave0-tables.mts
-- against BRAINS_SUPABASE_URL. Result:
--   data_lake.faf_flows         EXISTS — rows = 0  ← see "Empty table" note below
--   data_lake.faf_zone_lookup   EXISTS — rows = 26
--   data_lake.faf_sctg_lookup   EXISTS — rows = 42
--
-- EMPTY-TABLE NOTE: at probe time the flows table was 0 rows. The deployed
-- schema is correct; the data load is incomplete. To populate:
--   cd brain-platform && python -m ingest.pipelines.faf5.pipeline
-- See memory entry [[project_dlt-faf5-pipeline]] for run-state context.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Schema + grants. service_role is brain-platform's Supabase key role.
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA data_lake TO service_role;
GRANT SELECT ON data_lake.faf_flows        TO service_role;
GRANT SELECT ON data_lake.faf_zone_lookup  TO service_role;
GRANT SELECT ON data_lake.faf_sctg_lookup  TO service_role;


-- ---------------------------------------------------------------------
-- data_lake.faf_flows
-- ---------------------------------------------------------------------
-- One row per (dms_orig, dms_dest, sctg2, trade_type) tuple — every FAF5 zone
-- pair × commodity × trade mode that has FL on either end (filtered at
-- ingest by FL_ZONE_IDS in ingest/pipelines/faf5/constants.py).
--
-- Year columns: 13 years × 3 metric kinds = 39 columns. Historical = 2017-2024
-- (from FAF5.7.1). Forecasts = 2030, 2035, 2040, 2045, 2050. Bump FAF5_YEARS
-- in constants.py AND this CREATE TABLE when ORNL publishes the next vintage.
--
-- Units: tons_YYYY in thousand tons; value_YYYY in million USD;
-- tmiles_YYYY in million ton-miles.
--
-- write_disposition: replace (dlt) — pipeline truncates and re-loads. No
-- incremental state to preserve. ON CONFLICT not needed; PRIMARY KEY not
-- declared by dlt for replace-mode resources.

CREATE TABLE IF NOT EXISTS data_lake.faf_flows (
  dms_orig    BIGINT,
  dms_dest    BIGINT,
  sctg2       BIGINT,
  trade_type  BIGINT,

  -- Historical years (FAF5.7.1)
  tons_2017   DOUBLE PRECISION,
  tons_2018   DOUBLE PRECISION,
  tons_2019   DOUBLE PRECISION,
  tons_2020   DOUBLE PRECISION,
  tons_2021   DOUBLE PRECISION,
  tons_2022   DOUBLE PRECISION,
  tons_2023   DOUBLE PRECISION,
  tons_2024   DOUBLE PRECISION,
  -- Forecast years
  tons_2030   DOUBLE PRECISION,
  tons_2035   DOUBLE PRECISION,
  tons_2040   DOUBLE PRECISION,
  tons_2045   DOUBLE PRECISION,
  tons_2050   DOUBLE PRECISION,

  value_2017  DOUBLE PRECISION,
  value_2018  DOUBLE PRECISION,
  value_2019  DOUBLE PRECISION,
  value_2020  DOUBLE PRECISION,
  value_2021  DOUBLE PRECISION,
  value_2022  DOUBLE PRECISION,
  value_2023  DOUBLE PRECISION,
  value_2024  DOUBLE PRECISION,
  value_2030  DOUBLE PRECISION,
  value_2035  DOUBLE PRECISION,
  value_2040  DOUBLE PRECISION,
  value_2045  DOUBLE PRECISION,
  value_2050  DOUBLE PRECISION,

  tmiles_2017 DOUBLE PRECISION,
  tmiles_2018 DOUBLE PRECISION,
  tmiles_2019 DOUBLE PRECISION,
  tmiles_2020 DOUBLE PRECISION,
  tmiles_2021 DOUBLE PRECISION,
  tmiles_2022 DOUBLE PRECISION,
  tmiles_2023 DOUBLE PRECISION,
  tmiles_2024 DOUBLE PRECISION,
  tmiles_2030 DOUBLE PRECISION,
  tmiles_2035 DOUBLE PRECISION,
  tmiles_2040 DOUBLE PRECISION,
  tmiles_2045 DOUBLE PRECISION,
  tmiles_2050 DOUBLE PRECISION,

  -- dlt housekeeping columns (auto-added on every load)
  _dlt_load_id TEXT NOT NULL,
  _dlt_id      TEXT NOT NULL
);

-- Indexes: faf5-source.mts filters by dms_dest=129 and trade_type=1. The
-- table is small (~50 zones × ~50 zones × 42 commodities × 3 trade types =
-- ~315k rows max), so an index on (dms_dest, trade_type) is sufficient.
CREATE INDEX IF NOT EXISTS faf_flows_dest_trade_idx
  ON data_lake.faf_flows (dms_dest, trade_type);


-- ---------------------------------------------------------------------
-- data_lake.faf_zone_lookup
-- ---------------------------------------------------------------------
-- 26 rows (verified 2026-05-18). FAF5 zone_id → human-readable zone name +
-- state abbreviation. FL entries (121-129) are authoritative per
-- API_BLUEPRINTS.md; non-FL entries are representative aggregates.
--
-- Joined in TS by faf5-source.mts (not in SQL — supabase-js doesn't expose
-- cross-schema joins ergonomically and these tables are tiny enough that
-- the TS Map lookup is cheaper than a Postgres roundtrip).

CREATE TABLE IF NOT EXISTS data_lake.faf_zone_lookup (
  zone_id      BIGINT,
  zone_name    TEXT,
  state_abbr   TEXT,
  _dlt_load_id TEXT NOT NULL,
  _dlt_id      TEXT NOT NULL
);


-- ---------------------------------------------------------------------
-- data_lake.faf_sctg_lookup
-- ---------------------------------------------------------------------
-- 42 rows (verified 2026-05-18). SCTG 2-digit commodity code → name. Code 42
-- is unused; sequence goes 41 → 43. SWFL targets are 12 (gravel),
-- 31 (nonmetallic mineral products), 32 (base metals), 33 (articles of base
-- metal) per the brain's downstream filter.

CREATE TABLE IF NOT EXISTS data_lake.faf_sctg_lookup (
  sctg_code      BIGINT,
  commodity_name TEXT,
  _dlt_load_id   TEXT NOT NULL,
  _dlt_id        TEXT NOT NULL
);
