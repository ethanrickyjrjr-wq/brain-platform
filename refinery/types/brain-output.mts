/**
 * BrainOutput — the standardized one-page output every brain produces.
 * This is what flows through thin pipes between brains. Downstream consumers
 * read ONLY this object — never the upstream brain's raw branches.
 *
 * Rendered as a JSON block inside the --- OUTPUT --- section of the reference
 * fence. Parsed by BrainInputSource when a downstream brain declares the
 * upstream brain in its input_brains array.
 *
 * V3 contract. Spec: docs/v3-synthesis-spec.md §1. Locked 2026-05-15.
 *
 * Field ownership:
 *  - Engine (Stage 4) owns: brain_id, version, refined_at, confidence,
 *    trust_tier, upstream_count, relevance.
 *  - Producer owns: conclusion, key_metrics, caveats, direction, magnitude,
 *    drivers, overrides, contradicts, exogenous_signals.
 *
 * "Math in code, narrative in producers."
 */

import type { ExogenousSignal } from "./exogenous-signal.mts";
import type { BrainEdgeType } from "./pack.mts";

export type BrainOutputDirection = "bullish" | "bearish" | "neutral" | "mixed";

export type DecayCurve = "hours" | "days" | "weeks" | "months" | "permanent";

export type BrainTrustTier = 1 | 2 | 3 | 4;

/**
 * BrainDriver — a single contributing upstream surfaced in OUTPUT.drivers,
 * carrying its DAG edge semantic inline so a disputant reading the receipt
 * can see whether an upstream `vetoed` the conclusion or merely `input`-ed
 * data into it. The `edge_type` is sourced from the downstream pack's typed
 * `input_brains` declaration; Stage 4 enforces this lift so producers never
 * have to know edge semantics.
 */
export interface BrainDriver {
  /** Upstream brain id that contributed to the winning vote. */
  brain_id: string;
  /** Edge semantic from the DAG (input | constraint | veto | modifier). */
  edge_type: BrainEdgeType;
}

/**
 * Per-metric provenance — the "receipt" that lets a disputant trace a single
 * value back to its source. Optional in v1: env-swfl is the first brain to ship
 * with it populated (P2 forward, Session 8); other packs retrofit as they're
 * touched. When present, the spec-validator enforces shape; when absent, the
 * metric is treated as legacy and only validated for the base fields.
 *
 * `citation` is the human-readable label that would appear in a footnote — it
 * does NOT need to match a CITATION TABLE row id (those are pack-level), but
 * should let a reader reproduce the lookup against the cited source.
 */
export interface BrainOutputMetricSource {
  /** Direct URL the value was fetched from (or as close as the source permits). */
  url: string;
  /** ISO 8601 timestamp of the fetch that produced this specific value. */
  fetched_at: string;
  /** Authority tier of the source — same scale as BrainTrustTier. */
  tier: BrainTrustTier;
  /** Human-readable citation, e.g. "FEMA NFHL Flood Hazard Zones, DFIRM_ID 12021C". */
  citation: string;
}

export interface BrainOutputMetric {
  /** machine-readable slug, e.g. "sofr_30d" */
  metric: string;
  /** numeric value */
  value: number;
  direction: "rising" | "falling" | "stable";
  /** human-readable label, e.g. "30-Day SOFR Rate" */
  label: string;
  /**
   * Optional per-metric provenance — the disputable receipt for THIS value.
   * v1: env-swfl populates this on every metric; other packs leave it absent
   * until they retrofit. When present, shape is validated by spec-validator.
   */
  source?: BrainOutputMetricSource;
}

export interface BrainOutputRelevance {
  decay_curve: DecayCurve;
  /** target half-life of this brain's relevance, in hours */
  half_life_hours: number;
  /** ISO 8601 — when this relevance window was computed (mirrors refined_at) */
  computed_at: string;
}

export interface BrainOutput {
  /** mirrors the brain's frontmatter brain_id */
  brain_id: string;
  /** mirrors the brain's frontmatter version */
  version: number;
  /** ISO 8601 timestamp — mirrors refined_at */
  refined_at: string;

  /** qualitative read of the brain's data */
  direction: BrainOutputDirection;
  /** 0.0-1.0 strength of the read */
  magnitude: number;
  /**
   * Upstream brains whose direction contributed to the winning vote, each
   * tagged with its DAG edge_type. Lifted from the producer's flat string[]
   * by Stage 4 using the downstream pack's typed `input_brains`. See
   * `BrainDriver` for the shape rationale.
   */
  drivers: BrainDriver[];
  /** override_ids that fired during synthesis (e.g. "flood-veto") */
  overrides: string[];

