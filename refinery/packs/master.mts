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
  composeConditionalThesis,
  composeGrainBoundary,
  dedupeCaveats,
  detectContradictions,
  emptySynthesisResult,
  predictedWindow,
  propagateDecay,
  rollupKeyMetrics,
  voteDirection,
} from "../lib/synth.mts";
import { computeConfidence } from "../lib/confidence.mts";

/**
 * master — SWFL Intelligence Lake synthesizer.
 *
 * Reads the v3 OUTPUT blocks of the live upstream brains via
 * BrainInputSource, then runs spec §2 steps 0-8 in pure code to produce a
 * single synthesized read: direction, magnitude, drivers, overrides,
 * contradictions, key metrics, propagated decay.
 *
 * Upstream brains (post-2026-05-17 macro restructure):
 *   franchise-outcomes, cre-swfl, sector-credit-swfl, tourism-tdt, env-swfl,
 *   macro-us, macro-florida, macro-swfl. macro-swfl is a delta brain that
 *   emits no metrics today but is kept on the upstream list so the chain
 *   position stays declared; the rising-rates-dominance override fires off
 *   macro-us where SOFR actually lives.
 *
 * No LLM in the output path — synthesisStrategy: "deterministic". The
 * synthesis lives entirely in `masterSynthesizerOutputProducer`; corpusSummary
 * lifts a per-upstream snapshot fact so SAVED FACTS surfaces what was
 * synthesized over.
 *
 * Constitution: real-estate + finance + hospitality + macro (covers every
 * upstream's domain). Relevance floor: 0.10 (constitution default).
 */

