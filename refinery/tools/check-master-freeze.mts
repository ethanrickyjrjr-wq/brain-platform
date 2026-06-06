// refinery/tools/check-master-freeze.mts
//
// Layer-2 silent-freeze backstop — the thin I/O wrapper around the pure,
// unit-tested decision in refinery/lib/master-freeze-watchdog.mts. Runs as its
// OWN GitHub Actions step (a separate process from the resilient build), so a
// bug in the build's exit-code classification cannot suppress this check.
//
// Exits 1 (loud — trips the job red + the existing `if: failure()` notify) when
// master silently froze; exits 0 otherwise. Reads ONLY ground truth — NOT the
// build's own classification:
//   - master.md `refined_at` BEFORE the run  → env WATCHDOG_MASTER_REFINED_BEFORE
//                                               (the GHA pre-step captures it via
//                                               `git show HEAD:brains/master.md`)
//   - master.md `refined_at` + `ttl_seconds` AFTER → read from working-tree file
//     (default brains/master.md; override with an explicit path as argv[2])
//   - gateRan / exitCode / runStartedAt      → env (set by the workflow)
//
// A malformed-but-present master (no parseable refined_at) now THROWS via
// readMasterFrontmatter → main().catch → exit 1 with an accurate diagnosis,
// instead of being silently read as null and mislabelled "missing/unreadable".
//
// Usage (local smoke test):
//   WATCHDOG_GATE_RAN=true WATCHDOG_EXIT_CODE=0 \
//   WATCHDOG_MASTER_REFINED_BEFORE=2026-06-03T15:57:48Z \
//   WATCHDOG_RUN_STARTED_AT=2026-06-03T16:00:00Z \
//   bun refinery/tools/check-master-freeze.mts [path/to/master.md]

import path from "node:path";
import {
  detectSilentMasterFreeze,
  type FreezeWatchdogInput,
} from "../lib/master-freeze-watchdog.mts";
import {
  MASTER_TTL_FALLBACK_SECONDS,
  readMasterFrontmatter,
} from "../lib/master-frontmatter.mts";

const BRAINS_DIR = path.join(process.cwd(), "brains");

function parseExitCode(raw: string | undefined): 0 | 1 | 2 | null {
  if (raw === "0") return 0;
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  return null; // empty (runner kill) or unparseable → not evaluable here
}

async function main(): Promise<void> {
  const gateRan = process.env.WATCHDOG_GATE_RAN === "true";
  const exitCode = parseExitCode(process.env.WATCHDOG_EXIT_CODE);
  const beforeRaw = (process.env.WATCHDOG_MASTER_REFINED_BEFORE ?? "").trim();
  const masterRefinedAtBefore = beforeRaw === "" ? null : beforeRaw;
  const runStartedRaw = (process.env.WATCHDOG_RUN_STARTED_AT ?? "").trim();
  const runStartedAtMs = runStartedRaw ? Date.parse(runStartedRaw) : Date.now();

  // exit_code empty == runner kill, already covered by the workflow's runner-kill
  // sentinel. Don't second-guess it here.
  if (exitCode === null) {
    console.log(
      "[freeze-watchdog] no parseable exit code (runner kill?) — deferring to the runner-kill sentinel. OK.",
    );
    return;
  }

  // Default to brains/master.md; accept an explicit path as argv[2] for the
  // local smoke test (point it at a deliberately-malformed temp file). A
  // malformed-but-present file makes readMasterFrontmatter THROW → main().catch
  // → exit 1 with an accurate "unparseable frontmatter" diagnosis (not the old
  // "missing/unreadable"). A genuinely missing file → null → fails closed below.
  const masterPath = process.argv[2] ?? path.join(BRAINS_DIR, "master.md");
  const after = await readMasterFrontmatter(masterPath);
  const masterRefinedAtAfter = after?.refinedAt ?? null;
  const ttlSeconds = after?.ttlSeconds ?? MASTER_TTL_FALLBACK_SECONDS;

  const input: FreezeWatchdogInput = {
    gateRan,
    exitCode,
    masterRefinedAtBefore,
    masterRefinedAtAfter,
    runStartedAtMs,
    ttlSeconds,
  };

  const { frozen, reason } = detectSilentMasterFreeze(input);

  if (frozen) {
    console.error(`[freeze-watchdog] ❌ ${reason}`);
    console.error(`[freeze-watchdog] inputs: ${JSON.stringify(input)}`);
    process.exit(1);
  }

  console.log(`[freeze-watchdog] ✅ no silent freeze — ${reason}`);
}

main().catch((err: unknown) => {
  // A watchdog crash must not silently pass. Fail loud.
  console.error(
    `[freeze-watchdog] FAILED to evaluate: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
