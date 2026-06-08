-- docs/sql/20260608_data_requests.sql  (idempotent)
-- P10 — Chat→data logging + data-gap affordance.
--
-- Records every question asked via /api/converse: what fact was selected,
-- the question text, which upstream brains were reached, and whether the
-- answer was grounded in the payload (answered=true) or hit a data gap
-- (answered=false).  answered=false rows feed the "Ask for More Data"
-- affordance in HighlightPopup and will power the §4 data_targets loop
-- once enough gap-signal accumulates.
--
-- ACCESS: service_role ONLY — user questions are not public data.
-- anon and authenticated must be DENIED (mirrors the P2 security guardrail
-- applied to backtest_grades, data_targets, glass views).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS,
-- so re-running is a no-op.

BEGIN;

CREATE TABLE IF NOT EXISTS public.data_requests (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id   text        NOT NULL,
  fact        text,                        -- selected figure / section context (nullable)
  question    text        NOT NULL,
  reach       text[]      NOT NULL DEFAULT '{}',
  answered    boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Lookup by report so we can aggregate gap-signal per brain.
CREATE INDEX IF NOT EXISTS data_requests_report_idx
  ON public.data_requests (report_id);

-- Lookup by gap (answered=false) for data-targets feed.
CREATE INDEX IF NOT EXISTS data_requests_gap_idx
  ON public.data_requests (answered)
  WHERE answered = false;

-- service_role only.
GRANT INSERT, SELECT ON public.data_requests TO service_role;

-- Explicitly deny anon + authenticated (Supabase default-privilege blanket
-- would otherwise grant SELECT to anon on every new public table/view).
REVOKE ALL ON public.data_requests FROM anon, authenticated;

COMMIT;

-- PostgREST must reload schema to see the new table.
NOTIFY pgrst, 'reload schema';

-- Verify after running:
--   SELECT count(*) FROM public.data_requests;                     -- 0 before first ask
--   SELECT has_table_privilege('anon','data_requests','SELECT');   -- must be false
--   SELECT has_table_privilege('service_role','data_requests','INSERT'); -- must be true
