/**
 * Real-Estate Constitution.
 *
 * Spec: docs/v3-synthesis-spec.md §2 step 3 ("Override cascade") and §3.
 * Domain: "real-estate" (per BrainDomain in refinery/types/pack.mts).
 *
 * Override cascade (priority-ordered, highest first):
 *  - 100 → exogenous-critical-confirmed
 *  - 90  → flood-barrier-mode-1 (Group C — per-ZIP barrier+AAL pair-join, add_caveat)
 *  - 80  → naics-distress-veto (stubbed — wires up Week 3+)
 *
 * Defensive-by-design: rules whose data sources do not yet exist in the
 * corpus (NAICS baselines) are authored anyway and simply fire `false` until
 * the upstream brains ship. That is not a stub — it is the correct behavior.
 */

import type { BrainOutput } from "../types/brain-output.mts";
import type { ExogenousSignal } from "../types/exogenous-signal.mts";
import { FLOOD_BARRIER_MODE_1_AAL_THRESHOLD_USD } from "../lib/swfl-geo.mts";
import type { Constitution, OverrideRule } from "./types.mts";

/**
 * priority 100 — any exogenous signal that is critical, confirmed, and
 * high-confidence forces synthesis to track the signal's own direction.
 * Per locked decision: "force the SIGNAL'S direction, not always bearish".
 */
const exogenousCriticalConfirmed: OverrideRule = {
  priority: 100,
  override_id: "exogenous-critical-confirmed",
  effect: "force_signal_direction",
  condition: (_upstreams: BrainOutput[], signals: ExogenousSignal[]): boolean =>
    signals.some(
      (s) =>
        s.severity === "critical" &&
        s.classification === "confirmed" &&
        s.confidence > 0.85,
    ),
};

/**
 * priority 90 — flood-barrier-mode-1.
 *
 * Fires `add_caveat` (NOT force_bearish) when an upstream emits at least one
 * SWFL ZIP whose env-swfl reading meets the Mode 1 predicate:
 *     barrier_island_score === 1.0  AND  flood_aal_usd_per_insured_property >= 800
 *
 * Both conditions MUST hold for the SAME ZIP. The pair-join is necessary
 * because metro-aggregate signals (Lee County area-weighted V/VE coverage)
 * mask the barrier-island concentration where the catastrophic AAL lives —
 * that masking artifact is exactly what Group B's restructure was built to
 * fix. Per-ZIP is policy; metro is data.
 *
 * Effect choice: `add_caveat` rather than `force_bearish`. The deterministic
 * +50-70 bps cap-rate adjustment env-swfl already emits in its key_metrics
 * IS the proportional signal. The constitution surfaces "flood risk
 * material at the per-ZIP barrier-island unit" as a caveat; master's
 * direction synthesis weighs env-swfl's own bearish read alongside other
 * upstreams as a modifier, not a kill-switch.
 *
 * Threshold value FLOOD_BARRIER_MODE_1_AAL_THRESHOLD_USD is imported from swfl-geo so
 * the producer-side Mode 1 boundary and the constitution-side override fire
 * on the identical $800 cliff. Single source of truth. Constitutions cannot
 * import from packs/* — that drags config/env.mts into the first test file's
 * load chain and freezes env.source to "live" before any test sets fixture
 * mode (bisected 2026-05-20). swfl-geo is zero-import-deps by design.
 *
 * §6.4 acceptance scenario: ZIP 33931 (Fort Myers Beach, barrier=1.0,
 * measured AAL ≥ $800) fires the rule with higher fidelity than the prior
 * metro-VE rule ever did.
 */
const AAL_PATTERN = /^swfl_zip_(\d{5})_flood_aal_usd_per_insured_property$/;
const BARRIER_PATTERN = /^swfl_zip_(\d{5})_barrier_island_score$/;

function computeFloodBarrierZips(upstreams: BrainOutput[]): {
  count: number;
  worstAal: number;
} {
  let count = 0;
  let worstAal = 0;
  for (const upstream of upstreams) {
    const zipMap = new Map<string, { aal?: number; barrier?: number }>();
    for (const m of upstream.key_metrics) {
      // Type-narrow at extraction. Non-numeric values never reach the
      // predicate, so the `(e.aal ?? 0)` fallback below only has to handle
      // genuine "metric not emitted" cases, not "metric emitted with junk".
      if (typeof m.value !== "number") continue;
      const aalMatch = AAL_PATTERN.exec(m.metric);
      if (aalMatch) {
        const entry = zipMap.get(aalMatch[1]) ?? {};
        entry.aal = m.value;
        zipMap.set(aalMatch[1], entry);
        continue;
      }
      const barMatch = BARRIER_PATTERN.exec(m.metric);
      if (barMatch) {
        const entry = zipMap.get(barMatch[1]) ?? {};
        entry.barrier = m.value;
        zipMap.set(barMatch[1], entry);
      }
    }
    // Symmetric partial-data shapes both evaluate false:
    //   AAL emitted, barrier missing  → undefined === 1.0 is false
    //   barrier emitted, AAL missing  → (undefined ?? 0) >= 800 is false
    for (const e of zipMap.values()) {
      if (
        e.barrier === 1.0 &&
        (e.aal ?? 0) >= FLOOD_BARRIER_MODE_1_AAL_THRESHOLD_USD
      ) {
        count++;
        if ((e.aal ?? 0) > worstAal) worstAal = e.aal ?? 0;
      }
    }
  }
  return { count, worstAal };
}

