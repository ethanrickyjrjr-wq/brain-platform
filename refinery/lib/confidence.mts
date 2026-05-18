import type {
  PackDefinition,
  SourceConnector,
  TrustTier,
} from "../types/pack.mts";

/**
 * Deterministic confidence — the only number that ever lands in a
 * BrainOutput's `confidence` field. Computed in code, never by the LLM
 * ("math in Supabase, narrative in Claude").
 *
 *     self_confidence = avg(trust_tier_score) × freshness_ratio
 *     confidence      = self_confidence × avg(upstream_confidences)
 *
 * Where:
 *   trust_tier_score:  tier 1 → 1.0 | tier 2 → 0.8 | tier 3 → 0.6 | tier 4 → 0.4
 *   freshness_ratio:   min(1.0, max(0, days_remaining_in_ttl / ttl_days))
 *   avg(upstream...):  1.0 when there are no upstream_confidences (no-op)
 *
 * Mathematical honesty: a derived brain compounds the uncertainty of its
 * inputs. Reading from a 0.8-confidence upstream caps your possible
 * confidence below 0.8, regardless of how primary your own sources are.
 * Depth in the DAG correctly decays confidence.
 */

const TIER_SCORE: Record<TrustTier, number> = {
  1: 1.0,
  2: 0.8,
  3: 0.6,
  4: 0.4,
};

const MS_PER_DAY = 86_400_000;

function tierScore(tier: TrustTier): number {
  return TIER_SCORE[tier];
}

/**
 * Public converter from TrustTier (1-4) to the numeric weight used in
 * confidence + attribution math. Mirrors the static map above and is the
 * fallback the engine uses until `source_connectors.trust_tier_score`
 * (Supabase) lands — at which point this map becomes the seed default and
 * the live score comes from the SourceConnector itself.
 */
export function tierToScore(tier: TrustTier): number {
  return TIER_SCORE[tier];
}

/**
 * Days between two ISO timestamps. Positive = `to` is after `from`.
 * Fractional. Returns 0 on invalid input — caller treats as fully stale.
 */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return (b - a) / MS_PER_DAY;
}

/**
 * Compute confidence at refine time. `refined_at` is the moment confidence is
 * measured — at that instant freshness_ratio is exactly 1.0, and the value
 * decays toward 0 as the TTL window closes. (Downstream readers that want
 * "confidence AS OF NOW" can re-compute with `now()` in place of refined_at,
 * but the value stamped into BrainOutput.confidence is the at-refine value.)
 */
