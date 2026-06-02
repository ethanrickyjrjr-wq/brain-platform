// refinery/lib/master-gate.mts
//
// Brain Resilience — Phase 4: circuit breaker for the master brain.
//
// `evaluateMasterGate()` is a PURE last-line-of-defense, called inside Stage 4's
// `outputStage` immediately before the live `writeFile` when the pack being
// rendered is `master`. It refuses to overwrite a good `master.md` when a
// critical upstream has gone DARK — i.e. its last-good read existed but its
// eligibility window has expired (a "re-darkened hole"), as opposed to a brain
// that simply never built ("not-yet-online", which is non-blocking).
//
// Defense-in-depth: `computeMasterDecision` (resilient-build.mts, shipped in
// Phase 3) already decides whether to RUN the master pipeline from the cli's
// resilient path. This gate catches the same condition one layer deeper, so a
// `master` render that reaches `outputStage` through any path still cannot
// clobber a serving `master.md` with a degraded one. When `computeMasterDecision`
// returns "published", `criticalHoleIds` is empty in normal operation and Rule 1
// does not fire — the gate is defense, not dead code.
//
// Two knobs default to OFF (confidence floor 0.0, degraded-fraction ceiling 1.0)
// so on day one the breaker is hole-or-hollow only. Tune them later to add the
// confidence-floor and degraded-fraction circuit conditions.

import type { BrainOutput } from "../types/brain-output.mts";

/** Confidence floor below which master is HELD. 0.0 = OFF (no confidence gate). */
export const MASTER_MIN_PUBLISH_CONFIDENCE = 0.0; // off day one — breaker is hole-or-hollow only
/** Max fraction of critical upstreams allowed to be degraded. 1.0 = OFF. */
export const MASTER_MAX_DEGRADED_FRACTION = 1.0; // off day one

export interface MasterGateKnobs {
  minPublishConfidence: number;
  maxDegradedFraction: number;
}

export interface MasterGateInput {
  /** The freshly-rendered master output (only confidence + upstream_count read). */
  rendered: Pick<BrainOutput, "confidence" | "upstream_count">;
  /** Whether a prior `master.md` is on disk and parseable (a serving copy to protect). */
  priorMasterExists: boolean;
  /** Critical upstreams that re-darkened (had a last-good, eligibility expired). */
  criticalHoleIds: ReadonlySet<string>;
  /** All upstream ids declared `critical` on the master pack. */
  criticalUpstreamIds: ReadonlySet<string>;
  /** Degraded (failed rebuild, eligible last-good still in use) AND critical AND not a hole. */
  degradedCriticalIds: ReadonlySet<string>;
  knobs?: Partial<MasterGateKnobs>;
}

export type GateDecision = "PUBLISH" | "HOLD";

/**
 * Decide whether master may overwrite the serving `master.md`. Pure — no I/O.
 * Returns "HOLD" on the first rule that trips, "PUBLISH" if none do.
 */
export function evaluateMasterGate(input: MasterGateInput): GateDecision {
  const knobs: MasterGateKnobs = {
    minPublishConfidence: MASTER_MIN_PUBLISH_CONFIDENCE,
    maxDegradedFraction: MASTER_MAX_DEGRADED_FRACTION,
    ...input.knobs,
  };

  // Rule 1: any re-darkened critical hole → HOLD
  if (input.criticalHoleIds.size > 0) return "HOLD";

  // Rule 2: hollow overwrite guard (upstream_count === 0 AND prior master exists)
  if (input.rendered.upstream_count === 0 && input.priorMasterExists)
    return "HOLD";

  // Rule 3: confidence floor (default 0.0 = off)
  if (input.rendered.confidence < knobs.minPublishConfidence) return "HOLD";

  // Rule 4: degraded fraction ceiling (default 1.0 = off)
  if (input.criticalUpstreamIds.size > 0) {
    const fraction =
      input.degradedCriticalIds.size / input.criticalUpstreamIds.size;
    if (fraction > knobs.maxDegradedFraction) return "HOLD";
  }

  return "PUBLISH";
}
