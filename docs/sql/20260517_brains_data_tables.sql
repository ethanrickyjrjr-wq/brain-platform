-- =====================================================================
-- Brains Supabase (jtkdowmrjaxfvwmemxso) — data tables migrated from
-- Premise Engine. Paste-and-run in the Brains SQL editor BEFORE running
-- scripts/migrate-from-premise.mts.
--
-- These tables were sourced from Premise Engine (tssgulkyczfefucmrtda).
-- Premise is kept alive temporarily — do not delete until all cross-DB
-- reads are confirmed gone.
-- =====================================================================

-- -----------------------------------------------------------------------
-- 1. corridor_profiles — CRE corridor intelligence (cre-source.mts)
-- Columns match the live Premise schema including the 2026-05-15 metrics
-- additions (cap_rate_pct, vacancy_rate_pct, etc.).
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS corridor_profiles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corridor_name           TEXT NOT NULL,
  city                    TEXT NOT NULL,
  corridor_type           TEXT,
  seasonal_index          NUMERIC,
  character               TEXT,
  evolution_direction     TEXT,
  tenant_mix              TEXT,
  active_flags            JSONB DEFAULT '[]'::jsonb,
  source_url              TEXT,
  verification_status     TEXT DEFAULT 'verified',
  deleted_at              TIMESTAMPTZ,
  cap_rate_pct            NUMERIC,
  cap_rate_direction      TEXT,
  vacancy_rate_pct        NUMERIC,
  vacancy_rate_direction  TEXT,
  metrics_period          TEXT,
  metrics_verified_date   DATE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corridor_profiles_cap_rate_direction_chk
    CHECK (cap_rate_direction IS NULL
           OR cap_rate_direction IN ('rising','falling','stable')),
  CONSTRAINT corridor_profiles_vacancy_rate_direction_chk
    CHECK (vacancy_rate_direction IS NULL
           OR vacancy_rate_direction IN ('rising','falling','stable')),
  CONSTRAINT corridor_profiles_cap_rate_pct_chk
    CHECK (cap_rate_pct IS NULL OR (cap_rate_pct >= 0 AND cap_rate_pct <= 30)),
  CONSTRAINT corridor_profiles_vacancy_rate_pct_chk
    CHECK (vacancy_rate_pct IS NULL OR (vacancy_rate_pct >= 0 AND vacancy_rate_pct <= 100))
);

-- -----------------------------------------------------------------------
-- 2. fl_dor_tdt_collections — FL DOR tourist development tax (tourism-tdt-source.mts)
-- 103 rows, Lee County, FY2013–FY2026.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fl_dor_tdt_collections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  county          TEXT NOT NULL,
  county_fips     TEXT,
  period          DATE NOT NULL,
  collections_usd NUMERIC,
  returns_filed   INTEGER,
  source_url      TEXT,
  retrieved_at    TIMESTAMPTZ
);

-- -----------------------------------------------------------------------
-- 3. sba_loans_by_naics_county — SBA sector credit by NAICS × county
--    (sector-credit-swfl-source.mts). On Premise this is a materialized
--    view; here it's a plain table loaded by the migration script.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sba_loans_by_naics_county (
  project_county         TEXT,
  project_state          TEXT,
  naics_code             TEXT,
  naics_description      TEXT,
  approval_fy            INTEGER,
  n_loans                INTEGER,
  total_approved         NUMERIC,
  n_chargeoffs           INTEGER,
  n_paid_in_full         INTEGER,
  chargeoff_pct          NUMERIC,
  total_chargeoff_amount NUMERIC
);

CREATE INDEX IF NOT EXISTS sba_naics_county_idx
  ON sba_loans_by_naics_county (project_county, approval_fy);

-- -----------------------------------------------------------------------
-- 4. (removed 2026-06-14) — the SBA franchise-outcomes table + its aggregation
--    function were an orphaned one-time Premise copy with no pipeline. Dropped;
--    see docs/sql/20260614_drop_sba_franchise_outcomes.sql. The franchise-outcomes
--    brain now reads its committed curated fixture only.
-- -----------------------------------------------------------------------

-- -----------------------------------------------------------------------
-- Grants — service_role already has full access. If you later create a
-- dedicated readonly role for the Refinery, grant it here:
--   GRANT SELECT ON corridor_profiles TO <readonly_role>;
--   GRANT SELECT ON fl_dor_tdt_collections TO <readonly_role>;
--   GRANT SELECT ON sba_loans_by_naics_county TO <readonly_role>;
-- -----------------------------------------------------------------------
