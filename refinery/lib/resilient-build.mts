// refinery/lib/resilient-build.mts
import type { PackDefinition } from "../types/pack.mts";
import type { BrainOutput } from "../types/brain-output.mts";
import type { OutputResult } from "../stages/4-output.mts";
import type { BrainOutputRead } from "./brain-output-reader.mts";
import { readBrainOutput } from "./brain-output-reader.mts";

// ── Eligibility constants (sourced 2026-06-01, verified against real TTLs) ──
// Formula: eligible iff age_days ≤ min(MAX, max(FLOOR, MULT × ttl_days))
export const LAST_GOOD_MIN_WINDOW_DAYS = 2; // floor: every brain gets ≥2 nights
export const LAST_GOOD_ELIGIBILITY_MULT = 1; // one full TTL cycle
export const LAST_GOOD_ABSOLUTE_MAX_DAYS = 14; // ceiling: 30-day env-swfl would otherwise serve 30-day-stale flood data

// ── Types ──────────────────────────────────────────────────────────────────

export interface BrainBuildOutcome {
  packId: string;
  status: "built" | "skipped-fresh" | "degraded" | "missing";
  /**
   * On a FAILURE outcome (`degraded` / `missing`), why the rebuild failed:
   *   - `"transient"`    — network/egress blip (socket/ECONNRESET/timeout/fetch).
   *                        Self-heals next run → quiet exit 2.
   *   - `"deterministic"` — a real defect that will NOT self-heal (orphan-concept,
   *                        spec-validator, type error, harvest throw, …). Must be
   *                        LOUD → `deriveExitCode` escalates it to exit 1.
   * Absent on `built` / `skipped-fresh` (not a failure). This is an ADDITIVE
   * field: the cross-repo ops consumer does an unchecked `as BuildReport` cast
   * and ignores unknown keys, so it lands without a coordinated ops deploy.
   */
  failureClass?: "deterministic" | "transient";
  reason?: string;
  /** ISO 8601 — present on `degraded` outcomes AND on `missing` outcomes where a
   *  prior build existed but its eligibility window has expired. ABSENT on
   *  never-built `missing` outcomes (the "not-yet-online" case). This distinction
   *  drives the HOLD decision: expired last-good → HOLD; never-built → no HOLD. */
  lastGoodRefinedAt?: string;
  version?: number;
  written: boolean;
  brainOutput?: BrainOutput;
  /** Reserved for issue #61 (volume guard / row-floor integration). Empty slot
   *  so that work plugs into this health model without a second type-lift. */
  dataIntegrity?: {
    rowsRead: number;
    rowsExpected?: number;
    sampled?: boolean;
  };
}

export interface BuildReport {
  target: string;
  timestamps: { started: string; finished: string };
  source: string;
  outcomes: BrainBuildOutcome[];
  exitCode: 0 | 1 | 2;
  masterDecision?: "published" | "held" | "skipped-fresh";
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/** Classify a build error as transient (retry eligible) or deterministic. */
export function isTransientError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err).toLowerCase();
  return (
    msg.includes("socket hang up") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("fetch failed")
  );
}

/** Whether a prior brain read is within the eligibility window for use as a
 *  last-good degraded fallback. Uses pack.ttl_seconds as the reference TTL. */
export function isEligibleLastGood(
  pack: PackDefinition,
  refinedAt: string,
): boolean {
  const ttlDays = pack.ttl_seconds / 86400;
  const windowDays = Math.min(
    LAST_GOOD_ABSOLUTE_MAX_DAYS,
    Math.max(LAST_GOOD_MIN_WINDOW_DAYS, LAST_GOOD_ELIGIBILITY_MULT * ttlDays),
  );
  const ageDays = (Date.now() - Date.parse(refinedAt)) / 86400000;
  return ageDays <= windowDays;
}

/** Pure: classify a build failure given the existing last-good read.
 *  `failureClass` (computed by the caller from `isTransientError`) is carried
 *  onto the outcome so `deriveExitCode` can escalate deterministic failures to
 *  a loud exit 1 while transient ones stay a quiet exit 2.
 *  Exported for direct unit testing without file I/O. */
export function classifyFailure(
  pack: PackDefinition,
  err: unknown,
  read: BrainOutputRead,
  failureClass: "deterministic" | "transient",
): BrainBuildOutcome {
  const reason = err instanceof Error ? err.message : String(err);
  if (read.kind === "ok" && isEligibleLastGood(pack, read.output.refined_at)) {
    return {
      packId: pack.id,
      status: "degraded",
      failureClass,
      reason,
      lastGoodRefinedAt: read.output.refined_at,
      version: read.output.version,
      written: false,
    };
  }
  // `missing` with lastGoodRefinedAt → expired eligibility (HOLD trigger).
  // `missing` without it → never built ("not-yet-online", no HOLD).
  const lastGoodRefinedAt =
    read.kind === "ok" ? read.output.refined_at : undefined;
  return {
    packId: pack.id,
    status: "missing",
    failureClass,
    reason,
    lastGoodRefinedAt,
    written: false,
  };
}

