// scripts/project-feed/change-detection.mts
//
// Piece 3 (Signal Layer) Track B — the `data-change` cron RUNNER (adapter half).
// A standalone Bun process (NOT a Next route): the GHA cron invokes it daily,
// after the daily-rebuild window, so it reads the freshest COMMITTED brains/*.md
// off the checkout. It detects when a tracked per-ZIP brain metric moved for a ZIP
// some user's project scopes, and appends a scope-keyed `data-change` row to
// public.project_feed (P2 reads it). A brain's freshness token only changes when
// the brain is re-refined (housing-swfl/rentals-swfl ~monthly), so on most days
// the value is unchanged → reconcile `verified` → nothing is written (no noise).
//
// ARCHITECTURE — same split as scripts/email/run-schedules.mts: every DECISION
// lives in the pure, unit-tested core (lib/project/change-detection.ts). This file
// is the ADAPTER: it builds the real seams (service-role client, brain disk reads
// via the same loadParsedBrain→factFromParsedBrain path swfl_reconcile uses,
// project + feed queries, writeFeed) and owns top-level fatal handling + exit code.
//
// READS (PROBE FIRST — bounded by construction): ZIP_SIGNAL_BRAINS.length brain
// loads (local .md + JSON parse) + in-memory per-ZIP cell reads + ONE batched
// project_feed query. No multi-minute API ingest. The brain-first / destructive-
// write gates DON'T apply (append-only to an app table); PROBE FIRST does.
//
// DRY_RUN (--dry-run or DRY_RUN=true): a plain read-only pass — computes and PRINTS
// every would-write row, never calls writeFeed, never mutates prod. This is the
// operator's live probe.
//
// EXIT CODES: a clean run (incl. zero rows) → 0. A top-level fatal (missing env,
// can't construct the client, projects query unreachable) → process.exit(1) (loud
// — a GHA failure must be visible). Per-(brain/zip/user) errors NEVER change it.

import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { loadParsedBrain } from "@/lib/fetch-brain";
import { factFromParsedBrain } from "@/lib/reconcile/lane1";
import { projectScopeSet } from "@/lib/project/project-scope";
import { writeFeed, type FeedRowInput } from "@/lib/project/feed";
import {
  ZIP_SIGNAL_BRAINS,
  buildScopeUserMap,
  decideDataChange,
  indexPriorSnapshots,
  type ProjectZips,
  type PriorFeedRow,
} from "@/lib/project/change-detection";
import type { ProjectItem } from "@/lib/project/items";

const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";

function ms(t0: number): string {
  return `${(performance.now() - t0).toFixed(0)}ms`;
}

async function main(): Promise<number> {
  console.log(`[project-feed-change-detection] start · DRY_RUN=${DRY_RUN}`);
  const db = createServiceRoleClient();

  // 1. Live scope set — all projects → zip → users fan-out map.
  const { data: projects, error: projErr } = await db.from("projects").select("id,user_id,items");
  if (projErr) {
    console.error(`FATAL: projects query failed — ${projErr.message}`);
    return 1;
  }
  const projectZips: ProjectZips[] = [];
  for (const p of projects ?? []) {
    const items = Array.isArray(p.items) ? (p.items as ProjectItem[]) : [];
    try {
      const zips = projectScopeSet(items)
        .filter((s) => s.scope_kind === "zip")
        .map((s) => s.scope_value);
      if (zips.length) projectZips.push({ user_id: p.user_id, zips });
    } catch (e) {
      console.warn(`  skip project ${p.id}: scope derive threw — ${(e as Error).message}`);
    }
  }
  const zipUsers = buildScopeUserMap(projectZips);
  const uniqueZips = [...zipUsers.keys()];
  console.log(
    `  ${projects?.length ?? 0} projects · ${projectZips.length} zip-scoped · ${uniqueZips.length} unique live ZIPs`,
  );
  if (uniqueZips.length === 0) {
    console.log("  no live ZIP scopes — nothing to detect. Done.");
    return 0;
  }

  // 2. Prior snapshots — one batched read of recent data-change rows.
  const { data: feedRows, error: feedErr } = await db
    .from("project_feed")
    .select("user_id,scope_value,payload")
    .eq("kind", "data-change")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (feedErr) {
    console.error(`FATAL: project_feed query failed — ${feedErr.message}`);
    return 1;
  }
  const priors = indexPriorSnapshots((feedRows ?? []) as PriorFeedRow[]);

  // 3. Per brain: load once, read each ZIP cell, decide per user.
  const toWrite: FeedRowInput[] = [];
  let emits = 0;
  let baselines = 0;
  for (const brain of ZIP_SIGNAL_BRAINS) {
    const t = performance.now();
    const parsed = await loadParsedBrain(brain.report_id);
    if (parsed === null) {
      console.warn(`  brain ${brain.report_id}: load failed (null) — skipping`);
      continue;
    }
    const token = parsed.freshness_token;
    console.log(`  brain ${brain.report_id}: loaded in ${ms(t)} · token=${token}`);

    // Silent-death tripwire: count reconcile verdicts that actually ran (prior
    // present) and how many returned not_found. If EVERY reconcile is not_found,
    // the brain has no TTL basis (not in BRAIN_CATALOG + no stamped expires) and
    // will NEVER emit — exactly the failure the Track-B audit caught. Warn LOUD.
    let reconciled = 0;
    let noBasis = 0;
    for (const zip of uniqueZips) {
      const fact = factFromParsedBrain(brain.report_id, parsed, brain.metric_slug, zip);
      const users = zipUsers.get(zip);
      if (!users) continue;
      for (const userId of users) {
        const prior = priors.get(`${userId}|${zip}|${brain.report_id}`) ?? null;
        const d = decideDataChange({ fact, prior, token, brain, zip, userId });
        if (d.verdict) {
          reconciled++;
          if (d.verdict.status === "not_found") noBasis++;
        }
        if (d.action === "emit" && d.row) {
          emits++;
          toWrite.push(d.row);
          console.log(
            `    EMIT  ${zip} ${brain.report_id} u=${userId.slice(0, 8)} · ${d.row.title}`,
          );
        } else if (d.action === "baseline" && d.row) {
          baselines++;
          toWrite.push(d.row);
        }
      }
    }
    if (reconciled > 0 && noBasis === reconciled) {
      console.warn(
        `  ⚠️  ${brain.report_id}: ALL ${reconciled} reconcile(s) returned not_found — no TTL basis. ` +
          `This signal will NEVER emit. Add "${brain.report_id}" to refinery/packs/catalog.mts (ttl_seconds).`,
      );
    }
  }

  console.log(`  decided: ${emits} move(s) + ${baselines} baseline(s) = ${toWrite.length} row(s)`);

  // 4. Write (or, in dry-run, don't).
  if (DRY_RUN) {
    console.log(`  DRY_RUN — writing nothing. Would write ${toWrite.length} row(s).`);
    return 0;
  }
  const written = await writeFeed(toWrite, { client: db });
  console.log(`  wrote ${written} row(s) (dedup may have absorbed re-runs). Done.`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`FATAL: ${(e as Error).message}`);
    process.exit(1);
  });
