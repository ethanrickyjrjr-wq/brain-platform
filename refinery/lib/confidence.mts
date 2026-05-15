import type { SourceConnector, TrustTier } from "../types/pack.mts";

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
