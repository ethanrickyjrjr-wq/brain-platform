import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getPack, PACKS } from "./config/packs.mts";
import type { PackDefinition } from "./types/pack.mts";
import { env } from "./config/env.mts";
import { agentsAreMocked } from "./agents/anthropic.mts";
import { ingest } from "./stages/1-ingest.mts";
import { triageStage } from "./stages/2-triage.mts";
import { normalizeStage } from "./stages/2.5-normalize.mts";
import { synthesisStage } from "./stages/3-synthesis.mts";
import { outputStage, type OutputResult } from "./stages/4-output.mts";
import { resolveBuildOrder, walkConsumers, brainStatus } from "./lib/dag.mts";
import {
  buildOne,
  computeMasterDecision,
  deriveExitCode,
  type BrainBuildOutcome,
  type BuildReport,
} from "./lib/resilient-build.mts";

interface CliArgs {
  packId: string;
  dryRun: boolean;
  force: boolean;
  targetOnly: boolean;
  listConsumers: boolean;
  strict: boolean;
  report: boolean;
  resilient: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  // --target-only: rebuild ONLY the named pack; treat every upstream as "skip"
  // regardless of freshness. Avoids touching sibling brain artifacts during
  // fixture-mode verification steps that only care about one pack.
  const targetOnly = args.includes("--target-only");
  const listConsumers = args.includes("--list-consumers");
  // Stage 2.5 strict-mode is ON by default (orphan slugs abort the run, see
  // refinery/stages/2.5-normalize.mts:347). --no-strict downgrades to a log so
  // a contributor mid-migration on a new brain can finish the round-trip
  // before backfilling refinery/vocab/brain-vocabulary.json. This flag is the
  // escape hatch, not the recommended path.
  const strict = !args.includes("--no-strict");
  const report = args.includes("--report");
  const resilient = args.includes("--resilient");
  const packId = args.find((a) => !a.startsWith("--"));
  if (!packId) {
    throw new Error(
      "Usage: node refinery/cli.mts <pack-id> [--dry-run] [--force] [--target-only] [--list-consumers] [--no-strict] [--report] [--resilient]\n" +
        "  e.g. node refinery/cli.mts master\n" +
        "       node refinery/cli.mts master --force        # rebuild upstreams even if fresh\n" +
        "       node refinery/cli.mts master --target-only  # rebuild only this pack; never touch upstreams\n" +
        "       node refinery/cli.mts master --dry-run      # validate without writing\n" +
        "       node refinery/cli.mts master --no-strict    # log Stage 2.5 orphans instead of aborting\n" +
        "       node refinery/cli.mts master --report       # append a section to docs/HANDOFF.md\n" +
        "       node refinery/cli.mts master --resilient    # outcome-collection walk with HOLD gate\n" +
        "       node refinery/cli.mts franchise-outcomes --list-consumers",
    );
  }
  if (force && targetOnly) {
    throw new Error(
      "[refinery] --force and --target-only are mutually exclusive (one rebuilds upstreams, the other refuses to).",
    );
  }
  return {
    packId,
    dryRun,
    force,
    targetOnly,
    listConsumers,
    strict,
    report,
    resilient,
  };
}

