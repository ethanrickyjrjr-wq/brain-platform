// scripts/deliverables/retention-sweep.mts
//
// FINAL BOSS Piece 4 — deliverables TRASH RETENTION SWEEP (daily cron).
// A standalone Bun process (NOT a Next route): the GHA cron invokes it daily and it
// hard-deletes deliverables that have been in the trash longer than the retention
// window. Soft-delete (`deleted_at`) is set by POST /api/deliverables/[id]/trash;
// this sweep is the only place trashed rows actually leave the table.
//
// INHERENTLY GUARDED: the filter is `deleted_at IS NOT NULL AND deleted_at < cutoff`,
// so it can NEVER touch a live row (deleted_at NULL) or a recently-trashed one. This
// is a BOUNDED DELETE, not a fetch — no PROBE-FIRST timing concern (it is documented
// out of the freshness probe in ingest/cadence_registry.yaml as a write-back).
//
// DRY_RUN (--dry-run or DRY_RUN=true): counts + prints what WOULD be deleted, mutates
// nothing — the operator's safe probe.
//
// EXIT CODES: clean run (incl. zero rows) → 0. A top-level fatal (missing env, query
// unreachable) → process.exit(1) so a GHA failure is loud.

import { createServiceRoleClient } from "@/utils/supabase/service-role";

const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const RETENTION_DAYS = 7;

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function main(): Promise<number> {
  const cutoff = cutoffIso(RETENTION_DAYS);
  console.log(
    `[deliverables-retention-sweep] start · DRY_RUN=${DRY_RUN} · retention=${RETENTION_DAYS}d · cutoff=${cutoff}`,
  );
  const db = createServiceRoleClient();

  if (DRY_RUN) {
    const { count, error } = await db
      .from("deliverables")
      .select("id", { count: "exact", head: true })
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);
    if (error) {
      console.error(`FATAL: count query failed — ${error.message}`);
      return 1;
    }
    console.log(
      `[dry-run] would hard-delete ${count ?? 0} trashed deliverable(s) older than ${RETENTION_DAYS}d`,
    );
    return 0;
  }

  const { data, error } = await db
    .from("deliverables")
    .delete()
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .select("id");
  if (error) {
    console.error(`FATAL: delete failed — ${error.message}`);
    return 1;
  }
  console.log(
    `[deliverables-retention-sweep] hard-deleted ${data?.length ?? 0} trashed deliverable(s) older than ${RETENTION_DAYS}d`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`FATAL: ${(e as Error).message}`);
    process.exit(1);
  });
