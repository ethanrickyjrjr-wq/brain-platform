-- 20260612_zori_pivoted_views_rollback.sql
-- REVERSE of 20260612_zori_pivoted_views.sql §06 (ZORI) — drops both pivoted views.
-- Clones the PROVEN ZHVI rollback (docs/sql/20260612_zhvi_pivoted_views_rollback.sql).
--
-- Forward migration:  docs/sql/20260612_zori_pivoted_views.sql
-- Companion plan:      docs/superpowers/plans/2026-06-12-pivoted-views-build/06-additional-views.md
--
-- WHAT THIS DOES: drops the two read-only views the forward migration created over
--   data_lake.zori_swfl. The BASE TABLE data_lake.zori_swfl is NEVER touched — these
--   are views only, so dropping them removes zero data. To restore, re-run the
--   forward migration (CREATE OR REPLACE VIEW); it rebuilds both from the same base
--   table with identical row counts.
--
-- DROP ORDER IS SAFE: both views depend ONLY on data_lake.zori_swfl; NEITHER view
--   depends on the other. So the two DROP statements are order-independent. We drop
--   zori_zip_latest first then zori_pivoted purely for readability (reverse of forward
--   creation order). DROP VIEW IF EXISTS is used (no CASCADE) — if some future object
--   were to depend on a view, the drop would error LOUD rather than silently
--   cascade-deleting it.
--
-- IDEMPOTENT: DROP VIEW IF EXISTS is a no-op when the view is already absent, so this
--   script is safe to re-run on already-dropped state (second run = no error).
--
-- RUN THIS DIRECTLY (CLAUDE.md RULE 1) — a session runs migrations, the operator does
--   not. Tested for-real on live prod 2026-06-12 (see SESSION-side notes): ran this
--   rollback (both views 404'd via live PostgREST), re-ran the forward migration
--   (both restored, counts verified live), confirmed a second rollback run is a clean
--   no-op.

BEGIN;

-- Reverse of forward creation order. Order-independent (no inter-view dependency);
-- IF EXISTS makes each a no-op when already absent. No CASCADE — fail loud, never
-- silently cascade-drop a dependent we didn't expect.
DROP VIEW IF EXISTS data_lake.zori_zip_latest;
DROP VIEW IF EXISTS data_lake.zori_pivoted;

COMMIT;

-- PostgREST caches the schema; without this reload the dropped views can linger in
-- the API surface (the inverse of risk register #9 — the same 404 class, in reverse).
NOTIFY pgrst, 'reload schema';

-- Verify after running:
--   SELECT count(*) FROM information_schema.views
--     WHERE table_schema='data_lake'
--       AND table_name IN ('zori_pivoted','zori_zip_latest');   -- expect 0
--   -- plus a LIVE PostgREST read of both → expect HTTP 404 (PGRST205, not in schema cache).
