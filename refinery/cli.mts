import { getPack, PACKS } from "./config/packs.mts";
import type { PackDefinition } from "./types/pack.mts";
import { env } from "./config/env.mts";
import { agentsAreMocked } from "./agents/anthropic.mts";
import { ingest } from "./stages/1-ingest.mts";
import { triageStage } from "./stages/2-triage.mts";
import { synthesisStage } from "./stages/3-synthesis.mts";
import { outputStage } from "./stages/4-output.mts";
import { resolveBuildOrder, walkConsumers, brainStatus } from "./lib/dag.mts";

interface CliArgs {
  packId: string;
  dryRun: boolean;
  force: boolean;
  listConsumers: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const listConsumers = args.includes("--list-consumers");
  const packId = args.find((a) => !a.startsWith("--"));
  if (!packId) {
    throw new Error(
      "Usage: node refinery/cli.mts <pack-id> [--dry-run] [--force] [--list-consumers]\n" +
        "  e.g. node refinery/cli.mts master\n" +
        "       node refinery/cli.mts master --force      # rebuild upstreams even if fresh\n" +
        "       node refinery/cli.mts master --dry-run    # validate without writing\n" +
        "       node refinery/cli.mts franchise-outcomes --list-consumers",
    );
  }
  return { packId, dryRun, force, listConsumers };
}

/** Run the full 4-stage pipeline for a single pack. */
async function runPipeline(
  pack: PackDefinition,
  opts: { dryRun: boolean },
): Promise<void> {
  console.log(
    `[refinery] pack=${pack.id} source=${env.source} agents=${
      agentsAreMocked() ? "MOCK" : "live"
    }${opts.dryRun ? " (dry-run)" : ""}`,
  );
  if (agentsAreMocked()) {
    console.warn(
      "[refinery] WARNING: ANTHROPIC_API_KEY not set — agents run in deterministic mock mode. " +
        "Output is shape-valid and spec-valid, but not real intelligence.",
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

  const { events } = await synthesisStage(triaged, pack, fragments);
  console.log(`[stage 3] synthesis: ${events.length} fact(s)`);

  const result = await outputStage(events, pack, { dryRun: opts.dryRun });
  if (result.written) {
    console.log(
      `[stage 4] output: wrote ${result.brainPath} (version ${result.version})`,
    );
  } else {
    console.log(
      `[stage 4] output: dry-run — validated OK, not written (would be version ${result.version})`,
    );
  }
}

async function main(): Promise<void> {
  const { packId, dryRun, force, listConsumers } = parseArgs(process.argv);

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

  for (const id of order) {
    const pack = getPack(id);
    const isTarget = id === packId;

    if (!isTarget) {
      const status = await brainStatus(id);
      if (status.kind === "missing") {
        if (!force) {
          throw new Error(
            `[refinery] upstream "${id}" is missing (brains/${id}.md not found). ` +
              `Run \`npm run refinery ${id}\` first, or pass --force to build it now.`,
          );
        }
        console.log(`[refinery] upstream ${id}: missing — building (--force)`);
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

    await runPipeline(pack, { dryRun });
  }
}

main().catch((err: unknown) => {
  console.error(
    `[refinery] FAILED: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
