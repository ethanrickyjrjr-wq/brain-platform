// refinery/lib/master-freeze-watchdog.mts
//
// Layer 2 of the silent-master-freeze kill — an INDEPENDENT, ground-truth
// backstop. Layer 1 (deriveExitCode escalating deterministic failures to exit 1)
// is the fast path; this is the paranoid one. It reads ONLY ground truth —
// master.md's own `refined_at` (before vs after) + the run clock — and trusts
// NOTHING the build classified. A bug anywhere in buildOne / classifyFailure /
// deriveExitCode / the exit-code wiring cannot suppress it.
//
// The failure it guards against: the nightly concludes GREEN (exit 0 or 2) yet
// `brains/master.md` did not advance even though master was DUE to rebuild. That
// is a silent freeze — master serves stale data while every signal says "fine".
//
// Design (hardened after the 2026-06-03 adversarial review):
//   - It does NOT look at the build's reported master status. An earlier version
//     excused a `degraded`/`missing` master as "honestly signalled", but exit 2
//     is GREEN with no notify — there is no signal to a human to "double". Worse,
//     it left an escape: a deterministic defect whose error message happens to
//     match isTransientError's substrings is mislabelled transient → exit 2 →
//     degraded master → and the old clause then suppressed the alarm forever.
//     The only honest test is the file itself: due + green + not-advanced = freeze.
//   - exit 1 is already loud (HELD / deterministic / unwritten-master) → excluded.
//   - "due" mirrors brainStatus exactly: stale ⇔ now > refined_at + ttl (strict >).
//   - It fails CLOSED: an unparseable or vanished refined_at can't be verified, so
//     it alarms rather than waving the run through.
//
// Coverage note: this only runs when a rebuild actually ran (gateRan). The
// "master crossed its TTL but the gate never fired" case is closed upstream in
// ingest/scripts/rebuild_due.py, which now forces a rebuild whenever master is
// past its own TTL — so a due master always reaches this check.

export interface FreezeWatchdogInput {
  /** Did the rebuild step actually run this cycle? (GHA gate `run == 'true'`.) */
  gateRan: boolean;
  /** Exit code the resilient CLI returned (or the shell captured). */
  exitCode: 0 | 1 | 2;
  /** master.md `refined_at` captured BEFORE the run (from HEAD). null only if no prior master existed. */
  masterRefinedAtBefore: string | null;
  /** master.md `refined_at` read AFTER the run (working tree). null if the file is gone/unreadable. */
  masterRefinedAtAfter: string | null;
  /** Instant the run started, ms epoch — compared against master's expiry. */
  runStartedAtMs: number;
  /**
   * master's ttl_seconds — its freshness contract, used to decide "was master
   * due to rebuild?". SOURCE OF TRUTH: refinery/packs/master.mts:239
   * (`ttl_seconds: 604800` = 7 days). The wrapper passes the value read from
   * master.md's own frontmatter; 604800 is only a fallback if it's absent.
   */
  ttlSeconds: number;
}

export interface FreezeWatchdogResult {
  frozen: boolean;
  reason: string;
}

/**
 * Pure decision: did master silently freeze this run? No I/O — the thin CLI
 * wrapper (refinery/tools/check-master-freeze.mts) gathers the inputs from git +
 * disk and exits 1 when `frozen` is true.
 */
export function detectSilentMasterFreeze(
  input: FreezeWatchdogInput,
): FreezeWatchdogResult {
  const {
    gateRan,
    exitCode,
    masterRefinedAtBefore,
    masterRefinedAtAfter,
    runStartedAtMs,
    ttlSeconds,
  } = input;

  if (!gateRan) {
    return { frozen: false, reason: "gate did not run — nothing attempted." };
  }
  // exit 1 is already loud (HELD / deterministic failure / unwritten master).
  if (exitCode !== 0 && exitCode !== 2) {
    return {
      frozen: false,
      reason: `exit ${exitCode} already signals loudly — not a silent freeze.`,
    };
  }
  // No prior master on disk → cold start; there is no serving copy to "freeze".
  if (masterRefinedAtBefore === null) {
    return {
      frozen: false,
      reason: "no prior master.md (cold start) — out of watchdog scope.",
    };
  }
  // Fail CLOSED: a non-null but unparseable refined_at is corruption/drift, not a
  // healthy state. We cannot verify freshness, so we assume the worst and alarm.
  const beforeMs = Date.parse(masterRefinedAtBefore);
  if (Number.isNaN(beforeMs)) {
    return {
      frozen: true,
      reason: `master refined_at '${masterRefinedAtBefore}' is unparseable — cannot verify freshness; failing closed (assume frozen).`,
    };
  }
  // "Due" mirrors brainStatus: stale ⇔ now > refined_at + ttl (strict >).
  // Within TTL → legitimately skipped-fresh, not a freeze.
  const expiresMs = beforeMs + ttlSeconds * 1000;
  const wasDue = runStartedAtMs > expiresMs;
  if (!wasDue) {
    return {
      frozen: false,
      reason: "master was within its TTL (legitimately skipped-fresh).",
    };
  }
  // Fail CLOSED on a present-but-unparseable `after`, symmetric with `before`
  // above. Without this, a garbled `after` string (partial write, corruption)
  // that merely DIFFERS from `before` would satisfy the naive advance test below
  // and wave a real freeze through as "published normally" — the watchdog's
  // worst failure: a silent false-negative. We cannot confirm an advance we
  // can't parse, so we alarm.
  if (
    masterRefinedAtAfter !== null &&
    Number.isNaN(Date.parse(masterRefinedAtAfter))
  ) {
    return {
      frozen: true,
      reason: `master refined_at '${masterRefinedAtAfter}' AFTER the run is unparseable — cannot confirm master advanced; failing closed (assume frozen).`,
    };
  }
  // Ground truth: did the file actually move? A null `after` (master.md vanished
  // or unreadable post-run) counts as NOT advanced — fail closed, never wave a
  // missing master through as "advanced". `after` is now known parseable (or null).
  const advanced =
    masterRefinedAtAfter !== null &&
    masterRefinedAtAfter !== masterRefinedAtBefore;
  if (advanced) {
    return {
      frozen: false,
      reason: "master.md advanced — published normally.",
    };
  }

  const stateNote =
    masterRefinedAtAfter === null
      ? "brains/master.md is missing/unreadable after the run"
      : `brains/master.md did NOT advance (still ${masterRefinedAtBefore})`;
  return {
    frozen: true,
    reason:
      `SILENT MASTER FREEZE: the run concluded green (exit ${exitCode}), but ${stateNote} ` +
      `even though master was due to rebuild (older than its ${ttlSeconds}s TTL at run start). ` +
      `Master is serving stale data while every signal says "fine". Investigate the rebuild now.`,
  };
}
