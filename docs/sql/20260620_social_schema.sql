-- 20260620_social_schema.sql
--
-- Social auto-posting backbone — 5 tables + 1 view + 1 claim RPC.
-- Sibling to the email product tables; user_id-namespaced from day 1.
--
-- Tables:
--   social_accounts       — token store (one row per connected platform account)
--   social_schedules      — recipe / cadence spec (mirrors email_schedules)
--   social_posts          — published-post identity + status (mirrors email_sends)
--   social_events         — append-only engagement ledger (polled, not webhooks)
--   social_send_ledger    — idempotency ledger (mirrors email_send_ledger)
-- View:
--   social_schedule_metrics — per-schedule rollup (mirrors outreach_campaign_metrics)
-- RPC:
--   claim_due_social_schedules — FOR UPDATE SKIP LOCKED + park-on-claim
--
-- Idempotent: safe to re-run (CREATE TABLE IF NOT EXISTS,
-- DO $$ duplicate_object guards, CREATE UNIQUE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE for view + function).
-- Run directly (creds .dlt/secrets.toml) — do NOT hand to the operator (CLAUDE.md RULE 1).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. social_accounts — OAuth token store per user+platform
--    SCHEMA ONLY here. Build 03 owns read/refresh logic.
--    RLS: auth.uid() = user_id (same posture as email_sender_config)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL,
  platform              text NOT NULL,                           -- x | facebook | instagram | linkedin | google_business
  platform_account_id   text NOT NULL,                          -- platform's own account/org ID
  access_token          text NOT NULL,                          -- encrypted at rest (build 03 handles encryption)
  refresh_token         text,                                   -- encrypted at rest; null for non-refresh platforms
  token_type            text,                                   -- e.g. "Bearer"
  expires_at            timestamptz,                            -- null = non-expiring
  scopes                text[] NOT NULL DEFAULT '{}',
  account_name          text,                                   -- human-readable handle/page name
  status                text NOT NULL DEFAULT 'connected',      -- connected | expired | revoked
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Unique per user+platform+account (one row per connected account, not per platform).
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_user_platform_account_uidx
  ON public.social_accounts (user_id, platform, platform_account_id);

ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY social_accounts_owner_all ON public.social_accounts
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE ALL ON public.social_accounts FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.social_accounts TO authenticated;
GRANT  ALL ON public.social_accounts TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. social_schedules — recipe + cadence per user + platform account
--    Mirrors email_schedules. Adds platform, scope (place/county/ZIP), hashtags,
--    media_kind, freshness_gate, and idempotent-upsert signature.
--    RLS: auth.uid() = user_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_schedules (
  id                  bigserial PRIMARY KEY,
  user_id             uuid NOT NULL,
  social_account_id   uuid NOT NULL,                    -- FK → social_accounts.id (soft; no cascade)
  platform            text NOT NULL,                    -- denormalized for fast claim query
  status              text NOT NULL DEFAULT 'active',   -- active | paused | stopped
  -- Cadence cols (mirrors email_schedules; computeNextRunAt reads these)
  cadence             text NOT NULL,                    -- daily | weekly | monthly
  day_of_week         smallint,                         -- 0-6 (weekly only)
  day_of_month        smallint,                         -- 1-28 (monthly only)
  send_hour_et        smallint NOT NULL,                -- Eastern wall-clock hour 0-23
  -- Scope (same contract as email_schedules / parse-scope; place|county|ZIP)
  scope_kind          text,                             -- zip | place | county | null = whole region
  scope_value         text,                             -- canonical lowercase trimmed
  -- Content
  content_template    text,                             -- e.g. "stat_card" | "carousel" | "scorecard"
  hashtags            text[] NOT NULL DEFAULT '{}',
  media_kind          text,                             -- e.g. "image" | "carousel"
  freshness_gate      boolean NOT NULL DEFAULT true,    -- skip if freshness_token unchanged (D7)
  signature           text,                             -- idempotent-upsert fingerprint (build 01 targets.ts)
  -- Timestamps (next_run_at = NULL while claimed = parked)
  next_run_at         timestamptz,
  last_run_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.social_schedules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY social_schedules_owner_all ON public.social_schedules
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE ALL ON public.social_schedules FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.social_schedules TO authenticated;
GRANT  ALL ON public.social_schedules TO service_role;
GRANT  USAGE ON SEQUENCE public.social_schedules_id_seq TO authenticated;
GRANT  USAGE ON SEQUENCE public.social_schedules_id_seq TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. social_posts — published-post identity + status record
--    Service-role only (no per-user RLS needed; the worker writes these).
--    Mirrors email_sends + outreach_recipients pattern.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_posts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_schedule_id    bigint,                           -- null for one-off posts
  social_account_id   uuid NOT NULL,
  platform            text NOT NULL,
  platform_post_id    text,                             -- null until published (or DRY mode)
  freshness_token     text,                             -- brain freshness at publish time
  caption             text NOT NULL,
  media_url           text,
  status              text NOT NULL DEFAULT 'queued',   -- queued | dry_run | published | failed
  error               text,
  idempotency_key     text NOT NULL,                    -- 'post:<scheduleId>:<YYYY-MM-DD>'
  published_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: one post per (schedule × date). Covers the claim-RPC + crash-replay window.
CREATE UNIQUE INDEX IF NOT EXISTS social_posts_idempotency_uidx
  ON public.social_posts (idempotency_key);

-- Fast lookup for freshness gate: "what freshness_token did we last post for this schedule?"
CREATE INDEX IF NOT EXISTS social_posts_schedule_idx
  ON public.social_posts (post_schedule_id, created_at DESC)
  WHERE post_schedule_id IS NOT NULL;

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_posts FROM anon, authenticated;
GRANT  ALL ON public.social_posts TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. social_events — append-only engagement ledger (polled, not webhooks)
--    Build 06 populates this via scheduled engagement polls.
--    Service-role only. Dedup on (platform_post_id, metric, captured_at window)
--    is enforced by build 06's poll logic (window-based, not a unique index).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_events (
  id                  bigserial PRIMARY KEY,
  social_post_id      uuid REFERENCES public.social_posts(id) ON DELETE CASCADE,
  platform_post_id    text NOT NULL,                    -- the engagement join key
  metric              text NOT NULL,                    -- like | comment | share | impression | click
  value               bigint NOT NULL DEFAULT 0,
  captured_at         timestamptz NOT NULL DEFAULT now(),
  source              text NOT NULL DEFAULT 'poll'      -- always 'poll' in v1
);