export function computeConfidence(args: {
  sources: SourceConnector[];
  /** ISO timestamp when the pack was refined (Stage 4's `refined_at`) */
  refined_at: string;
  ttl_seconds: number;
  /** Optional: confidences of upstream brains being consumed via input_brains */
  upstream_confidences?: number[];
}): number {
  const { sources, refined_at, ttl_seconds, upstream_confidences } = args;
  if (sources.length === 0) return 0;

  // Trust-tier average is computed over DIRECT sources only — brain-input
  // sources (source_id "brain-input:*") would double-count, because their
  // contribution to confidence is already represented in upstream_confidences
  // below. They still appear in the citation table (they ARE sources from a
  // provenance perspective); they just don't double-weight the tier average.
  const directSources = sources.filter(
    (s) => !s.source_id.startsWith("brain-input:"),
  );
  const avgTier =
    directSources.length === 0
      ? 1.0 // pure index brain — confidence flows entirely from upstreams
      : directSources.reduce((s, src) => s + tierScore(src.trust_tier), 0) /
        directSources.length;

  // At refine time, the source's verified date is refined_at; freshness_ratio
  // is 1.0. We keep the formula explicit (not a constant) so that callers
  // computing AS-OF-LATER can pass a later instant and watch the ratio decay.
  const ttlDays = ttl_seconds / 86_400;
  const daysRemaining = ttlDays - daysBetween(refined_at, refined_at); // 0 elapsed at refine
  const freshnessRatio = Math.max(
    0,
    Math.min(1, ttlDays === 0 ? 0 : daysRemaining / ttlDays),
  );

  const selfConfidence = avgTier * freshnessRatio;

  // Multiplicative upstream propagation: derived brain confidence = self ×
  // avg(upstream_confidences). No upstreams → multiply by 1.0 (no-op).
  const upstreamMultiplier =
    upstream_confidences && upstream_confidences.length > 0
      ? upstream_confidences.reduce((s, c) => s + c, 0) /
        upstream_confidences.length
      : 1;

  const value = selfConfidence * upstreamMultiplier;

  // round to 2 dp — confidence is published, not used in further arithmetic
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Backprop-inspired attribution
// ---------------------------------------------------------------------------

/** A source with the trust_tier_score the attribution engine needs. */
export interface WeightedSource {
  source_id: string;
  /** 0-1, mirrors `source_connectors.trust_tier_score` in Supabase. */
  trust_tier_score: number;
}

/** One row in the attribution result, ordered by `error_contribution` desc. */
export interface AttributionEntry {
  source_id: string;
  trust_tier_score: number;
  /** outputConfidence / trust_tier_score — higher = more "blame" for the weak read. */
  error_contribution: number;
}

/** Trust-tier-score floor used to keep attribution finite when score collapses to 0. */
const TIER_SCORE_FLOOR = 0.01;

/**
 * Backprop-inspired error attribution.
 *
 * Given a brain's final `outputConfidence` and the weighted sources that fed
 * it, distribute "blame" for the weak read across sources using:
 *
 *     error_contribution = outputConfidence / trust_tier_score
 *
 * Intuition: at a fixed published confidence, the WEAKER a source's trust
 * tier, the more it had to "stretch" to land on that number — i.e. the more
 * responsible it is for the run not being more confident. A tier-1 source
 * (score 1.0) contributes ratio = confidence; a tier-4 source (score 0.4)
 * contributes 2.5× as much; a score-0 source is clamped to TIER_SCORE_FLOOR
 * (0.01) so the ratio stays finite and renderable in a caveat string.
 *
 * Result is sorted error_contribution DESCENDING — `result[0]` is the
 * weakest contributor, the one Stage 4 names in the auto-caveat.
 *
 * Pure function. No I/O. Mirrors the contract the Adaptive Trust Tiers SGD
 * job (Tier 4 #27) will eventually read from `outcomes.attribution`.
 */
export function attributeError(
  outputConfidence: number,
  sources: WeightedSource[],
): AttributionEntry[] {
  return sources
    .map((s) => {
      const score = Math.max(TIER_SCORE_FLOOR, s.trust_tier_score);
      return {
        source_id: s.source_id,
        trust_tier_score: s.trust_tier_score,
        error_contribution: outputConfidence / score,
      };
    })
    .sort((a, b) => b.error_contribution - a.error_contribution);
}

// ---------------------------------------------------------------------------
// Lane 1A — Confidence math hard-cutover
//
// The HEADLINE confidence formula switches from the legacy
//   self_confidence × avg(upstream_confidences)        (multiplicative cap)
// to a trust-tier-weighted mean across both the brain's direct sources AND
// its upstream brain confidences. The legacy multiplicative number survives
// as the `joint_integrity` diagnostic field so a reader can still see the
// "what would the cap have been?" number on demand.
//
// Rationale: a single low-confidence upstream collapsing the entire downstream
// is mathematically pessimistic — under the cap, an 8-upstream synthesis with
// seven 0.9s and one 0.3 reports 0.39, less than the weakest input. Under the
// weighted mean, the 0.3 still drags the headline down proportional to its
// trust tier, but the seven strong reads also contribute. `joint_integrity`
// stays as the conservative diagnostic.
// ---------------------------------------------------------------------------

/** An upstream brain's contribution to the new weighted-mean math. */
export interface UpstreamConfidence {
  brain_id: string;
  /** 0-1 — the upstream's published `BrainOutput.confidence`. */
  confidence: number;
  /** Upstream's published `BrainOutput.trust_tier` — drives the weight. */
  trust_tier: TrustTier;
}

/**
 * Trust-tier-weighted-mean confidence — the new HEADLINE formula.
 *
 *   weight_i = tierToScore(trust_tier_i)
 *   value_i  = confidence_i                          (upstream)
 *            = freshness_ratio                       (direct source — its
 *                                                     "confidence" AT refine
 *                                                     time is 1.0; we fold the
 *                                                     freshness_ratio in via
 *                                                     the outer multiplier
 *                                                     below)
 *   weighted_mean = Σ value_i × weight_i / Σ weight_i
 *   headline      = weighted_mean × freshness_ratio
 *
 * Direct (non-brain-input) sources contribute their tier weight at value=1.0
 * — the freshness ratio caps the headline as the TTL window closes (same
 * pattern as the legacy `computeConfidence`). brain-input:* sources are
 * skipped — their contribution lives in `upstreams` already.
 *
 * Result rounded to 2 dp. Returns 0 when there is nothing to weight (no
 * sources AND no upstreams).
 */
export function trustTierWeightedConfidence(args: {
  sources: SourceConnector[];
  /** ISO timestamp when the pack was refined. Mirrors `computeConfidence`. */
  refined_at: string;
  ttl_seconds: number;
  upstreams: UpstreamConfidence[];
  /**
   * Optional ISO timestamp to measure freshness AS OF. Defaults to
   * `refined_at` (freshness = 1.0). Mirrors the legacy escape hatch.
   */
  refresh_at?: string;
}): number {
  const { sources, refined_at, ttl_seconds, upstreams, refresh_at } = args;

  const directSources = sources.filter(
    (s) => !s.source_id.startsWith("brain-input:"),
  );

  type Contribution = { value: number; weight: number };
  const contribs: Contribution[] = [];

  // Direct sources: a source's at-refine "confidence" is its trust_tier_score
  // (a Tier-1 federal source is 1.0; a Tier-4 inferred one is 0.4). Weight is
  // the same tier score — every contributor's importance scales with its tier.
  // This collapses to the legacy `avgTier × freshness` for a leaf brain
  // (single-source or otherwise), so leaf headlines do not move under the
  // policy switch — only brains with upstreams see the math change.
  for (const src of directSources) {
    const w = tierScore(src.trust_tier);
    contribs.push({ value: w, weight: w });
  }

  // Upstream-brain contributions: published confidence as the value,
  // trust_tier_score as the weight. A high-confidence upstream from a
  // Tier-1 brain pulls hard; a low-confidence Tier-4 upstream barely moves
  // the needle.
  for (const u of upstreams) {
    contribs.push({ value: u.confidence, weight: tierScore(u.trust_tier) });
  }

  if (contribs.length === 0) return 0;

  const totalWeight = contribs.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedMean =
    contribs.reduce((s, c) => s + c.value * c.weight, 0) / totalWeight;

  const ttlDays = ttl_seconds / 86_400;
  const elapsedDays = daysBetween(refined_at, refresh_at ?? refined_at);
  const daysRemaining = ttlDays - elapsedDays;
  const freshnessRatio = Math.max(
    0,
    Math.min(1, ttlDays === 0 ? 0 : daysRemaining / ttlDays),
  );

  const value = weightedMean * freshnessRatio;
  return Math.round(value * 100) / 100;
}

/**
 * Diagnostic: legacy multiplicative cap. `Π upstream_confidences`.
 *
 * Preserved as a `BrainOutput.joint_integrity` field so a reader can answer
 * "what would the multiplicative cap have been?" without recomputing.
 * Vacuous product (no upstreams) is 1.0 — the multiplicative identity, which
 * matches the legacy `upstreamMultiplier` no-op.
 *
 * Rounded to 2 dp (it's published metadata, not used in further arithmetic).
 */
export function jointIntegrity(upstream_confidences: number[]): number {
  if (upstream_confidences.length === 0) return 1.0;
  const product = upstream_confidences.reduce((p, c) => p * c, 1);
  return Math.round(product * 100) / 100;
}

/**
 * Diagnostic: population standard deviation across upstream confidences.
 *
 * Higher dispersion = noisier consensus. A high headline with high dispersion
 * deserves an "upstream split is wide" caveat in the reader's head before
 * trusting the synthesis. Population (not sample) stddev — we are summarizing
 * the actual upstreams in this DAG, not estimating from a sample.
 *
 * Empty or singleton input → 0 (no dispersion to measure). Rounded to 2 dp.
 */
export function confidenceDispersion(upstream_confidences: number[]): number {
  const n = upstream_confidences.length;
  if (n < 2) return 0;
  const mean = upstream_confidences.reduce((s, c) => s + c, 0) / n;
  const variance =
    upstream_confidences.reduce((s, c) => s + (c - mean) ** 2, 0) / n;
  return Math.round(Math.sqrt(variance) * 100) / 100;
}

/**
 * DAG chain depth — max hops from `brainId` to a leaf input.
 *
 *   0 = leaf brain (no input_brains).
 *   1 = consumes only leaves.
 *   N = consumes a brain with depth N-1.
 *
 * Mirrors `walkUpstream` tolerance: a missing pack id is skipped rather than
 * thrown (resolveBuildOrder is the throwing path that catches registry-level
 * misses). Cycle-safe via a visited set — if the registry has a cycle,
 * `resolveBuildOrder` will throw when the CLI tries to actually build; this
 * function stays soft so it works as read-only telemetry.
 */
export function chainDepth(
  brainId: string,
  PACKS: Record<string, PackDefinition>,
): number {
  const visiting = new Set<string>();

  function depth(id: string): number {
    if (visiting.has(id)) return 0; // defensive — cycle short-circuit
    const pack = PACKS[id];
    if (!pack) return 0; // unknown id — match walkUpstream tolerance
    if (pack.input_brains.length === 0) return 0;
    visiting.add(id);
    let max = 0;
    for (const edge of pack.input_brains) {
      const d = depth(edge.id);
      if (d + 1 > max) max = d + 1;
    }
    visiting.delete(id);
    return max;
  }

  return depth(brainId);
}
