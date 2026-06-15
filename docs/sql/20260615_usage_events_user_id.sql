-- 20260615_usage_events_user_id.sql — A-8.5 meter uid-attribution. Idempotent, additive.
--
-- Adds a nullable `user_id` = the real `auth.uid` of the acting account, stamped on
-- BUILD events (web build route + MCP build tool) so the 30-day trial window (first
-- build per account, the watermark-toggle key) and every later per-account gate
-- (send paywall, MCP-connected discount, memory layer) read off ONE column.
--
-- SINGLE identity: auth.uid == the <uid> in client_id 'mcp:<uid>' == projects.user_id.
-- No parallel scheme. Null for anonymous/legacy rows — the signed sdg_cid client_id
-- still attributes those. No backfill (historical rows predate attribution).
--
-- Partial index: the trial/gate queries only ever filter attributed rows, so index
-- WHERE user_id IS NOT NULL (skips the large anonymous tail).

ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS user_id uuid;

CREATE INDEX IF NOT EXISTS usage_events_user_id_idx
  ON public.usage_events (user_id)
  WHERE user_id IS NOT NULL;
