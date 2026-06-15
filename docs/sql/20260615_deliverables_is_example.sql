-- 20260615_deliverables_is_example.sql — A-4 live example deliverables. Idempotent, additive.
--
-- Marks the seeded /p/example-* deliverables (built by the example-rebuild cron through
-- the REAL deliverable engine, via service_role under a reserved sentinel user_id) so
-- they are filterable and excluded from user-scoped analytics. Default false = every
-- existing row and every user-built deliverable stays a real, non-example deliverable.
--
-- Partial index: only the handful of example rows are ever filtered ON is_example, so
-- index WHERE is_example = true (skips the user-deliverable bulk).

ALTER TABLE public.deliverables ADD COLUMN IF NOT EXISTS is_example boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS deliverables_is_example_idx
  ON public.deliverables (is_example)
  WHERE is_example = true;
