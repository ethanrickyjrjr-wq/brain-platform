import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutput,
  BrainOutputProducerResult,
  BrainTrustTier,
} from "../types/brain-output.mts";
import type { ExogenousSignal } from "../types/exogenous-signal.mts";
import type { BrainDomain } from "../types/pack.mts";
import {
  makeBrainInputSource,
  type BrainInputNormalized,
} from "../sources/brain-input-source.mts";
import { loadConstitution } from "../constitution/index.mts";
import {
  applyOverrideCascade,
  applyRelevanceFloor,
  composeConclusion,
  detectContradictions,
  emptySynthesisResult,
  propagateDecay,
  rollupKeyMetrics,
  voteDirection,
} from "../lib/synth.mts";
import { computeConfidence } from "../lib/confidence.mts";

/**
 * master — SWFL Intelligence Lake synthesizer.
 *
 * Reads the v3 OUTPUT blocks of all five live upstream brains
 * (franchise-outcomes, cre-swfl, macro-swfl, sector-credit-swfl, tourism-tdt)
 * via BrainInputSource, then runs spec §2 steps 0-8 in pure code to produce a
 * single synthesized read: direction, magnitude, drivers, overrides,
 * contradictions, key metrics, propagated decay.
 *
 * No LLM in the output path — synthesisStrategy: "deterministic". The
 * synthesis lives entirely in `masterSynthesizerOutputProducer`; corpusSummary
 * lifts a per-upstream snapshot fact so SAVED FACTS surfaces what was
 * synthesized over.
 *
 * Constitution: real-estate + finance (covers all four upstream domains).
 * Relevance floor: 0.10 (constitution default).
 */

// Master loads only the constitutions that have rule files today. tourism-tdt
// (hospitality) flows through vote/cascade/rollup with the default treatment;
// adding `refinery/constitution/hospitality.mts` then bumping this array is a
// clean follow-up that doesn't block the §6.4 acceptance test.
const MASTER_DOMAINS: BrainDomain[] = ["real-estate", "finance"];

// Per-pipeline-run state — populated by corpusSummary, consumed by producer.
// Same pattern as macro-swfl: typed upstream OUTPUTs cannot survive in
// SynthesisFact.value (which is a string), so we keep them in closure.
let lastUpstreams: BrainOutput[] = [];
let lastSignals: ExogenousSignal[] = [];

function masterCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  lastUpstreams = allFragments
    .map((f) => f.normalized as unknown as BrainInputNormalized)
    .filter((n): n is BrainInputNormalized => n?.kind === "brain-input")
    .map((n) => n.output);
  // v1: no exogenous-signal source wired yet — empty until the Context Signal
  // Brain ships (Week 6-8). Producer carries whatever lives here forward.
  lastSignals = [];

  // Emit one upstream-snapshot fact per upstream so SAVED FACTS reflects
  // what master synthesized over.
  return lastUpstreams.map((u) => ({
    topic: `upstream :: ${u.brain_id}`,
    fact: `Upstream snapshot — ${u.brain_id} (${u.direction}, magnitude ${u.magnitude.toFixed(2)}, confidence ${u.confidence.toFixed(2)})`,
    value:
      `${u.brain_id} as of ${u.refined_at.slice(0, 10)}: direction ${u.direction}, ` +
      `magnitude ${u.magnitude.toFixed(2)}, confidence ${u.confidence.toFixed(2)}, ` +
      `trust tier T${u.trust_tier}, ${u.key_metrics.length} key metric(s). ${u.conclusion}`,
    source_fragment_ids: [],
  }));
}

/**
 * Master synthesizer producer — spec §2 steps 0-8 wired together. Pure
 * function over the closure state above. No I/O.
 */
