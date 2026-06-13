-- 20260612_email_schedule_claim_fn.sql
--
-- Atomic claim RPC for the multi-tenant email scheduler (Unit F — the cron
-- worker). `scripts/email/run-schedules.mts` calls this to pull the batch of due
-- schedules. The @supabase/supabase-js client speaks PostgREST and CANNOT hold a
-- `FOR UPDATE SKIP LOCKED` transaction across statements, so the lock lives in a
-- Postgres function called via `db.rpc("claim_due_email_schedules", ...)` — the
-- same idiom `lib/email/usage.ts` uses for `increment_email_sent_count`.
--
-- IDEMPOTENCY IS THE CONTRACT, NOT THE PROSE. GHA can spawn overlapping cron runs;
-- without the row lock two workers select the same due row before either advances
-- `next_run_at`, double-sending the tenant. The CTE takes the row locks with
-- `FOR UPDATE SKIP LOCKED` and the single `UPDATE ... RETURNING` is atomic, so two
-- concurrent workers get DISJOINT batches — no row claimed twice → no double-send.
--
-- PARK-ON-CLAIM: the claim sets `next_run_at = NULL`, so a claimed row cannot be
-- re-selected even before the worker re-arms it (the worker computes the next
-- occurrence per-row and writes it back in a `finally`). A row the worker never
-- re-arms (e.g. process crash) stays parked rather than re-firing — fail-safe, not
-- fail-loud-double-send.
--
-- The function RETURNS the full rows (incl. the cadence fields cadence /
-- day_of_week / day_of_month / send_hour_et) so the TS worker can compute the next
-- run with the shared `computeNextRunAt` helper.
--
-- Idempotent: CREATE OR REPLACE + idempotent GRANTs. Safe to re-run.

CREATE OR REPLACE FUNCTION public.claim_due_email_schedules(
  p_now   timestamptz,
  p_limit integer
) RETURNS SETOF public.email_schedules
LANGUAGE sql
AS $$
  WITH due AS (
    SELECT id FROM public.email_schedules
    WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= p_now
    ORDER BY next_run_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.email_schedules s
     SET next_run_at = NULL,        -- PARK: re-selection impossible until the worker re-arms it
         last_run_at = p_now,
         updated_at  = p_now
    FROM due
   WHERE s.id = due.id
  RETURNING s.*;
$$;

-- Default function EXECUTE is granted to PUBLIC (incl. anon) — revoke it and grant
-- explicitly. The worker calls this with the service-role client only; this RPC
-- claims+mutates ACROSS tenants (no user predicate), so it must NEVER be callable
-- by `authenticated` or `anon`. Service-role only, on purpose.
REVOKE EXECUTE ON FUNCTION public.claim_due_email_schedules(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_email_schedules(timestamptz, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
