import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributeError,
  chainDepth,
  computeConfidence,
  confidenceDispersion,
  jointIntegrity,
  tierToScore,
  trustTierWeightedConfidence,
  type UpstreamConfidence,
  type WeightedSource,
} from "./confidence.mts";
import type { PackDefinition, SourceConnector } from "../types/pack.mts";

// ---------------------------------------------------------------------------
// tierToScore — the mapping that seeds source_connectors.trust_tier_score
// ---------------------------------------------------------------------------

test("tierToScore: tier 1 → 1.0, tier 2 → 0.8, tier 3 → 0.6, tier 4 → 0.4", () => {
  assert.equal(tierToScore(1), 1.0);
  assert.equal(tierToScore(2), 0.8);
  assert.equal(tierToScore(3), 0.6);
  assert.equal(tierToScore(4), 0.4);
});

// ---------------------------------------------------------------------------
// attributeError — formula + sort order + edge cases
// ---------------------------------------------------------------------------

test("attributeError: error_contribution = outputConfidence / trust_tier_score", () => {
  const sources: WeightedSource[] = [
    { source_id: "primary", trust_tier_score: 1.0 },
    { source_id: "weak", trust_tier_score: 0.4 },
  ];
  const result = attributeError(0.5, sources);
  // 0.5 / 1.0 = 0.5; 0.5 / 0.4 = 1.25 — weak comes first
  const weak = result[0];
  const primary = result[1];
  assert.equal(weak.source_id, "weak");
  assert.equal(weak.error_contribution, 1.25);
  assert.equal(primary.source_id, "primary");
  assert.equal(primary.error_contribution, 0.5);
});

test("attributeError: sorted by error_contribution descending", () => {
  const sources: WeightedSource[] = [
    { source_id: "a", trust_tier_score: 1.0 }, // 0.6 / 1.0 = 0.6
    { source_id: "b", trust_tier_score: 0.6 }, // 0.6 / 0.6 = 1.0
    { source_id: "c", trust_tier_score: 0.4 }, // 0.6 / 0.4 = 1.5
    { source_id: "d", trust_tier_score: 0.8 }, // 0.6 / 0.8 = 0.75
  ];
  const ids = attributeError(0.6, sources).map((r) => r.source_id);
  assert.deepEqual(ids, ["c", "b", "d", "a"]);
});

test("attributeError: empty sources → empty result", () => {
  assert.deepEqual(attributeError(0.5, []), []);
});

test("attributeError: trust_tier_score = 0 is floored (no Infinity)", () => {
  const sources: WeightedSource[] = [
    { source_id: "broken", trust_tier_score: 0 },
    { source_id: "ok", trust_tier_score: 1 },
  ];
  const result = attributeError(0.5, sources);
  const broken = result.find((r) => r.source_id === "broken")!;
  // Score 0 clamps to 0.01 floor → 0.5 / 0.01 = 50, finite + first
  assert.ok(Number.isFinite(broken.error_contribution));
  assert.equal(broken.error_contribution, 50);
  assert.equal(result[0].source_id, "broken", "broken stays the weakest");
  // The reported trust_tier_score preserves the raw 0 so callers see reality
  assert.equal(broken.trust_tier_score, 0);
});

test("attributeError: preserves raw trust_tier_score in the result", () => {
  const sources: WeightedSource[] = [{ source_id: "a", trust_tier_score: 0.4 }];
  const [entry] = attributeError(0.5, sources);
  assert.equal(entry.trust_tier_score, 0.4);
});

test("attributeError: outputConfidence = 0 → all contributions = 0", () => {
  const sources: WeightedSource[] = [
    { source_id: "a", trust_tier_score: 1.0 },
    { source_id: "b", trust_tier_score: 0.4 },
  ];
  const result = attributeError(0, sources);
  assert.equal(result[0].error_contribution, 0);
  assert.equal(result[1].error_contribution, 0);
});

// ---------------------------------------------------------------------------
// Integration: tier-derived weighted sources match the formula
// ---------------------------------------------------------------------------

