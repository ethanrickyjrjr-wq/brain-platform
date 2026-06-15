-- 2026-06-15 — Briefcase Everywhere, Plan B (Carry-Back Bridge), Task B-1.
--
-- Short-TTL, single-use carry-back token store. An anonymous `swfl_project_handoff`
-- MCP call mints a row here holding the items the conversation assembled; the
-- /claim flow consumes it ONCE (atomically) after the user signs in, then inserts
-- the project under their real auth.uid.
--
-- ACCESS MODEL: service_role is the ONLY accessor (via lib/claim/claim-store.ts).
-- There is NO anon/authenticated RLS policy, so PostgREST default-denies every
-- client read/write of token rows — the opaque token never leaves the server and
-- the consume happens only through a server endpoint.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE) — safe to re-run. No destructive
-- write (CREATE TABLE IF NOT EXISTS) → no Gate-4 concern.

CREATE TABLE IF NOT EXISTS public.claim_tokens (
  token       text PRIMARY KEY,             -- high-entropy, opaque, URL-safe (base64url)
  items       jsonb NOT NULL,               -- the ProjectItem[] to carry over
  title       text,
  project_id  text,                         -- written AFTER the winner's insert (observability/cleanup only)
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,         -- created_at + ~15 min
  consumed_at timestamptz                   -- set by the UPDATE-guarded consume below
);

CREATE INDEX IF NOT EXISTS claim_tokens_expires_at_idx
  ON public.claim_tokens (expires_at);

ALTER TABLE public.claim_tokens ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policy => RLS default-denies all client (PostgREST) access.
-- service_role bypasses RLS; that is the ONLY accessor (via claim-store.ts).
REVOKE ALL ON public.claim_tokens FROM anon, authenticated;
GRANT ALL ON public.claim_tokens TO service_role;

-- The UPDATE-guarded consume, as ONE atomic statement evaluated server-side.
-- * Guard `consumed_at IS NULL` makes it single-use and row-locked: under two
--   concurrent callers, the second blocks on the row lock, re-checks the qual
--   (now false), updates 0 rows, and returns nothing — exactly one winner.
-- * Guard `expires_at > now()` uses the SERVER clock (no client-time trust), so an
--   expired token is never consumed (its consumed_at stays NULL) and is classified
--   `expired` by a follow-up non-consuming peek in claim-store.ts.
-- This is the UPDATE-guarded consume — NOT the INSERT-ON-CONFLICT `claimOnce`
-- primitive (lib/email/idempotency.ts). It mirrors `claim_due_email_schedules`.
CREATE OR REPLACE FUNCTION public.consume_claim_token(p_token text)
RETURNS TABLE (items jsonb, title text)
LANGUAGE sql
AS $$
  UPDATE public.claim_tokens AS ct
     SET consumed_at = now()
   WHERE ct.token = p_token
     AND ct.consumed_at IS NULL
     AND ct.expires_at > now()
  RETURNING ct.items, ct.title;
$$;

-- The consume is server-only: revoke EXECUTE from PUBLIC/clients, grant service_role.
-- (CREATE FUNCTION grants EXECUTE to PUBLIC by default — this closes that.)
REVOKE ALL ON FUNCTION public.consume_claim_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_claim_token(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_claim_token(text) TO service_role;
