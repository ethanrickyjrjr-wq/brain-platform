-- docs/sql/20260702_projects_property_url.sql
-- Wave 1.5 (listing-link-photo-root): the user's own listing-page URL for a project.
-- Link chain: property_url → feed listing_url verbatim → unlinked. Never minted.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS property_url text;