test("attributeError: tier-derived scores agree with tierToScore", () => {
  // Stage 4 builds WeightedSource from SourceConnector.trust_tier via
  // tierToScore. Pin the behavior so a future swap of TIER_SCORE values
  // forces a deliberate update here too.
  const sources: WeightedSource[] = [
    { source_id: "fed", trust_tier_score: tierToScore(1) },
    { source_id: "aggregator", trust_tier_score: tierToScore(3) },
  ];
  const result = attributeError(0.45, sources);
  assert.equal(result[0].source_id, "aggregator"); // tier 3 = 0.6 → 0.75
  assert.equal(result[1].source_id, "fed"); // tier 1 = 1.0 → 0.45
});

// ---------------------------------------------------------------------------
// computeConfidence — pin existing behavior so we don't regress it
// ---------------------------------------------------------------------------

function mockSource(id: string, tier: 1 | 2 | 3 | 4): SourceConnector {
  return {
    source_id: id,
    trust_tier: tier,
    fetch: async () => [],
    citationMeta: () => ({
      source: id,
      verified: "2026-05-16",
      expires: "2026-06-16",
    }),
  };
}

test("computeConfidence: tier 2 source, fresh, no upstreams → 0.8", () => {
  const c = computeConfidence({
    sources: [mockSource("s", 2)],
    refined_at: "2026-05-16T00:00:00.000Z",
    ttl_seconds: 86_400,
  });
  assert.equal(c, 0.8);
});

test("computeConfidence: tier 1 source × 0.5 upstream → 0.5", () => {
  const c = computeConfidence({
    sources: [mockSource("s", 1)],
    refined_at: "2026-05-16T00:00:00.000Z",
    ttl_seconds: 86_400,
    upstream_confidences: [0.5],
  });
  assert.equal(c, 0.5);
});

// ---------------------------------------------------------------------------
// trustTierWeightedConfidence — the new HEADLINE math
//
// Each upstream brain contributes (confidence × trust_tier_score). The
// weighted mean replaces the old multiplicative cap: a single weak upstream
// no longer collapses the entire downstream, but every upstream still pulls
// proportionally to its trust tier.
//
// Direct (non-brain-input) sources are blended in too — their "confidence"
// at refine time is the freshness ratio (1.0), and their weight is
// tierToScore(trust_tier). That keeps a leaf brain's headline = its tier
// mix × freshness, which matches the legacy `computeConfidence` result for
// brains with zero upstreams.
// ---------------------------------------------------------------------------

test("trustTierWeightedConfidence: single tier-1 upstream at 1.0 → 1.0", () => {
  const c = trustTierWeightedConfidence({
    sources: [],
    refined_at: "2026-05-16T00:00:00.000Z",
    ttl_seconds: 86_400,
    upstreams: [{ brain_id: "u", confidence: 1.0, trust_tier: 1 }],
  });
  assert.equal(c, 1.0);
});

test("trustTierWeightedConfidence: weighted mean across two upstreams", () => {
  // u1: conf 1.0, tier 1 → weight 1.0
  // u2: conf 0.5, tier 4 → weight 0.4
  // weighted mean = (1.0*1.0 + 0.5*0.4) / (1.0 + 0.4) = 1.2/1.4 ≈ 0.857
  const c = trustTierWeightedConfidence({
    sources: [],
    refined_at: "2026-05-16T00:00:00.000Z",
    ttl_seconds: 86_400,
    upstreams: [
      { brain_id: "u1", confidence: 1.0, trust_tier: 1 },
      { brain_id: "u2", confidence: 0.5, trust_tier: 4 },
    ],
  });
  assert.equal(c, 0.86);
});

test("trustTierWeightedConfidence: a single weak upstream no longer caps", () => {
  // OLD multiplicative behavior: 0.8 (self) × 0.3 (upstream) = 0.24.
  // NEW weighted mean across self-mix + upstream:
  //   self tier-2 source: value = weight = 0.8                  (contribution
  //                                                              from a Tier-2
  //                                                              source at full
  //                                                              freshness)
  //   upstream:           value = 0.3, weight = 1.0             (Tier-1 upstream)
  //   weighted mean = (0.8*0.8 + 0.3*1.0) / (0.8 + 1.0)
  //                 = (0.64 + 0.30) / 1.8 = 0.94/1.8 ≈ 0.522 → rounds to 0.52
  const c = trustTierWeightedConfidence({
    sources: [mockSource("s", 2)],
    refined_at: "2026-05-16T00:00:00.000Z",
    ttl_seconds: 86_400,
    upstreams: [{ brain_id: "u", confidence: 0.3, trust_tier: 1 }],
  });
  assert.equal(c, 0.52);
  // Sanity: above the old 0.24 cap. THAT is the policy delta — a single
  // weak upstream no longer collapses the headline below the weakest input.
  assert.ok(c > 0.24);
});