-- Dedup per (platform_post_id, metric) per capture day.
-- We store one row per (platform_post_id, metric, captured_date) where captured_date
-- is the UTC date string. Build 06 (the poll) passes captured_at with truncated dates
-- so this composite unique prevents double-inserts within a polling window.
-- Note: we cannot use (captured_at::date) in a unique index (not immutable in Postgres);
-- instead we use (platform_post_id, metric) per social_post_id as the dedup key
-- and rely on build 06's upsert ON CONFLICT for value updates.
CREATE UNIQUE INDEX IF NOT EXISTS social_events_dedup_post_metric_uidx
  ON public.social_events (social_post_id, metric)
  WHERE social_post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS social_events_post_idx
  ON public.social_events (social_post_id, metric);

CREATE INDEX IF NOT EXISTS social_events_captured_idx
  ON public.social_events (platform_post_id, captured_at);

ALTER TABLE public.social_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_events FROM anon, authenticated;
GRANT  ALL ON public.social_events TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. social_send_ledger — idempotency ledger for claimSocialOnce
--    Mirrors email_send_ledger exactly. The UNIQUE(idempotency_key) IS the
--    atomic at-most-once guarantee. Service-role only (worker writes).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_send_ledger (
  id                  bigserial PRIMARY KEY,
  user_id             uuid NOT NULL,
  idempotency_key     text NOT NULL,
  kind                text NOT NULL,                    -- post | nonce | …
  schedule_id         bigint,                           -- soft-link to social_schedules.id
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- THE at-most-once guarantee: a globally-unique key.
CREATE UNIQUE INDEX IF NOT EXISTS social_send_ledger_key_uidx
  ON public.social_send_ledger (idempotency_key);

ALTER TABLE public.social_send_ledger ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY social_send_ledger_owner_all ON public.social_send_ledger
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE ALL ON public.social_send_ledger FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.social_send_ledger TO authenticated;
GRANT  ALL ON public.social_send_ledger TO service_role;
GRANT  USAGE ON SEQUENCE public.social_send_ledger_id_seq TO authenticated;
GRANT  USAGE ON SEQUENCE public.social_send_ledger_id_seq TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. social_schedule_metrics view — per-schedule post + engagement rollup
--    Mirrors outreach_campaign_metrics. Read by /ops dashboard (build 06 + ops board).
--    Service-role only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.social_schedule_metrics AS
SELECT
  sp.post_schedule_id                                                       AS schedule_id,
  sp.platform,
  count(*)                                                                  AS total_posts,
  count(*) FILTER (WHERE sp.status = 'published')                          AS published,
  count(*) FILTER (WHERE sp.status = 'dry_run')                            AS dry_run,
  count(*) FILTER (WHERE sp.status = 'failed')                             AS failed,
  sum(se.value) FILTER (WHERE se.metric = 'like')                          AS total_likes,
  sum(se.value) FILTER (WHERE se.metric = 'comment')                       AS total_comments,
  sum(se.value) FILTER (WHERE se.metric = 'share')                         AS total_shares,
  sum(se.value) FILTER (WHERE se.metric = 'impression')                    AS total_impressions,
  sum(se.value) FILTER (WHERE se.metric = 'click')                         AS total_clicks,
  max(sp.published_at)                                                      AS last_published_at,
  max(sp.freshness_token)                                                   AS last_freshness_token
FROM public.social_posts sp
LEFT JOIN public.social_events se ON se.social_post_id = sp.id
GROUP BY sp.post_schedule_id, sp.platform;

REVOKE ALL ON public.social_schedule_metrics FROM anon, authenticated;
GRANT  SELECT ON public.social_schedule_metrics TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. claim_due_social_schedules RPC
--    Mirrors claim_due_email_schedules VERBATIM in structure.
--    FOR UPDATE SKIP LOCKED + park-on-claim (next_run_at = NULL).
--    Returns full rows so the TS worker can rearm next_run_at via computeNextRunAt.
--    Service-role only — NEVER callable by authenticated / anon.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_due_social_schedules(
  p_now   timestamptz,
  p_limit integer
) RETURNS SETOF public.social_schedules
LANGUAGE sql
AS $$
  WITH due AS (
    SELECT id FROM public.social_schedules
    WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= p_now
    ORDER BY next_run_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.social_schedules s
     SET next_run_at = NULL,         -- PARK: re-selection impossible until the worker re-arms it
         last_run_at = p_now,
         updated_at  = p_now
    FROM due
   WHERE s.id = due.id
  RETURNING s.*;
$$;

-- Service-role only — never callable by anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.claim_due_social_schedules(timestamptz, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_due_social_schedules(timestamptz, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