/** Run the full 4-stage pipeline for a single pack. */
async function runPipeline(
  pack: PackDefinition,
  opts: {
    dryRun: boolean;
    strict: boolean;
    degradedUpstreamIds?: ReadonlySet<string>;
    /** Phase 4 — re-darkened critical holes; outputStage's master gate reads this. */
    criticalHoleIds?: ReadonlySet<string>;
    /** Phase 6 (issue #6) — never-built upstreams; outputStage subtracts these from the
     *  gate's degraded-fraction numerator. */
    neverBuiltIds?: ReadonlySet<string>;
  },
): Promise<OutputResult> {
  console.log(
    `[refinery] pack=${pack.id} source=${env.source} agents=${
      agentsAreMocked() ? "MOCK" : "live"
    }${opts.dryRun ? " (dry-run)" : ""}${opts.strict ? "" : " (no-strict)"}`,
  );
  if (agentsAreMocked()) {
    console.warn(
      "[refinery] WARNING: ANTHROPIC_API_KEY not set — agents run in deterministic mock mode. " +
        "Output is shape-valid and spec-valid, but not real intelligence.",
    );
  }
  if (!opts.strict) {
    console.warn(
      "[refinery] WARNING: Stage 2.5 strict-mode OFF — orphan slugs will be logged but will NOT abort the run. " +
        "Use this only during a vocab-bridge migration; default is strict.",
    );
  }

  const { fragments, sourceCounts } = await ingest(pack);
  console.log(
    `[stage 1] ingest: ${fragments.length} fragment(s) — ${JSON.stringify(sourceCounts)}`,
  );

  const { triaged, droppedByFit, droppedByCutoff } = await triageStage(
    fragments,
    pack,
  );
  console.log(
    `[stage 2] triage: ${triaged.length} kept · ${droppedByFit} dropped (pack-fit) · ${droppedByCutoff} dropped (cutoff)`,
  );

  const { normalized, orphans } = await normalizeStage(triaged, pack, {
    strict: opts.strict,
  });
  const tagCount = normalized.reduce((n, f) => n + f.concept_tags.length, 0);
  console.log(
    `[stage 2.5] normalize: ${normalized.length} fragment(s) · ${tagCount} concept tag(s) · ${orphans.length} orphan(s)`,
  );
  if (orphans.length > 0) {
    const sample = orphans.slice(0, 5);
    for (const o of sample) {
      console.log(`  orphan: ${o.fragment_id} :: ${o.path} :: "${o.raw_slug}"`);
    }
    if (orphans.length > sample.length) {
      console.log(`  ... and ${orphans.length - sample.length} more`);
    }
  }

  const { events } = await synthesisStage(normalized, pack, fragments);
  console.log(`[stage 3] synthesis: ${events.length} fact(s)`);

  const result = await outputStage(events, pack, fragments, {
    dryRun: opts.dryRun,
    degradedUpstreamIds: opts.degradedUpstreamIds,
    criticalHoleIds: opts.criticalHoleIds,
    neverBuiltIds: opts.neverBuiltIds,
  });
  if (result.written) {
    console.log(
      `[stage 4] output: wrote ${result.brainPath} (version ${result.version})`,
    );
  } else {
    console.log(
      `[stage 4] output: dry-run — validated OK, not written (would be version ${result.version})`,
    );
  }
  return result;
}