test("trustTierWeightedConfidence: leaf brain (no upstream) reproduces legacy", () => {
  // Leaf brain — no upstreams. Result must match computeConfidence so that
  // packs without input_brains have an unchanged headline (the policy delta
  // only bites brains that consume upstream confidences).
  const args = {
    sources: [mockSource("s", 2)],
    refined_at: "2026-05-16T00:00:00.000Z",
    ttl_seconds: 86_400,
  };
  const newC = trustTierWeightedConfidence({ ...args, upstreams: [] });
  const oldC = computeConfidence(args);
  assert.equal(newC, oldC);
  assert.equal(newC, 0.8);
});

test("trustTierWeightedConfidence: freshness ratio multiplies the whole headline", () => {
  // Half-life into the TTL window → freshness 0.5 → headline halves.
  const c = trustTierWeightedConfidence({
    sources: [],
    refined_at: "2026-05-16T00:00:00.000Z",
    ttl_seconds: 86_400,
    refresh_at: "2026-05-16T12:00:00.000Z", // 12h into a 24h window → freshness 0.5
    upstreams: [{ brain_id: "u", confidence: 1.0, trust_tier: 1 }],
  });
  assert.equal(c, 0.5);
});

test("trustTierWeightedConfidence: empty sources AND empty upstreams → 0", () => {
  const c = trustTierWeightedConfidence({
    sources: [],
    refined_at: "2026-05-16T00:00:00.000Z",
    ttl_seconds: 86_400,
    upstreams: [],
  });
  assert.equal(c, 0);
});

test("trustTierWeightedConfidence: brain-input sources are skipped (no double count)", () => {
  // brain-input:* sources carry an upstream's already-distilled confidence;
  // counting them as direct sources too would double-weight that upstream.
  const c = trustTierWeightedConfidence({
    sources: [mockSource("brain-input:foo", 3)], // would otherwise add tier-3 weight
    refined_at: "2026-05-16T00:00:00.000Z",
    ttl_seconds: 86_400,
    upstreams: [{ brain_id: "foo", confidence: 0.5, trust_tier: 2 }],
  });
  // Only the upstream contributes — weighted mean of one element is itself.
  assert.equal(c, 0.5);
});

// ---------------------------------------------------------------------------
// jointIntegrity — preserves the OLD multiplicative behavior as a diagnostic
//
// `Π upstream_confidences`. Diagnostic field on BrainOutput. Readers who want
// "what would the cap have been under the old math?" check this.
// ---------------------------------------------------------------------------

test("jointIntegrity: product of upstream confidences", () => {
  assert.equal(jointIntegrity([1.0, 0.8, 0.5]), 0.4);
});

test("jointIntegrity: no upstreams → 1.0 (vacuous product)", () => {
  // Empty product is the multiplicative identity, mirrors the old multiplier.
  assert.equal(jointIntegrity([]), 1.0);
});

test("jointIntegrity: a single 0 collapses the chain", () => {
  // Mathematical honesty — if ANY upstream is zero-confidence, the joint
  // integrity is zero. This is the diagnostic that the headline weighted-mean
  // intentionally smooths over.
  assert.equal(jointIntegrity([1.0, 0.9, 0]), 0);
});

test("jointIntegrity: rounded to 2 dp", () => {
  // 0.7 × 0.6 × 0.5 = 0.21 exactly, but float math can fuzz it.
  assert.equal(jointIntegrity([0.7, 0.6, 0.5]), 0.21);
});

// ---------------------------------------------------------------------------
// confidenceDispersion — population stddev across upstream confidences
//
// Diagnostic for "how much do the upstreams disagree with each other?".
// Higher dispersion = noisier consensus = a reader should look at the
// upstream split before trusting the headline.
// ---------------------------------------------------------------------------

