-- Piece 1 (FINAL BOSS — workspace shell): per-project UI / agent state bag.
--
-- The shared, additive state container for the live work environment: branding
-- collapse, MCP dismiss count, and later P2/P3 markers (last_freshness_token_seen,
-- dismissed_overlap_keys, last_digest_viewed_at). CROSS-BUILD CONTRACT: additive
-- keys ONLY — never repurpose an existing key. Connected-state still derives from
-- `mcp_key`, never from ui_state.
--
-- Additive + idempotent (RULE 1). Safe to re-run.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS ui_state jsonb NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
