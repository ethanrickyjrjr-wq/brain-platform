-- 20260612_view_vintages.sql
-- Pivoted-Views build §08a — in-house ALFRED: point-in-time vintage capture.
--
-- Companion code: ingest/scripts/capture_view_vintages.py (the monthly capture) +
-- refinery/lib/backtest/view-vintage-reader.mts (the as_of→realtime_start mapper,
-- left UNWIRED until §08c). ZHVI/ZORI publish NO vintages (Zillow re-writes history),
-- so capturing the pivoted views as-of each run is the only way they ever become
-- backtestable. Each monthly capture records the FULL current series, so the initial
-- vintage (min as_of per period) reconstructs "what was first reported" later.
--
-- RUN THIS IN SUPABASE directly (CLAUDE.md RULE 1 — a session runs migrations, the
-- operator does not). IDEMPOTENT: CREATE … IF NOT EXISTS throughout, so re-running is
-- a no-op.
--
-- APPEND-ONLY BY GRANT: service_role gets INSERT + SELECT only — no UPDATE/DELETE.
-- as_of is the actual capture run date (CURRENT_DATE), NEVER backdated; the unique
-- index makes a same-day rerun a no-op (ON CONFLICT DO NOTHING in the capture).
--
-- ACCESS: GRANT to service_role only — this is internal backtest substrate, never a
-- public surface. NOT anon/authenticated.

BEGIN;

CREATE TABLE IF NOT EXISTS data_lake.view_vintages (
  view_name   TEXT        NOT NULL,
  as_of       DATE        NOT NULL,   -- the actual capture run date, NEVER backdated
  period      TEXT        NOT NULL,   -- the unpivoted period, e.g. 'YYYY-MM'
  series_key  TEXT        NOT NULL,   -- the unpivoted column name (e.g. 'cape_coral')
  value       DOUBLE PRECISION,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One value per (view, capture-date, period, series). A same-day rerun no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS view_vintages_uidx
  ON data_lake.view_vintages (view_name, as_of, period, series_key);

-- PIT read path: "all vintages of this view, ordered by capture date."
CREATE INDEX IF NOT EXISTS view_vintages_pit_idx
  ON data_lake.view_vintages (view_name, as_of);

GRANT INSERT, SELECT ON data_lake.view_vintages TO service_role;  -- append-only by grant

COMMIT;

-- PostgREST exposes the new table to the service-role client only after a schema reload.
NOTIFY pgrst, 'reload schema';

-- Verify after running:
--   SELECT count(*) FROM data_lake.view_vintages;                              -- 0 before first capture
--   SELECT view_name, as_of, count(*) FROM data_lake.view_vintages
--     GROUP BY view_name, as_of ORDER BY as_of;                               -- one group per monthly capture
