-- 20260605_marketbeat_swfl_mhs_extension.sql
--
-- Extends data_lake.marketbeat_swfl for the MHS (Maxwell Hendry Simmons)
-- multi-metric submarket extraction. The original table (20260525) carried only
-- vacancy / asking_rent_nnn / absorption_sqft from the C&W MarketBeat flow.
-- MHS adds six more geometry-extracted metrics, per-field verification, a
-- geographic-type tag, and an explicit report period.
--
-- Apply via Supabase SQL editor; idempotent on re-run (ADD COLUMN IF NOT EXISTS).
--
-- The legacy single `verified` bool is RETAINED — it is read-filtered by
-- refinery/packs/cre-swfl.mts (verified=eq.true) and
-- refinery/sources/marketbeat-swfl-source.mts (.eq("verified", true)), and is
-- written by the n8n landing flow. Dropping it, or converting it to a GENERATED
-- column, would break those consumers and the n8n writer. The new writer sets it
-- explicitly per row instead.

-- ── New metric columns (geometry-extracted, born-digital) ──────────────────────
ALTER TABLE data_lake.marketbeat_swfl
  ADD COLUMN IF NOT EXISTS inventory_sf        BIGINT,
  ADD COLUMN IF NOT EXISTS under_construction  BIGINT,
  ADD COLUMN IF NOT EXISTS deliveries          BIGINT,
  ADD COLUMN IF NOT EXISTS sale_price_psf      NUMERIC,
  ADD COLUMN IF NOT EXISTS sales_volume        BIGINT,
  ADD COLUMN IF NOT EXISTS vol_growth          NUMERIC;

-- ── Classification + reporting period ──────────────────────────────────────────
-- prior_12mo_ending is an INFERENCE (Consumption Contract v2.1), not a date read
-- from the PDF. Its provenance + falsifier live in prior_12mo_ending_source so the
-- inference is queryable and auditable downstream, not buried in a comment.
ALTER TABLE data_lake.marketbeat_swfl
  ADD COLUMN IF NOT EXISTS geographic_type         TEXT DEFAULT 'submarket',
  ADD COLUMN IF NOT EXISTS report_label            TEXT,
  ADD COLUMN IF NOT EXISTS prior_12mo_ending       DATE,        -- nullable; inferred (see source col)
  ADD COLUMN IF NOT EXISTS prior_12mo_ending_source TEXT;       -- provenance of the inferred period-end

-- ── Source provenance (ODD seam 4) + dedup discriminator (drift check #2) ──────
-- This one table now holds TWO un-auto-ingestable sources at different cadences:
--   'cw_marketbeat' (Cushman & Wakefield / LSI, QUARTERLY) and
--   'mhs_databook'  (Maxwell Hendry Simmons, ANNUAL — 2026 Data Book, pub 2026-03-13).
-- source_name is (1) the ODD provenance tag so manual/geometry rows never blend
-- blind into auto-feed signal, (2) the discriminator the consumer dedupes on, and
-- (3) the key each recipe + the freshness probe scope their cadence/window logic to.
-- COLLISION-WINNER RULE (drift check #2): on an identical (submarket, period),
-- 'mhs_databook' WINS (geometry-confirmed + per-field verified); 'cw_marketbeat' is
-- used only where MHS has no row. cre-swfl dedupes by (submarket, period) preferring
-- source_name = 'mhs_databook'.
ALTER TABLE data_lake.marketbeat_swfl
  ADD COLUMN IF NOT EXISTS source_name TEXT NOT NULL DEFAULT 'cw_marketbeat';

-- ── O5 RESOLVED: retain-both — widen UNIQUE to (submarket, quarter, source_name) ────────────
-- Decision (operator 2026-06-05): retain both source rows so the C&W↔MHS discrepancy stays
-- queryable (Data Provenance + Discrepancy Reporting rule). Read-time dedup in cre-swfl
-- applies the collision-winner rule (mhs_databook wins on identical (submarket, quarter)).
--
-- id format change (also applies to the n8n C&W writer — update it before the first write):
--   OLD: id = submarket || '_' || quarter
--   NEW: id = source_name || '_' || submarket || '_' || quarter
--   e.g. 'cw_marketbeat_bonita-springs_2026-Q1' / 'mhs_databook_bonita-springs_2026-Q1'
--
-- PERIOD-SEMANTICS NOTE (MHS rows only):
--   MHS does not publish a quarter label — it publishes a rolling "Prior 12 Months" window.
--   The `quarter` value for MHS rows is DERIVED from `prior_12mo_ending`:
--     quarter = to_char(prior_12mo_ending, 'YYYY-"Q"Q')   -- e.g. 2026-03-31 → '2026-Q1'
--   prior_12mo_ending is currently INFERRED (2026-03-31 via URL /2026/03/ + "QTD 2026" title;
--   stored in prior_12mo_ending_source). Until LittleBird item C is confirmed from the MHS
--   website, quarter = '2026-Q1' is TENTATIVE. If the confirmed date shifts (e.g. to 2026-06-30),
--   the key shifts to '2026-Q2'. The DROP/ADD below is idempotent; re-running after the confirmed
--   date only requires updating the writer's period stamp — no structural migration needed.

ALTER TABLE data_lake.marketbeat_swfl
  DROP CONSTRAINT IF EXISTS marketbeat_swfl_submarket_quarter_key;

ALTER TABLE data_lake.marketbeat_swfl
  ADD CONSTRAINT IF NOT EXISTS marketbeat_swfl_submarket_quarter_source_key
  UNIQUE (submarket, quarter, source_name);

-- ── Per-field verification (supersedes the all-or-nothing `verified` gate) ─────
ALTER TABLE data_lake.marketbeat_swfl
  ADD COLUMN IF NOT EXISTS verified_vacancy    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_rents      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_absorption BOOLEAN DEFAULT false;

-- Legacy `verified` column: intentionally NOT dropped (see header note).
