-- docs/sql/20260617_deliverables_soft_delete.sql
-- FINAL BOSS Piece 4 — soft-delete trash + version lineage on deliverables.
--
-- Additive + idempotent (CLAUDE.md RULE 1). Run AFTER 20260616_deliverables_scope.sql
-- (already applied in prod — confirmed live 2026-06-17). NEVER combine the two in a
-- single transaction; land them in sequence (04-piece-4-...md migration-sequencing note).
--
--   deleted_at    — soft-trash timestamp; NULL = live. A daily retention sweep
--                   (scripts/deliverables/retention-sweep.mts) hard-deletes rows where
--                   deleted_at < now() - 7 days. Restore = set back to NULL.
--   supersedes_id — version lineage: this row replaced that deliverable id. Set on
--                   refresh / content-edit, which fork a NEW row so a shared /p/[id]
--                   stays frozen for an external holder. NULL = an original ("head").

ALTER TABLE public.deliverables
  ADD COLUMN IF NOT EXISTS deleted_at    timestamptz,
  ADD COLUMN IF NOT EXISTS supersedes_id text;

-- Partial index: the retention sweep + the "Recently deleted" lane only ever scan
-- rows that are actually trashed.
CREATE INDEX IF NOT EXISTS deliverables_deleted_at_idx
  ON public.deliverables (deleted_at)
  WHERE deleted_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
