-- 20260617_project_feed.sql — the durable half of the context bus (FINAL BOSS Piece 3).
--
-- An agent no one sees writes situational signals here; Piece 2 reads them so a project AI
-- arrives already knowing what the user did Outside and what changed in the world for the
-- project's scope. NO live "two bots talking" — the two modes collaborate asynchronously
-- through this one table, keyed by project_id (Bound) or scope_kind/scope_value (Tier-2,
-- project_id NULL, late-bound at read time in readProjectFeed).
--
-- kind (free-text, NO enum — mirrors email_schedules.topic; closing the enum forces an ALTER
--   per new kind): outside-action | data-change | engagement | external-event | platform-feature.
--   MVP emits only outside-action (birth) + data-change (cron); the rest are designed-not-built.
--
-- scope_kind/scope_value reuse the email_schedules scope contract VERBATIM
--   (20260613_email_schedule_scope.sql): scope_kind in {NULL,'zip','place','county'}; scope_value
--   = canonical lowercase+trimmed; for 'place', ZIP expansion is DEFERRED to read time. Forking
--   this contract is a no-invention violation.
--
-- dedup_key UNIQUE = the at-most-once guarantee (mirrors email_send_ledger): cron re-runs +
--   webhook retries write via upsert ON CONFLICT DO NOTHING, so replays never double-post.
-- payload jsonb = convergence fuel (identity key, recipe ref, counts, broadcast_id) so P2's
--   cross-project index matches without re-deriving. void_at = soft-invalidate when the source
--   item is deleted (self-heal). read_at = P2/UI sets when a derived prompt is shown-and-dismissed.
--
-- RLS: auth.uid() = user_id (same shape as 20260612_projects.sql / 20260613_buyer_intent_events.sql).
--   service_role writes (cron + birth emits open their own client); owner reads via the cookie API.
-- id bigint GENERATED ALWAYS AS IDENTITY sidesteps the bigserial sequence-grant 42501 trap.
-- Append + soft-void only — no destructive write, so prepush Gate 4 does not apply.
-- Idempotent: safe to re-run. Run directly (creds .dlt/secrets.toml) — do NOT hand to the operator (RULE 1).

CREATE TABLE IF NOT EXISTS public.project_feed (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL,                        -- RLS anchor
  project_id   text REFERENCES public.projects(id),  -- NULLABLE (Tier-2 scope-keyed); text matches projects.id PK
  kind         text NOT NULL,                        -- free-text, NO enum (see header)
  scope_kind   text,                                 -- {NULL,'zip','place','county'}  VERBATIM email_schedules contract
  scope_value  text,                                 -- canonical lowercase+trimmed    VERBATIM contract
  title        text NOT NULL,                        -- one-line; deterministic or lint-passing (no-invention)
  detail       text,                                 -- optional body; same lint gate
  ref_url      text,                                 -- deep link to the item/chart/send/feature
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- convergence fuel: identity key, recipe ref, counts, broadcast_id
  dedup_key    text NOT NULL,                        -- idempotency; UNIQUE — mirrors email_send_ledger
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz,                          -- P2/UI sets when a derived prompt is shown-and-dismissed
  void_at      timestamptz                           -- soft-invalidate when source item is deleted
);

-- THE at-most-once guarantee: a globally-unique dedup_key (upsert ignoreDuplicates relies on it).
CREATE UNIQUE INDEX IF NOT EXISTS project_feed_dedup_uidx
  ON public.project_feed (dedup_key);

-- Bound reads: a project's own rows, newest first.
CREATE INDEX IF NOT EXISTS project_feed_project_created_idx
  ON public.project_feed (project_id, created_at DESC);

-- Tier-2 scope-keyed reads (project_id NULL): owner + scope, newest first.
CREATE INDEX IF NOT EXISTS project_feed_scope_idx
  ON public.project_feed (user_id, scope_kind, scope_value, created_at DESC)
  WHERE project_id IS NULL;

ALTER TABLE public.project_feed ENABLE ROW LEVEL SECURITY;

-- Owner-all policy copied VERBATIM from buyer_intent_events_owner_all (service_role writes via
-- BYPASSRLS; an authenticated owner reads/updates only their own rows). duplicate_object = idempotent.
DO $$ BEGIN
  CREATE POLICY project_feed_owner_all ON public.project_feed
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE ALL ON public.project_feed FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.project_feed TO authenticated;
GRANT  ALL ON public.project_feed TO service_role;

NOTIFY pgrst, 'reload schema';
