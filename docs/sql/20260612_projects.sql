-- 20260612_projects.sql — per-user projects with the FIRST auth.uid() RLS policy.
-- Idempotent: safe to re-run. This is the repo's first row-level-security policy
-- (audit 2026-06-10 confirmed zero auth.uid() policies existed) — get it exact.
CREATE TABLE IF NOT EXISTS public.projects (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL,
  title       text,
  items       jsonb NOT NULL DEFAULT '[]'::jsonb,
  branding    jsonb,
  mcp_key     text UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Owner-scoped, FOR ALL, with BOTH USING (read/update/delete visibility) and
-- WITH CHECK (insert/update row ownership). duplicate_object guard = idempotent.
DO $$ BEGIN
  CREATE POLICY projects_owner_all ON public.projects
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- anon has no access at all; authenticated gets CRUD (RLS still scopes to owner);
-- service_role keeps full access for the MCP/build lane only (S6/S9) — NEVER the
-- cookie API, which must rely on RLS for ownership.
REVOKE ALL ON public.projects FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT  ALL ON public.projects TO service_role;
