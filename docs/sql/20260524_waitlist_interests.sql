-- Add the interests segmentation column the /connect waitlist needs.
-- Idempotent: safe to re-run. No policy changes; service_role still owns writes
-- (see 20260523_waitlist.sql for the original GRANT).

alter table public.waitlist
  add column if not exists interests text[] not null default '{}';
