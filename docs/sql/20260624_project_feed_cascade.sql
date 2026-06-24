-- 20260624_project_feed_cascade.sql
--
-- Bug fix: project_feed.project_id had no ON DELETE CASCADE, so deleting a project
-- that had bound feed rows (project_id IS NOT NULL) would throw a FK violation and
-- silently fail in the UI. Only projects with no bound feed rows were deletable.
--
-- Fix: drop the unnamed FK and re-add with ON DELETE CASCADE.
-- Idempotent: safe to re-run.

ALTER TABLE public.project_feed
  DROP CONSTRAINT IF EXISTS project_feed_project_id_fkey;

ALTER TABLE public.project_feed
  ADD CONSTRAINT project_feed_project_id_fkey
    FOREIGN KEY (project_id)
    REFERENCES public.projects(id)
    ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
