-- Idempotent: email_events table for Resend webhook click/open tracking
CREATE TABLE IF NOT EXISTS public.email_events (
  id              bigserial PRIMARY KEY,
  resend_email_id text,
  rid             text,
  event           text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_events_event_check
    CHECK (event IN ('sent','delivered','opened','clicked','bounced','unsubscribed'))
);

CREATE INDEX IF NOT EXISTS email_events_rid_idx
  ON public.email_events (rid);

CREATE INDEX IF NOT EXISTS email_events_resend_email_id_idx
  ON public.email_events (resend_email_id);

-- Dedupe: same message can only fire each event once
CREATE UNIQUE INDEX IF NOT EXISTS email_events_dedupe_idx
  ON public.email_events (resend_email_id, event)
  WHERE resend_email_id IS NOT NULL;

-- RLS: service-role (bypasses) reads/writes; no user policy yet (operator-internal data)
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

GRANT INSERT, SELECT ON public.email_events TO service_role;
GRANT USAGE ON SEQUENCE public.email_events_id_seq TO service_role;
NOTIFY pgrst, 'reload schema';