const floodBarrierMode1: OverrideRule = {
  priority: 90,
  override_id: "flood-barrier-mode-1",
  effect: "add_caveat",
  condition: (upstreams: BrainOutput[]): boolean => {
    return computeFloodBarrierZips(upstreams).count > 0;
  },
  caveatText: (upstreams: BrainOutput[]): string => {
    const { count, worstAal } = computeFloodBarrierZips(upstreams);
    return `flood-barrier-mode-1 active: ${count} barrier ZIP${count === 1 ? "" : "s"}, worst-case AAL $${worstAal.toLocaleString("en-US", { maximumFractionDigits: 0 })}/insured property`;
  },
};

/**
 * priority 80 — NAICS distress above baseline AND rising forces bearish.
 * Spec language is not yet decidable: sector-credit-swfl does not currently
 * expose a "baseline" metric, only point-in-time distress reads. Stubbed
 * to false until that pack lifts a baseline.
 *
 * TODO(week-3): wire to sector-credit-swfl baseline once that pack exposes
 * a baseline metric (e.g. `naics_distress_baseline` + `naics_distress_pct`).
 */
const naicsDistressVeto: OverrideRule = {
  priority: 80,
  override_id: "naics-distress-veto",
  effect: "force_bearish",
  condition: (): boolean => false,
};

/**
 * priority 70 — storm-history-modifier.
 *
 * Fires `add_caveat` when the storm-history-swfl upstream emits
 * `storm_extreme_wind_events_10yr >= 3` (the same EXTREME_WIND_BEARISH_THRESHOLD
 * the pack itself uses to determine direction). This signals an active storm
 * climate in the trailing 10-year window — corridor z-scores in permits-swfl
 * may understate normal construction activity because storm-driven rebuild
 * activity inflates the denominator.
 *
 * Scope: scoped to the storm-history-swfl upstream by `brain_id` check so
 * the rule does not misfire on env-swfl or other environmental upstreams that
 * happen to emit a metric with a similar slug.
 *
 * No 90-day trailing window exists in storm-history-swfl's output — the pack
 * is an annual NCEI vintage (10yr and 30yr aggregates only). The 10yr
 * extreme-wind count is the closest-fit "active storm climate" signal and
 * matches the pack's own bearish threshold. Per spec decision #14: constitution
 * rule does NOT touch numeric metric math — clean measurement parity.
 *
 * Effect choice: `add_caveat` only. The permits-swfl z-scores are still
 * valid measurements; the caveat surfaces the interpretive context that storm
 * rebuild activity may inflate the activity read. Master's direction synthesis
 * weighs this as a modifier, not a kill-switch.
 */
const STORM_EXTREME_WIND_METRIC = "storm_extreme_wind_events_10yr";
const STORM_EXTREME_WIND_BEARISH_THRESHOLD = 3;

const stormHistoryModifier: OverrideRule = {
  priority: 70,
  override_id: "storm-history-modifier",
  effect: "add_caveat",
  condition: (upstreams: BrainOutput[]): boolean => {
    const stormUpstream = upstreams.find(
      (u) => u.brain_id === "storm-history-swfl",
    );
    if (!stormUpstream) return false;
    const metric = stormUpstream.key_metrics.find(
      (m) => m.metric === STORM_EXTREME_WIND_METRIC,
    );
    if (!metric || typeof metric.value !== "number") return false;
    return metric.value >= STORM_EXTREME_WIND_BEARISH_THRESHOLD;
  },
};

export const realEstateConstitution: Constitution = {
  domains: ["real-estate"],
  relevance_floor: 0.1,
  absoluteConstraints: [],
  overrideCascade: [
    exogenousCriticalConfirmed,
    floodBarrierMode1,
    naicsDistressVeto,
    stormHistoryModifier,
  ],
  domainHierarchy: [],
  caveatGenerators: [],
};