test("confidenceDispersion: all identical → 0", () => {
  assert.equal(confidenceDispersion([0.7, 0.7, 0.7]), 0);
});

test("confidenceDispersion: stddev of [0.2, 0.8] = 0.30 (population)", () => {
  // mean = 0.5; deviations ±0.3; variance = 0.09; stddev = 0.30.
  assert.equal(confidenceDispersion([0.2, 0.8]), 0.3);
});

test("confidenceDispersion: empty → 0 (no dispersion to measure)", () => {
  assert.equal(confidenceDispersion([]), 0);
});

test("confidenceDispersion: single upstream → 0", () => {
  assert.equal(confidenceDispersion([0.5]), 0);
});

test("confidenceDispersion: rounded to 2 dp", () => {
  // [0.4, 0.5, 0.9]: mean 0.6, variance ((0.04+0.01+0.09)/3)≈0.0467,
  // stddev ≈ 0.2160 → rounds to 0.22.
  assert.equal(confidenceDispersion([0.4, 0.5, 0.9]), 0.22);
});

// ---------------------------------------------------------------------------
// chainDepth — max DAG hops to a leaf input
//
// 0 = leaf brain (no input_brains).
// 1 = consumes only leaves.
// N = consumes a brain whose depth is N-1.
// Uses the in-memory PACKS registry to walk input_brains. Cycle-safe via a
// visited set (resolveBuildOrder is the place that THROWS on cycles).
// ---------------------------------------------------------------------------

function mockPack(
  id: string,
  upstream_ids: readonly string[] = [],
): PackDefinition {
  // Only fields chainDepth reads — the cast keeps the test fixture small.
  return {
    id,
    input_brains: upstream_ids.map((u) => ({ id: u, edge_type: "input" })),
  } as unknown as PackDefinition;
}

test("chainDepth: leaf brain → 0", () => {
  const PACKS = { a: mockPack("a") };
  assert.equal(chainDepth("a", PACKS), 0);
});

test("chainDepth: single upstream → 1", () => {
  const PACKS = {
    a: mockPack("a"),
    b: mockPack("b", ["a"]),
  };
  assert.equal(chainDepth("b", PACKS), 1);
});

test("chainDepth: two-tier chain → 2", () => {
  const PACKS = {
    a: mockPack("a"),
    b: mockPack("b", ["a"]),
    c: mockPack("c", ["b"]),
  };
  assert.equal(chainDepth("c", PACKS), 2);
});

test("chainDepth: max across diamond DAG", () => {
  // a, x : leaves (depth 0)
  // y → x          (depth 1)
  // b → a          (depth 1)
  // c → a, y       (depth 1 + max(0, 1) = 2)
  // d → b, c       (depth 1 + max(1, 2) = 3)
  // d's deepest leaf path: d → c → y → x = 3 hops to leaf x.
  const PACKS = {
    a: mockPack("a"),
    x: mockPack("x"),
    y: mockPack("y", ["x"]),
    c: mockPack("c", ["a", "y"]),
    b: mockPack("b", ["a"]),
    d: mockPack("d", ["b", "c"]),
  };
  assert.equal(chainDepth("d", PACKS), 3);
});

test("chainDepth: unknown upstream id is skipped (soft like walkUpstream)", () => {
  // Matches walkUpstream tolerance — a missing pack reference yields 0 for
  // that branch instead of throwing. resolveBuildOrder is the throwing path.
  const PACKS = { a: mockPack("a", ["does-not-exist"]) };
  assert.equal(chainDepth("a", PACKS), 1);
});

// ---------------------------------------------------------------------------
// UpstreamConfidence — type-export smoke test (constructor + shape)
// ---------------------------------------------------------------------------

test("UpstreamConfidence: shape compiles + round-trips", () => {
  const u: UpstreamConfidence = {
    brain_id: "test",
    confidence: 0.5,
    trust_tier: 2,
  };
  assert.equal(u.brain_id, "test");
  assert.equal(u.confidence, 0.5);
  assert.equal(u.trust_tier, 2);
});
