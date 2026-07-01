-- 20260701_projects_kind_subject_address.sql — Build 1 of the New Listing lifecycle.
-- Adds the listing anchor to public.projects: a distinct `kind` (NOT project_type,
-- which is the CRE asset-class) and an optional saved subject address.
-- Idempotent: ADD COLUMN IF NOT EXISTS, safe to re-run.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'general';

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS subject_address text;
