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

-- Drop the placeholder default so a writer that OMITS source_name fails loud
-- (NOT NULL violation) instead of silently mislabeling its rows as 'cw_marketbeat'.
-- Safe as of 2026-06-05: the n8n C&W flow was killed in PR #41 (2026-05-26) and
-- never inserted a row, so nothing relied on the default. Every live writer
-- (load_mhs.py, and any future C&W writer) sets source_name explicitly.
ALTER TABLE data_lake.marketbeat_swfl
  ALTER COLUMN source_name DROP DEFAULT;

-- ── Sector discriminator (REQUIRED before the 4-part UNIQUE below) ─────────────
-- CONVERGENCE FIX (2026-06-05): `sector` is the 2nd component of the UNIQUE key
-- below AND of the id format AND of cre-swfl's `&sector=eq.retail` read filter,
-- but it was added to the LIVE db OUT-OF-BAND — no committed migration ever
-- created it. So a clean repo-replay of docs/sql had NO `sector` column, and the
-- `ADD CONSTRAINT ... UNIQUE (source_name, sector, ...)` failed with
-- `column "sector" does not exist`. (This is the SAME clean-replay-vs-live
-- divergence the constraint-name block below claims to fix — it just missed the
-- column itself.) The MHS extraction populates one row per (sector, submarket,
-- quarter); live has 16 each of retail/industrial/office, 0 null.
ALTER TABLE data_lake.marketbeat_swfl
  ADD COLUMN IF NOT EXISTS sector TEXT;
-- Force presence on BOTH a clean build (empty table) and the live db (0 nulls),
-- so neither can drift to a NULL sector — a NULL would be treated as DISTINCT in
-- the UNIQUE key (silent duplicate) and would null the `||`-built id. Same
-- fail-loud posture as source_name. Idempotent: SET NOT NULL on an
-- already-NOT-NULL column is a no-op.
ALTER TABLE data_lake.marketbeat_swfl
  ALTER COLUMN sector SET NOT NULL;

-- ── O5 RESOLVED: retain-both — widen UNIQUE to (source_name, sector, submarket, quarter) ──────
-- Decision (operator 2026-06-05): retain both source rows so the C&W↔MHS discrepancy stays
-- queryable (Data Provenance + Discrepancy Reporting rule). Read-time dedup in cre-swfl
-- applies the collision-winner rule (mhs_databook wins on identical (sector, submarket, quarter)).
--
-- id format (also applies to the n8n C&W writer — update it before the first write):
--   id = source_name || '_' || sector || '_' || submarket || '_' || quarter
--   `submarket` is the RAW label verbatim (NOT a slug) — that is what load_mhs.py
--   writes and what is live today, e.g.:
--     'mhs_databook_retail_Bonita Springs_2026-Q1'   (raw "Bonita Springs", with the space)
--     'mhs_databook_retail_The Islands_2026-Q1'
--   The id is opaque (PK only) — nothing reads it; the pack canonicalizes the
--   submarket → clean place at READ time (places-swfl.mts), so the raw label in
--   the id never reaches a customer. Do NOT "slugify" the id: that would require
--   a truncate+reload for zero downstream benefit.
--
-- PERIOD-SEMANTICS NOTE (MHS rows only):
--   MHS does not publish a quarter label — it publishes a rolling "Prior 12 Months" window.
--   The `quarter` value for MHS rows is DERIVED from `prior_12mo_ending`:
--     quarter = to_char(prior_12mo_ending, 'YYYY-"Q"Q')   -- e.g. 2026-03-31 → '2026-Q1'
--   prior_12mo_ending is currently INFERRED (2026-03-31). Anchor = MHS 2026 Data Book pub date
--   2026-03-13 (a STRONGER anchor than the /2026/03/ URL guess) + the "QTD 2026" page title;
--   MHS prints no explicit period-end. Cadence (annual vs quarterly) is unconfirmed — LittleBird
--   item C. The full provenance + a RE-CHECK RANGE is stored per-row in prior_12mo_ending_source
--   (canonical value below — load_mhs.py off-main must write it VERBATIM):
--     "inferred 2026-03-31; anchor = MHS 2026 Data Book pub date 2026-03-13 + URL path /2026/03/
--      + \"QTD 2026\" title (MHS prints no explicit period-end). Cadence unconfirmed (annual vs
--      quarterly, item C). RE-CHECK mhsappraisal.com each quarter 2026-Q2..2027-Q1; if a newer
--      report or explicit period-end appears, update prior_12mo_ending + quarter. If none by
--      2027-03, treat as annual and 2026-03-31 stands."
--   Until item C is confirmed, quarter = '2026-Q1' is TENTATIVE. If the confirmed date shifts
--   (e.g. to 2026-06-30), the key shifts to '2026-Q2'. The DROP/ADD below is idempotent; re-running
--   after the confirmed date only requires updating the writer's period stamp — no structural
--   migration needed. (The 48 live rows were UPDATEd to this string 2026-06-05; idempotent.)

-- Drop ANY prior UNIQUE so the 4-part key is the ONLY one left, regardless of
-- which state the DB is in. This is the F1 repro fix — a clean repo-built DB and
-- the live DB must converge:
--   * marketbeat_swfl_submarket_quarter_key — the ORIGINAL 2-part key, auto-named
--     by the 20260525 CREATE TABLE `UNIQUE (submarket, quarter)`. On a clean
--     repo-built DB THIS is the constraint that exists; if it survives it rejects
--     the 2nd/3rd sector on a shared (submarket, quarter) → 32 of 48 MHS inserts
--     fail. The earlier version of this migration omitted it (dropped only the
--     sector-aware name below, which no committed SQL ever created), so the fix
--     only "worked" on a live DB that had been hand-swapped out-of-band.
--   * marketbeat_swfl_sector_submarket_quarter_key — the sector-aware 3-part key
--     applied out-of-band on the live DB (no committed migration created it).
--   * marketbeat_swfl_source_sector_submarket_quarter_key — the 4-part key this
--     migration adds; dropping it first makes the whole block idempotent on re-run.
ALTER TABLE data_lake.marketbeat_swfl
  DROP CONSTRAINT IF EXISTS marketbeat_swfl_submarket_quarter_key,
  DROP CONSTRAINT IF EXISTS marketbeat_swfl_sector_submarket_quarter_key,
  DROP CONSTRAINT IF EXISTS marketbeat_swfl_source_sector_submarket_quarter_key;

-- Correct 4-part retain-both key
ALTER TABLE data_lake.marketbeat_swfl
  ADD CONSTRAINT marketbeat_swfl_source_sector_submarket_quarter_key
  UNIQUE (source_name, sector, submarket, quarter);

-- ── Per-field verification (supersedes the all-or-nothing `verified` gate) ─────
ALTER TABLE data_lake.marketbeat_swfl
  ADD COLUMN IF NOT EXISTS verified_vacancy    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_rents      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_absorption BOOLEAN DEFAULT false;

-- Legacy `verified` column: intentionally NOT dropped (see header note).
