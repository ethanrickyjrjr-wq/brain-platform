/**
 * Constitution — domain-rules contract for the v3 master synthesizer.
 *
 * Spec of record: docs/v3-synthesis-spec.md §3 ("Constitution Shape") and
 * §2 step 3 ("Override cascade"). Locked 2026-05-15.
 *
 * A Constitution encodes the deterministic vetoes, priority cascades, and
 * relevance gates the master synthesizer applies to upstream BrainOutputs.
 * It does NOT compute confidence, render prose, or perform I/O — those live
 * in refinery/lib/confidence.mts and the per-pack outputProducers.
 *
 * Wiring note (Week 2 prep): the master synthesizer does not yet call
 * loadConstitution(). These types + arrays are authored now; the call sites
 * are added in a later commit (see Week 3 build order).
 */

import type { BrainOutput } from "../types/brain-output.mts";
import type { ExogenousSignal } from "../types/exogenous-signal.mts";
import type { BrainDomain } from "../types/pack.mts";

/**
 * Effect an OverrideRule applies when its `condition` fires.
 *  - `force_signal_direction` — direction := the originating ExogenousSignal's
 *    direction (per locked decision "Override cascade bullish signals: force
 *    the SIGNAL'S direction, not always bearish").
 *  - `force_bearish` / `force_bullish` — direction is pinned.
 *  - `add_caveat` — direction untouched; only the override_id-named caveat
 *    is appended. Multiple add_caveat rules can stack.
 */
export type OverrideEffect =
  | "force_signal_direction"
  | "force_bearish"
  | "force_bullish"
  | "add_caveat";

/**
 * A priority-ordered rule evaluated by the override cascade. Spec §2 step 3:
 * the cascade is evaluated high-priority first; the first match in each
 * direction-forcing category wins. Explicit numeric `priority` on every entry
 * (even when array index implies it) so refactors can't silently reorder.
 */
export interface OverrideRule {
  /** Higher number = higher priority. Evaluated descending. */
  priority: number;
  /** Pure predicate over the upstreams and any injected exogenous signals. */
  condition: (upstreams: BrainOutput[], signals: ExogenousSignal[]) => boolean;
  effect: OverrideEffect;
  /**
   * Optional. When present, called instead of the generic template to produce
   * the caveat string pushed to BrainOutput.caveats. Receives the same
   * upstreams and signals as condition().
   */
  caveatText?: (upstreams: BrainOutput[], signals: ExogenousSignal[]) => string;
  /** Stable id appended to BrainOutput.overrides when the rule fires. */
  override_id: string;
}

/**
 * Hard constraint a brain output must satisfy after the cascade runs.
 * TODO: shape locks Week 3+ — placeholder until first concrete constraint
 * is authored. The id is required so violations can be cited by name.
 */
export interface ConstraintRule {
  id: string;
}

/**
 * Tie-break ordering between domains during cross-domain synthesis (e.g.
 * which domain's drivers anchor the conclusion when weights tie).
 * TODO: shape locks Week 3+ — placeholder.
 */
export interface DomainOrderRule {
  id: string;
}

/**
 * Domain-specific caveat templates. Run after override resolution; their
 * outputs are appended to BrainOutput.caveats.
 * TODO: shape locks Week 3+ — placeholder.
 */
export interface CaveatGenerator {
  id: string;
}

/**
 * The merged-and-applied rule set passed into the master synthesizer.
 * Domains that load together (e.g. real-estate + finance) are unioned by
 * loadConstitution(): see refinery/constitution/index.mts.
 */
export interface Constitution {
  /** Domains this constitution speaks for. Union of inputs after merge. */
  domains: BrainDomain[];
  /**
   * Spec §2 step 1: any upstream with relevance_factor below this floor is
   * excluded from voting, contradictions, and metrics rollup. Default 0.10;
   * loadConstitution takes the minimum (most permissive) across merged
   * constitutions.
   */
  relevance_floor: number;
  absoluteConstraints: ConstraintRule[];
  /** Priority-ordered, highest first. loadConstitution re-sorts after merge. */
  overrideCascade: OverrideRule[];
  domainHierarchy: DomainOrderRule[];
  caveatGenerators: CaveatGenerator[];
}