function masterSynthesizerOutputProducer(
  out: PackOutput,
): BrainOutputProducerResult {
  const now = new Date(out.refined_at);
  const constitution = loadConstitution(MASTER_DOMAINS);

  if (lastUpstreams.length === 0) {
    return emptySynthesisResult(0, constitution.relevance_floor, now);
  }

  // Step 1 — relevance floor exclusion.
  const { passing, caveats: floorCaveats } = applyRelevanceFloor(
    lastUpstreams,
    constitution.relevance_floor,
    now,
  );

  if (passing.length === 0) {
    const empty = emptySynthesisResult(
      lastUpstreams.length,
      constitution.relevance_floor,
      now,
    );
    return { ...empty, caveats: [...empty.caveats, ...floorCaveats] };
  }

  // Step 2 — direction voting (with mixed-direction split).
  const vote = voteDirection(passing);
  // Step 3 — override cascade.
  const cascade = applyOverrideCascade(
    vote,
    passing,
    lastSignals,
    constitution.overrideCascade,
  );
  // Step 4 — contradictions among passing upstreams.
  const contradicts = detectContradictions(passing);
  // Step 6 — key-metrics rollup (top 1-2 per upstream, capped at 8).
  const key_metrics = rollupKeyMetrics(passing);
  // Step 7 — trust_tier worst-wins (highest tier number) + weighted-avg decay.
  const trust_tier = Math.max(
    ...passing.map((p) => p.upstream.trust_tier),
  ) as BrainTrustTier;
  const relevance = propagateDecay(passing, now);
  const upstream_count = passing.length;

  // Confidence is deterministic and recomputed by Stage 4 against the same
  // inputs; we compute it here too so composeConclusion's stamped value
  // matches the engine value. computeConfidence is pure — duplicate work,
  // zero risk.
  const confidence = computeConfidence({
    sources: out.pack.sources,
    refined_at: out.refined_at,
    ttl_seconds: out.pack.ttl_seconds,
    upstream_confidences: passing.map((p) => p.upstream.confidence),
  });

  // Step 5 — deterministic conclusion template.
  const conclusion = composeConclusion({
    direction: cascade.direction,
    magnitude: cascade.magnitude,
    drivers: vote.drivers,
    overrides: cascade.overrides,
    contradicts,
    confidence,
    trust_tier,
    upstream_count,
  });

  return {
    conclusion,
    key_metrics,
    caveats: [...floorCaveats, ...cascade.caveats],
    direction: cascade.direction,
    magnitude: cascade.magnitude,
    drivers: vote.drivers,
    overrides: cascade.overrides,
    contradicts,
    exogenous_signals: [],
    upstream_count,
    trust_tier,
    relevance,
  };
}

export const master: PackDefinition = {
  id: "master",
  brain_id: "master",
  // Master synthesizes across real-estate AND finance, but PackDefinition.domain
  // is single-valued for registry filtering. Real-estate is the primary scope.
  domain: "real-estate",
  scope:
    "SWFL Intelligence Lake — master synthesizer over the verified Franchise Outcomes, CRE Corridors, Macro SWFL, and Sector-Credit SWFL upstream brains (Lee & Collier counties, FL).",
  // Refreshes on the slowest upstream's cadence — corridor + franchise data
  // moves weekly; macro/sector-credit move daily but the synthesizer re-runs
  // on demand when any upstream updates.
  ttl_seconds: 604800,
  sources: [
    makeBrainInputSource("franchise-outcomes"),
    makeBrainInputSource("cre-swfl"),
    makeBrainInputSource("macro-swfl"),
    makeBrainInputSource("sector-credit-swfl"),
    makeBrainInputSource("tourism-tdt"),
  ],
  input_brains: [
    "franchise-outcomes",
    "cre-swfl",
    "macro-swfl",
    "sector-credit-swfl",
    "tourism-tdt",
  ],
  // Every upstream fragment belongs by construction; the DAG resolver already
  // gates whether the upstream is fresh enough to even reach this pack.
  fitScore: () => 8,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: masterCorpusSummary,
  outputProducer: masterSynthesizerOutputProducer,
  synthesisStrategy: "deterministic",
  preferences: [
    "The user maintains the SWFL Intelligence Lake — verified business intelligence for Lee and Collier County, Florida.",
    "The user reads the master synthesizer's direction and magnitude as the consolidated cross-vertical read; record-level detail is fetched from the named upstream brain.",
    "The user expects the synthesizer to surface contradictions between upstream brains rather than paper over them.",
  ],
  activeProject:
    "swfl-intelligence-lake: master synthesizer over the four verified upstream brains.",
  prompts: {
    triageContext:
      "These fragments are upstream brain OUTPUT blocks — already-distilled reads from the four live SWFL brains. They are decision-relevant by construction; the master pack is pure deterministic synthesis.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). All synthesis lives in masterSynthesizerOutputProducer, which implements docs/v3-synthesis-spec.md §2 steps 0-8 in pure code.",
  },
};