  /**
   * The brain's distilled answer. Plain English, 2-5 sentences.
   * A non-expert should get the picture from this alone.
   */
  conclusion: string;
  /** 3-8 metrics. Empty array is valid for narrative-only outputs. */
  key_metrics: BrainOutputMetric[];
  /** 1-4 honest limitation statements. Empty array if none. */
  caveats: string[];
  /**
   * Pairwise contradictions surfaced during synthesis. Each entry is a
   * human-readable string of the form
   *   "{a.brain_id} ({a.direction}) vs {b.brain_id} ({b.direction})"
   * Empty array if no contradictions detected.
   */
  contradicts: string[];

  /**
   * 0.0-1.0. DETERMINISTIC — computed from source trust tiers, TTL freshness,
   * and upstream-confidence propagation. Never produced by the synthesis agent.
   *
   * Lane 1A switched the formula from the legacy multiplicative cap
   * (`self × avg(upstream_conf)`) to a trust-tier-weighted mean across both
   * direct sources AND upstream brains, multiplied by the TTL freshness ratio.
   * The legacy multiplicative number survives as the `joint_integrity`
   * diagnostic field below — readers who want "what would the cap have been
   * under the old math?" check that field, not this one.
   *
   * Formula: `refinery/lib/confidence.mts::trustTierWeightedConfidence`.
   */
  confidence: number;
  /**
   * 0.0-1.0. DIAGNOSTIC — the legacy multiplicative `Π upstream_confidences`.
   * Preserves the conservative "any weak upstream collapses the chain" cap
   * as a sidecar field so a reader can compare it to the weighted-mean
   * headline. Vacuous product (no upstreams) is 1.0 — the multiplicative
   * identity, matching the legacy no-op multiplier.
   *
   * Formula: `refinery/lib/confidence.mts::jointIntegrity`.
   */
  joint_integrity: number;
  /**
   * 0.0-1.0. DIAGNOSTIC — population standard deviation across upstream
   * confidences. Higher dispersion = noisier consensus. A high headline with
   * high dispersion deserves an "upstream split is wide" caveat in the
   * reader's head before trusting the synthesis. Always 0 for leaf brains
   * (nothing to disperse).
   *
   * Formula: `refinery/lib/confidence.mts::confidenceDispersion`.
   */
  confidence_dispersion: number;
  /**
   * Non-negative integer. Max DAG hops from this brain to a leaf input.
   *   0 = leaf brain (no input_brains).
   *   1 = consumes only leaves.
   *   N = consumes a brain whose chain_depth is N-1.
   *
   * Lets a reader gauge "how many synthesis steps removed from primary data
   * is this conclusion?" without walking the registry themselves.
   *
   * Formula: `refinery/lib/confidence.mts::chainDepth`.
   */
  chain_depth: number;
  /**
   * Trust tier inherited from sources / upstreams. Worst (highest number)
   * wins per spec §2 step 7.
   */
  trust_tier: BrainTrustTier;
  /**
   * Number of upstream brains that PASSED the relevance floor. For primary
   * brains (no upstreams), equals 0. Master synthesis treats 0 as
   * "insufficient data → emit neutral/insufficient" per spec §2 step 8.
   */
  upstream_count: number;

  /** Temporal-decay metadata used by downstream brains' relevance computation. */
  relevance: BrainOutputRelevance;

  /**
   * Reserved exogenous-signal slot. Empty array in v1; populated by the
   * Context Signal Brain starting Week 6-8 (NOAA storm alerts first).
   * Omitted from the JSON only when explicitly absent; producers should
   * emit `[]` rather than omit.
   */
  exogenous_signals?: ExogenousSignal[];
}

/**
 * The narrative + qualitative fields a per-pack outputProducer is responsible
 * for emitting. Engine fields (brain_id, version, refined_at, confidence) are
 * always computed by Stage 4 and overlaid afterwards.
 *
 * `upstream_count`, `trust_tier`, and `relevance` are optionally producer-
 * supplied: master synthesis computes them per spec §2 steps 1 + 7 (passing-
 * floor count, worst-tier-wins, weighted-average decay). Stage 4 prefers the
 * producer value when present and falls back to its own deterministic default
 * (`pack.input_brains.length`, worst direct-source tier, fixed 720h relevance)
 * otherwise. Producers without their own synthesis logic — i.e. every brain
 * that is not the master — leave these undefined.
 */
export type BrainOutputProducerResult = Pick<
  BrainOutput,
  | "conclusion"
  | "key_metrics"
  | "caveats"
  | "direction"
  | "magnitude"
  | "overrides"
  | "contradicts"
  | "exogenous_signals"
> & {
  /**
   * Flat list of contributing upstream brain_ids. Stage 4 lifts these to
   * `BrainDriver[]` using the pack's typed `input_brains` for edge_type
   * lookup, so producers never have to know edge semantics. Producers that
   * name an id NOT present in `pack.input_brains` will fail Stage 4 — the
   * DAG declaration is the source of truth for who's allowed to drive.
   */
  drivers: string[];
} & Partial<Pick<BrainOutput, "upstream_count" | "trust_tier" | "relevance">>;