/** Determine whether master should publish, be held, or was skipped fresh.
 *  A critical upstream is a HOLD trigger only when it has an expired last-good
 *  (lastGoodRefinedAt set on a `missing` outcome) — a brain that never built
 *  is "not-yet-online" and must NOT block master. */
export function computeMasterDecision(
  masterPack: PackDefinition,
  outcomes: BrainBuildOutcome[],
): "published" | "held" {
  const outcomeById = new Map(outcomes.map((o) => [o.packId, o]));
  for (const edge of masterPack.input_brains ?? []) {
    if (!edge.critical) continue;
    const outcome = outcomeById.get(edge.id);
    if (
      outcome &&
      outcome.status === "missing" &&
      outcome.lastGoodRefinedAt !== undefined
    ) {
      return "held";
    }
  }
  return "published";
}

/**
 * Pure: derive the process exit code from the full outcome set + master decision.
 *
 * Exit semantics:
 *   - 0 — clean: everything built or skipped-fresh.
 *   - 2 — degraded-but-complete: at least one failure, but EVERY failure is
 *         `transient` (a network blip that self-heals next run). Quiet/YELLOW.
 *   - 1 — LOUD (red + notify). ANY of:
 *         · master HELD (a critical upstream re-darkened), OR
 *         · any `deterministic` failure anywhere — a real defect that will not
 *           self-heal (this is the silent-freeze kill: the orphan/spec/type
 *           error that used to hide as a quiet exit 2), OR
 *         · master "published" yet its own outcome is `built` but `written:false`
 *           outside dry-run — i.e. the Stage-4 master gate refused the write
 *           without throwing (the exit-0 silent-freeze path).
 *
 * The transient-vs-deterministic split is the whole point: resilience for blips,
 * an alarm for bugs. A deterministic failure still serves last-good (the answer
 * keeps flowing) — `deriveExitCode` only changes how loudly we report it.
 */
export function deriveExitCode(
  outcomes: BrainBuildOutcome[],
  masterDecision: BuildReport["masterDecision"],
  opts: { dryRun: boolean },
): 0 | 1 | 2 {
  const masterHeld = masterDecision === "held";
  const hasDeterministicFailure = outcomes.some(
    (o) => o.failureClass === "deterministic",
  );
  // Stage-4 master gate HOLD: outcome is `built` (runPipeline returned, no throw)
  // but the gate set written:false. Not a failure status, not degraded/missing —
  // it would otherwise trip nothing and conclude exit 0. dry-run legitimately
  // produces written:false (validate-only), so exclude it.
  const master = outcomes.find((o) => o.packId === "master");
  const masterSilentlyUnpublished =
    !opts.dryRun &&
    master !== undefined &&
    master.status === "built" &&
    master.written === false;
  if (masterHeld || hasDeterministicFailure || masterSilentlyUnpublished) {
    return 1;
  }
  const hasDegradedOrMissing = outcomes.some(
    (o) => o.status === "degraded" || o.status === "missing",
  );
  return hasDegradedOrMissing ? 2 : 0;
}

// ── buildOne ──────────────────────────────────────────────────────────────

type RunPipelineFn = (
  pack: PackDefinition,
  opts: { dryRun: boolean; degradedUpstreamIds?: ReadonlySet<string> },
) => Promise<OutputResult>;

/** Wrap a single pack's runPipeline call with resilience: one retry on
 *  transient errors (5s backoff), then classify as `degraded` or `missing`.
 *  `readBrainOutputFn` and `delaySec` are injectable for unit testing. */
export async function buildOne(
  pack: PackDefinition,
  opts: { dryRun: boolean; degradedUpstreamIds?: ReadonlySet<string> },
  runPipeline: RunPipelineFn,
  readBrainOutputFn: (
    brainId: string,
  ) => Promise<BrainOutputRead> = readBrainOutput,
  delaySec: number = 5,
): Promise<BrainBuildOutcome> {
  let result!: OutputResult;
  try {
    result = await runPipeline(pack, opts);
  } catch (firstErr) {
    if (isTransientError(firstErr)) {
      await new Promise<void>((r) => setTimeout(r, delaySec * 1_000));
      try {
        result = await runPipeline(pack, opts);
      } catch (retryErr) {
        // We chose to retry → this is the transient class regardless of the
        // retry error's wording. A transient degrade stays a quiet exit 2.
        const read = await readBrainOutputFn(pack.brain_id);
        return classifyFailure(pack, retryErr, read, "transient");
      }
    } else {
      // Non-transient = a real defect that will NOT self-heal (orphan-concept,
      // spec-validator, type error, harvest throw). Tag deterministic so the
      // exit code goes LOUD (exit 1) instead of silently degrading to exit 2.
      const read = await readBrainOutputFn(pack.brain_id);
      return classifyFailure(pack, firstErr, read, "deterministic");
    }
  }
  return {
    packId: pack.id,
    status: "built",
    version: result.version,
    written: result.written,
    brainOutput: result.brainOutput,
  };
}
