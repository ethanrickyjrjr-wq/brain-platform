import { getPack } from "./config/packs.mts";
import { env } from "./config/env.mts";
import { agentsAreMocked } from "./agents/anthropic.mts";
import { ingest } from "./stages/1-ingest.mts";
import { triageStage } from "./stages/2-triage.mts";
import { synthesisStage } from "./stages/3-synthesis.mts";
import { outputStage } from "./stages/4-output.mts";

interface CliArgs {
  packId: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const packId = args.find((a) => !a.startsWith("--"));
  if (!packId) {
    throw new Error(
      "Usage: node refinery/cli.mts <pack-id> [--dry-run]\n" +
        "  e.g. node refinery/cli.mts franchise-outcomes --dry-run",
    );
  }
  return { packId, dryRun };
}

async function main(): Promise<void> {
  const { packId, dryRun } = parseArgs(process.argv);
  const pack = getPack(packId);

  console.log(
    `[refinery] pack=${pack.id} source=${env.source} agents=${
      agentsAreMocked() ? "MOCK" : "live"
    }${dryRun ? " (dry-run)" : ""}`,
  );
  if (agentsAreMocked()) {
    console.warn(
      "[refinery] WARNING: ANTHROPIC_API_KEY not set — agents run in deterministic mock mode. " +
        "Output is shape-valid and spec-valid, but not real intelligence.",
    );
  }

  // Stage 1 — Ingest
  const { fragments, sourceCounts } = await ingest(pack);
  console.log(
    `[stage 1] ingest: ${fragments.length} fragment(s) — ${JSON.stringify(sourceCounts)}`,
  );

  // Stage 2 — Triage
  const { triaged, droppedByFit, droppedByCutoff } = await triageStage(
    fragments,
    pack,
  );
  console.log(
    `[stage 2] triage: ${triaged.length} kept · ${droppedByFit} dropped (pack-fit) · ${droppedByCutoff} dropped (cutoff)`,
  );

  // Stage 3 — Synthesis (allFragments feeds the deterministic corpus header fact)
  const { events } = await synthesisStage(triaged, pack, fragments);
  console.log(`[stage 3] synthesis: ${events.length} fact(s)`);

  // Stage 4 — Output
  const result = await outputStage(events, pack, { dryRun });
  if (result.written) {
    console.log(
      `[stage 4] output: wrote ${result.brainPath} (version ${result.version})`,
    );
  } else {
    console.log(
      `[stage 4] output: dry-run — validated OK, not written (would be version ${result.version})`,
    );
    console.log("\n--- rendered Master Index ---\n");
    console.log(result.markdown);
  }
}

main().catch((err: unknown) => {
  console.error(
    `[refinery] FAILED: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