// Master loads every domain constitution that contributes an upstream.
// Order matters only as a readability hint — loadConstitution() unions
// domains and re-sorts the override cascade by priority (descending)
// regardless of input order. The effective cascade after merge:
// exogenous-critical-confirmed (100) → flood-barrier-mode-1 (90) →
// naics-distress-veto (80) → rising-rates-dominance (70) →
// hospitality-recovery-collapse (65) → hospitality-yoy-collapse (60).
// macro constitution is empty today — included so future cross-tier macro
// back-stops land in the cascade automatically.
const MASTER_DOMAINS: BrainDomain[] = [
  "real-estate",
  "finance",
  "hospitality",
  "macro",
  "logistics",
];

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

  // Dossier authoring (THE-GOAL Tier-2) — grounded conditional thesis, the
  // explicit "what we do NOT have" boundary, and the revisit horizon. These
  // enrich the deterministic read; they never alter direction/magnitude.
  const conditional_claims = composeConditionalThesis({
    passing,
    vote,
    trust_tier,
    finalKeyMetrics: key_metrics,
  });
  const grain_boundary = composeGrainBoundary({
    passing,
    originalCount: lastUpstreams.length,
    relevanceFloor: constitution.relevance_floor,
  });
  const prediction_window = predictedWindow({ passing, vote });

  // Lift caveats from passing upstreams so master's OUTPUT carries the
  // material qualifications upstream brains attached to their reads (e.g.
  // env-swfl's per-ZIP Mode 1 detail, franchise-outcomes' data-staleness
  // notes). Excluded upstreams' caveats are intentionally dropped — they're
  // below the relevance floor and the floor caveats already speak for them.
  // dedupeCaveats handles overlap when master's override-cascade caveat and
  // an upstream caveat happen to template identically.
  const upstreamCaveats = passing.flatMap((p) => p.upstream.caveats);

  return {
    conclusion,
    key_metrics,
    // Order by user-relevance — the speaker caps the tier-1/2 display at
    // MAX_DISPLAY_CAVEATS, so the most material lines must lead: cascade
    // caveats explain the forced direction call, floor caveats name excluded
    // upstreams, then the lifted upstream qualifications. No truncation here —
    // out.caveats stays the full tier-3 audit receipt + every downstream input.
    caveats: dedupeCaveats([
      ...cascade.caveats,
      ...floorCaveats,
      ...upstreamCaveats,
    ]),
    direction: cascade.direction,
    magnitude: cascade.magnitude,
    drivers: vote.drivers,
    overrides: cascade.overrides,
    contradicts,
    conditional_claims,
    grain_boundary,
    prediction_window,
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
    makeBrainInputSource("macro-us"),
    makeBrainInputSource("macro-florida"),
    makeBrainInputSource("macro-swfl"),
    makeBrainInputSource("sector-credit-swfl"),
    makeBrainInputSource("tourism-tdt"),
    makeBrainInputSource("env-swfl"),
    makeBrainInputSource("logistics-swfl"),
    makeBrainInputSource("logistics-swfl-nowcast"),
    makeBrainInputSource("traffic-swfl"),
    makeBrainInputSource("properties-lee-value"),
    makeBrainInputSource("permits-swfl"),
    makeBrainInputSource("rentals-swfl"),
    makeBrainInputSource("housing-swfl"),
    makeBrainInputSource("safety-swfl"),
    makeBrainInputSource("labor-demand-swfl"),
    makeBrainInputSource("econ-dev-swfl"),
    makeBrainInputSource("city-pulse-swfl"),
  ],
  // Typed edges (P5 + Group C 2026-05-20): every leaf feeds master as `input`
  // data EXCEPT env-swfl, which is wired as a `modifier`. Group B made env-swfl
  // emit per-ZIP barrier+AAL primitives plus a deterministic +50-70 bps cap-rate
  // adjustment in its own key_metrics; Group C surfaces that as a proportional
  // signal master weighs alongside other upstreams rather than as a unilateral
  // metro-level veto. The real-estate constitution's flood-barrier-mode-1 rule
  // (priority 90, effect `add_caveat`) tags master's OUTPUT when any upstream
  // emits a Mode 1 ZIP (barrier_island_score === 1.0 AND aal ≥ $800), but the
  // direction synthesis stays driven by the full upstream vote — env-swfl's own
  // bearish read counts as one weighted voice, not a kill-switch.
  // The macro chain (macro-us → macro-florida → macro-swfl) is enumerated
  // explicitly so the rising-rates-dominance override (registered in the
  // finance constitution but reading off macro-us SOFR after the 2026-05-17
  // restructure) sees the upstream it needs.
  input_brains: [
    { id: "franchise-outcomes", edge_type: "input" },
    { id: "cre-swfl", edge_type: "input" },
    { id: "macro-us", edge_type: "input" },
    { id: "macro-florida", edge_type: "input" },
    { id: "macro-swfl", edge_type: "input" },
    { id: "sector-credit-swfl", edge_type: "input" },
    { id: "tourism-tdt", edge_type: "input" },
    { id: "env-swfl", edge_type: "modifier" },
    { id: "logistics-swfl", edge_type: "input" },
    { id: "logistics-swfl-nowcast", edge_type: "input" },
    { id: "traffic-swfl", edge_type: "input" },
    { id: "properties-lee-value", edge_type: "input" },
    { id: "permits-swfl", edge_type: "input" },
    { id: "rentals-swfl", edge_type: "input" },
    { id: "housing-swfl", edge_type: "input" },
    { id: "safety-swfl", edge_type: "input" },
    { id: "labor-demand-swfl", edge_type: "input" },
    { id: "econ-dev-swfl", edge_type: "input" },
    { id: "city-pulse-swfl", edge_type: "input" },
    { id: "rsw-airport", edge_type: "input" },
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
    "swfl-intelligence-lake: master synthesizer over the verified SWFL upstream brains enumerated in input_brains.",
  prompts: {
    triageContext:
      "These fragments are upstream brain OUTPUT blocks — already-distilled reads from the live SWFL brains listed in input_brains. They are decision-relevant by construction; the master pack is pure deterministic synthesis.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). All synthesis lives in masterSynthesizerOutputProducer, which implements docs/v3-synthesis-spec.md §2 steps 0-8 in pure code.",
  },
};
