-- 20260613_deliverables.sql — assembled deliverable, frozen snapshot. Idempotent.
--
-- Session 6 (assembly engine). The deliverable is a FROZEN snapshot: `items_snapshot`
-- deep-copies the project's items + resolved chart blocks at build time so the hosted
-- /p/[id] page never drifts under its source project.
--
-- Trust model [LB-R5]: public SELECT by UNGUESSABLE slug (`id` is a full-entropy token
-- minted by the build route, never randomUUID().slice). Writes go through service_role
-- AFTER the build route proves project ownership via the cookie client. Public-SELECT is
-- the deliberate, bounded link=capability exception (share with a non-logged-in client),
-- made safe by the strong slug + /p/* rate limiting + owner revoke->410.
--
-- Consumers already on main (commit aaf7a10) read: page.tsx -> (id, template, status,
-- created_at) filtered by project_id; revoke route -> (user_id, status). This schema
-- is a strict superset of those; the build route fills narrative/items_snapshot/branding.

CREATE TABLE IF NOT EXISTS public.deliverables (
  id              text PRIMARY KEY,              -- unguessable, full-entropy slug
  project_id      text NOT NULL,
  user_id         uuid NOT NULL,
  template        text NOT NULL,
  instruction     text,
  narrative       jsonb NOT NULL,                -- { exec_summary, sections:[{title,intro}], inference_notes:[] }
  items_snapshot  jsonb NOT NULL,                -- deep copy of items + resolved chart blocks at build time
  branding        jsonb,
  status          text NOT NULL DEFAULT 'ready', -- ready | building | revoked (S7)
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The hosted page lists a project's deliverables (page.tsx: where project_id = ...);
-- the revoke route checks ownership by id. Index the project filter.
CREATE INDEX IF NOT EXISTS deliverables_project_idx ON public.deliverables (project_id);

ALTER TABLE public.deliverables ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY deliverables_public_select ON public.deliverables FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON public.deliverables TO anon, authenticated;
GRANT ALL    ON public.deliverables TO service_role;