async function main(): Promise<void> {
  const {
    packId,
    dryRun,
    force,
    targetOnly,
    listConsumers,
    strict,
    report,
    resilient,
  } = parseArgs(process.argv);

  // --list-consumers: pure registry query, no build
  if (listConsumers) {
    const consumers = walkConsumers(packId, PACKS);
    if (consumers.length === 0) {
      console.log(`[refinery] no consumers depend on "${packId}".`);
    } else {
      console.log(
        `[refinery] consumers of "${packId}": ${consumers.join(", ")}`,
      );
    }
    return;
  }

  // Validate the target exists up front (catches typos before the DAG walk)
  getPack(packId);

  // Resolve dependency closure — target is last, upstreams in build order
  const order = resolveBuildOrder(packId, PACKS);
  if (order.length > 1) {
    console.log(`[refinery] build order: ${order.join(" → ")}`);
  }

  const entries: Array<{
    packId: string;
    written: boolean;
    brainPath: string;
    brainOutput: OutputResult["brainOutput"];
  }> = [];

  const outcomes: BrainBuildOutcome[] = [];
  const degradedIds = new Set<string>();
  // Phase 4 — critical upstreams that re-darkened (a `missing` outcome that
  // still carries a `lastGoodRefinedAt`, i.e. last-good eligibility expired).
  // No criticality filter here — outputStage's master gate filters to critical
  // via `criticalUpstreamIds.has(id)`. Never-built `missing` outcomes (no
  // lastGoodRefinedAt) are "not-yet-online" and intentionally excluded.
  const criticalHoleIds = new Set<string>();
  // Phase 6 (issue #6) — never-built upstreams (`missing` with NO lastGoodRefinedAt).
  // They stay in `degradedIds` for the harvest soft-skip, but are subtracted from the
  // master gate's degraded-fraction numerator (computeDegradedCriticalIds). Without this,
  // a new critical brain failing its first build would force a spurious HOLD once
  // MASTER_MAX_DEGRADED_FRACTION drops below 1.0 (Phase 7).
  const neverBuiltIds = new Set<string>();
  const startedAt = new Date().toISOString();

  // In resilient mode, master is handled separately after all upstreams so
  // computeMasterDecision can inspect the full outcome set before master runs.
  for (const id of resilient ? order.filter((id) => id !== "master") : order) {
    const pack = getPack(id);
    const isTarget = id === packId;

    if (!resilient) {
      // ── non-resilient path (unchanged) ────────────────────────────────
      if (!isTarget) {
        const status = await brainStatus(id);
        if (targetOnly) {
          // --target-only never touches upstream artifacts. If the upstream
          // brain.md is missing this run will still fail at ingest time when
          // the brain-input source can't load it — that's the honest signal,
          // not a silent fixture-mode regen of an unrelated brain.
          const statusBlurb =
            status.kind === "missing"
              ? "missing"
              : status.kind === "stale"
                ? `stale (expired ${status.expires_at})`
                : `fresh (expires ${status.expires_at})`;
          console.log(
            `[refinery] upstream ${id}: ${statusBlurb} — skip (--target-only)`,
          );
          continue;
        }
        if (status.kind === "missing") {
          if (!force) {
            throw new Error(
              `[refinery] upstream "${id}" is missing (brains/${id}.md not found). ` +
                `Run \`npm run refinery ${id}\` first, or pass --force to build it now.`,
            );
          }
          console.log(
            `[refinery] upstream ${id}: missing — building (--force)`,
          );
        } else if (status.kind === "stale") {
          console.log(
            `[refinery] upstream ${id}: stale (expired ${status.expires_at}) — rebuilding`,
          );
        } else if (force) {
          console.log(
            `[refinery] upstream ${id}: fresh (expires ${status.expires_at}) — rebuilding (--force)`,
          );
        } else {
          console.log(
            `[refinery] upstream ${id}: fresh (expires ${status.expires_at}) — skip`,
          );
          continue;
        }
      }

      const result = await runPipeline(pack, { dryRun, strict });
      entries.push({
        packId: id,
        written: result.written,
        brainPath: result.brainPath,
        brainOutput: result.brainOutput,
      });
      continue;
      // ── end non-resilient path ─────────────────────────────────────────
    }

    // ── resilient path ─────────────────────────────────────────────────
    if (!isTarget) {
      const status = await brainStatus(id);
      if (targetOnly) {
        const statusBlurb =
          status.kind === "missing"
            ? "missing"
            : status.kind === "stale"
              ? `stale (expired ${status.expires_at})`
              : `fresh (expires ${status.expires_at})`;
        console.log(
          `[refinery] upstream ${id}: ${statusBlurb} — skip (--target-only)`,
        );
        // Record actual status so computeMasterDecision sees missing upstreams correctly.
        // target-only skipped upstreams never have a last-good read, so they are
        // "not-yet-online" from the HOLD gate's perspective (no lastGoodRefinedAt).
        outcomes.push({
          packId: id,
          status: status.kind === "missing" ? "missing" : "skipped-fresh",
          written: false,
        });
        continue;
      }
      if (status.kind === "fresh" && !force) {
        console.log(
          `[refinery] upstream ${id}: fresh (expires ${status.expires_at}) — skip`,
        );
        outcomes.push({ packId: id, status: "skipped-fresh", written: false });
        continue;
      }
      if (status.kind === "missing") {
        console.log(
          `[refinery] upstream ${id}: missing — building (resilient)`,
        );
      } else if (status.kind === "stale") {
        console.log(
          `[refinery] upstream ${id}: stale (expired ${status.expires_at}) — rebuilding`,
        );
      } else if (force) {
        console.log(
          `[refinery] upstream ${id}: fresh (expires ${status.expires_at}) — rebuilding (--force)`,
        );
      }
    } else {
      // target pack in resilient mode: if it's not master (handled below),
      // run it through buildOne as well
      const status = await brainStatus(id);
      if (status.kind === "fresh" && !force) {
        outcomes.push({ packId: id, status: "skipped-fresh", written: false });
        continue;
      }
    }

    const outcome = await buildOne(
      pack,
      { dryRun, degradedUpstreamIds: degradedIds },
      (p, o) =>
        runPipeline(p, {
          dryRun: o.dryRun,
          strict,
          degradedUpstreamIds: o.degradedUpstreamIds,
        }),
    );

    if (outcome.status === "degraded" || outcome.status === "missing") {
      degradedIds.add(id);
    }
    if (
      outcome.status === "missing" &&
      outcome.lastGoodRefinedAt !== undefined
    ) {
      // Re-darkened: had a last-good, eligibility expired. The gate's HOLD trigger.
      criticalHoleIds.add(id);
    }
    if (
      outcome.status === "missing" &&
      outcome.lastGoodRefinedAt === undefined
    ) {
      // Never-built ("not-yet-online"): soft-skipped via degradedIds (above), but kept
      // OUT of the gate's degraded-fraction numerator. See computeDegradedCriticalIds.
      neverBuiltIds.add(id);
    }
    outcomes.push(outcome);
    if (outcome.written) {
      entries.push({
        packId: id,
        written: outcome.written,
        brainPath: `brains/${id}.md`,
        brainOutput: outcome.brainOutput,
      });
    }
  }

  if (resilient && order.includes("master")) {
    const masterPack = getPack("master");
    const masterStatus = await brainStatus("master");
    let masterDecision: BuildReport["masterDecision"];

    if (masterStatus.kind === "fresh" && !force) {
      masterDecision = "skipped-fresh";
      outcomes.push({
        packId: "master",
        status: "skipped-fresh",
        written: false,
      });
    } else {
      const decision = computeMasterDecision(masterPack, outcomes);
      if (decision === "held") {
        masterDecision = "held";
        console.warn(
          "[cli] HOLD: one or more critical upstreams have an expired last-good. Master not rebuilt.",
        );
        outcomes.push({
          packId: "master",
          status: "missing",
          reason: "HOLD: critical upstream eligibility expired",
          written: false,
        });
      } else {
        masterDecision = "published";
        const masterOutcome = await buildOne(
          masterPack,
          { dryRun, degradedUpstreamIds: degradedIds },
          (p, o) =>
            runPipeline(p, {
              dryRun: o.dryRun,
              strict,
              degradedUpstreamIds: o.degradedUpstreamIds,
              // Phase 4 — closed over from the outer scope; no opts/type change
              // in resilient-build.mts. The gate inside outputStage reads this.
              criticalHoleIds,
              // Phase 6 (issue #6) — closed over; subtracted from the gate numerator.
              neverBuiltIds,
            }),
        );
        outcomes.push(masterOutcome);
        if (masterOutcome.written) {
          entries.push({
            packId: "master",
            written: masterOutcome.written,
            brainPath: `brains/master.md`,
            brainOutput: masterOutcome.brainOutput,
          });
        }
      }
    }
    // Determine exit code (pure, unit-tested in resilient-build.test.mts):
    //   0 — all built/skipped-fresh
    //   2 — degraded-but-complete, ALL failures transient (self-heals; quiet)
    //   1 — LOUD: master HELD, any deterministic failure, or master silently
    //       unpublished (built but not written). The silent-freeze kill lives
    //       here — a deterministic degrade no longer hides as a quiet exit 2.
    const exitCode = deriveExitCode(outcomes, masterDecision, { dryRun });

    const report: BuildReport = {
      target: packId,
      timestamps: { started: startedAt, finished: new Date().toISOString() },
      source: env.source,
      outcomes,
      exitCode,
      masterDecision,
    };

    const reportPath = path.join(process.cwd(), "brains", "_build-report.json");
    if (!dryRun) {
      await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
      console.log(`[cli] build report → ${reportPath} (exit ${exitCode})`);
    }

    if (exitCode !== 0) process.exit(exitCode);
  }

  if (report) {
    const { writeHandoffReport } = await import("./post/handoff-report.mts");
    const outPath = await writeHandoffReport(packId, entries);
    console.log(`[refinery] handoff report appended to ${outPath}`);
  }
}

main().catch((err: unknown) => {
  console.error(
    `[refinery] FAILED: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
