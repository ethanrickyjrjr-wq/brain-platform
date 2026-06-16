-- 20260616_deliverables_scope.sql
-- Adds the ZIP scope columns an "email" deliverable freezes at build time, so /p/[id]
-- and /p/[id]/print reconstruct the grounded model on every render without re-fetching.
--
-- UNAPPLIED — operator must apply + verify the prod columns before any code path reads
-- scope_kind/scope_value (this is the 4th unapplied migration; do NOT mark the
-- briefcase_email_pdf_deliverable check shipped until prod confirms the columns exist).
--
-- Apply:  psql "$DB_URI" -f docs/sql/20260616_deliverables_scope.sql
-- Verify: SELECT column_name FROM information_schema.columns
--          WHERE table_name = 'deliverables'
--            AND column_name IN ('scope_kind','scope_value');
--
-- No backfill. Old rows get NULL; buildEmailDeliverableModel returns null for a NULL
-- scope → GlobalDigestFallback. Correct fail-open behavior. Idempotent.

ALTER TABLE deliverables
  ADD COLUMN IF NOT EXISTS scope_kind  text,
  ADD COLUMN IF NOT EXISTS scope_value text;
