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
//   - gateRan / exitCode / runStartedAt      → env (set by the workflow)
//
// Usage (local smoke test):
//   WATCHDOG_GATE_RAN=true WATCHDOG_EXIT_CODE=0 \
//   WATCHDOG_MASTER_REFINED_BEFORE=2026-06-03T15:57:48Z \
//   WATCHDOG_RUN_STARTED_AT=2026-06-03T16:00:00Z \
//   bun refinery/tools/check-master-freeze.mts

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  detectSilentMasterFreeze,
  type FreezeWatchdogInput,
} from "../lib/master-freeze-watchdog.mts";

const BRAINS_DIR = path.join(process.cwd(), "brains");

/** Pull a frontmatter scalar from a brain .md (tolerates the leading FRESHNESS comment). */
function frontmatterValue(md: string, key: string): string | null {
  const fm = md
    .replace(/\r\n/g, "\n")
    .match(/^(?:<!--[\s\S]*?-->\s*)?---\n([\s\S]*?)\n---\n/);
  if (!fm) return null;
  for (const line of fm[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    if (line.slice(0, idx).trim() === key) return line.slice(idx + 1).trim();
  }
  return null;
}

async function readMasterAfter(): Promise<{
  refinedAt: string | null;
  ttlSeconds: number;
}> {
  try {
    const md = await readFile(path.join(BRAINS_DIR, "master.md"), "utf-8");
    const refinedAt = frontmatterValue(md, "refined_at");
    const ttlStr = frontmatterValue(md, "ttl_seconds");
    const ttl = ttlStr ? parseInt(ttlStr, 10) : NaN;
    return {
      refinedAt: refinedAt ?? null,
      // Fallback TTL only if master.md omits ttl_seconds. SOURCE OF TRUTH for the
      // 7-day master TTL: refinery/packs/master.mts:239 (`ttl_seconds: 604800`).
      // The on-disk frontmatter value (read above) is authoritative when present.
      ttlSeconds: Number.isFinite(ttl) ? ttl : 604_800,
    };
  } catch {
    // master.md gone/unreadable after the run → refinedAt null → the pure fn
    // treats that as "not advanced" and fails closed. 604800 = master pack TTL
    // (refinery/packs/master.mts:239); unused here since refinedAt is null.
    return { refinedAt: null, ttlSeconds: 604_800 };
  }
}

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

  const { refinedAt: masterRefinedAtAfter, ttlSeconds } =
    await readMasterAfter();

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
