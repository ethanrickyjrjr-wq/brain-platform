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
 *    drivers, overrides, contradicts, exogenous_signals, and (master-only,
 *    optional) conditional_claims, grain_boundary, prediction_window.
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
 * value back to its source. REQUIRED on every metric as of Lane 1B (atomic
 * type-lift, all packs backfilled in the same PR).
 *
 * `citation` is the human-readable label that would appear in a footnote —
 * it does NOT need to match a CITATION TABLE row id. `citation_ref` is the
 * separate optional pointer to a row id (renderer cross-validates when set).
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
  /**
   * Optional opaque pointer to a CITATION TABLE row id (e.g. "s01"). When
   * present, `master-index.mts` cross-validates that the id resolves to an
   * actual citation row at render time and aborts the write if it doesn't.
   * Leave undefined on packs that don't ship a CITATION-row convention yet.
   */
  citation_ref?: string;
}

/**
 * Variable-type taxonomy for a metric. Locked in Lane 1B (cosmic-rolling-brook
 * plan v2). Drives display defaults, gap-math validity, and future formatting.
 *
 *   "extensive"   — counts, totals, sums (employee_count, parcel_count, tons_per_year, claim_count).
 *   "intensive"   — rates, ratios, percentages, z-scores, yoy_change_pct
 *                   (unemployment_rate, yoy_change_pct, sales_velocity_z, gap_pct).
 *   "categorical" — enums, labels, dominant_X strings (dominant_land_use, shock_state).
 *
 * `units` is REQUIRED when variable_type !== "categorical"; spec-validator
 * enforces this. Categorical metrics omit `units`.
 */
export type BrainOutputMetricVariableType =
  | "extensive"
  | "intensive"
  | "categorical";

/**
 * Optional render hint for any downstream consumer (SWFL Data Gulf UI, role
 * renderer, downstream Claude session formatting tables). Costs nothing to
 * populate at the pack and saves every consumer the format-from-value
 * introspection cost. Locked enum — extend only with paired type test.
 */
export type BrainOutputMetricDisplayFormat =
  | "currency"
  | "percent"
  | "count"
  | "ratio"
  | "raw";

export interface BrainOutputMetric {
  /** machine-readable slug, e.g. "sofr_30d" */
  metric: string;
  /**
   * Numeric value for extensive/intensive metrics; string for categorical
   * metrics (label/enum). Spec-validator only enforces categorical may carry a
   * string; extensive/intensive must be number.
   */
  value: number | string;
  direction: "rising" | "falling" | "stable";
  /** human-readable label, e.g. "30-Day SOFR Rate" */
  label: string;
  /**
   * Lane 1B (atomic type-lift). Drives gap-math validity and downstream
   * formatting. See `BrainOutputMetricVariableType` for the locked taxonomy.
   */
  variable_type: BrainOutputMetricVariableType;
  /**
   * Free-form units string. REQUIRED when `variable_type !== "categorical"`.
   * Examples: "tons/year", "USD", "ratio", "z-score", "count", "percent",
   * "parcels", "basis points", "jobs", "vehicles/day". Omit on categorical.
   */
  units?: string;
  /**
   * Optional render hint. Sensible defaults: USD → "currency", percentages →
   * "percent", counts/totals → "count", ratios/z-scores → "ratio", everything
   * else → "raw" or omit.
   */
  display_format?: BrainOutputMetricDisplayFormat;
  /**
   * Per-metric provenance — the disputable receipt for THIS value. REQUIRED
   * on every metric as of Lane 1B; spec-validator enforces shape.
   */
  source: BrainOutputMetricSource;
}

export interface BrainOutputRelevance {
  decay_curve: DecayCurve;
  /** target half-life of this brain's relevance, in hours */
  half_life_hours: number;
  /** ISO 8601 — when this relevance window was computed (mirrors refined_at) */
  computed_at: string;
}

/**
 * ConditionalClaim — master's grounded speculation, authored IF/THEN with a
 * falsifier so it inverts when the consuming Claude changes the premise (no
 * re-fetch). This is the ONLY place the platform speculates (Tier-1 reporters
 * carry no opinion). Master-only: leaf brains never emit these.
 *
 * Deliberately carries NO per-claim confidence/magnitude number: the producer
 * has neither the engine `confidence` nor `confidence_dispersion` at author
 * time (both are computed in Stage 4 AFTER the producer returns), so any
 * per-claim number would be invented and could diverge from the engine's
 * single top-level value. The thesis rides on OUTPUT.confidence + .direction.
 *
 * v1 conditionals are macro/county-grain. The corridor-grain "what's different
 * about THIS corridor vs the median" thesis ships with the deferred corridor
 * work — master does not hold per-corridor counterfactuals at its grain.
 */
export interface ConditionalClaim {
  /** The IF premise, plain English. e.g. "macro stays bearish and tourism keeps declining". */
  condition: string;
  /** Direction the thesis predicts IF the condition holds. */
  then_direction: BrainOutputDirection;
  /** Prose naming the cited read this stands on. */
  basis: string;
  /**
   * Citable hooks: metric slugs and/or upstream brain_ids that MUST resolve
   * against this output's `key_metrics` (slug) or `drivers` (brain_id). Lets a
   * downstream Claude answer "why?" with the source URL from the loaded
   * dossier — no re-fetch. Honors Rule 1 (no number, no claim) for the one
   * surface where speculation rides.
   */
  basis_refs: string[];
  /** One observable that would prove this claim wrong. */
  falsifier: string;
}

/**
 * GrainBoundary — the explicit "what we do NOT have" boundary master hands
 * down so a downstream Claude stops at the data grain instead of inventing
 * drill-downs. Distinct from `caveats` (limitations on what we DO have):
 * grain_boundary names the data that is simply absent. Master-only.
 */
export interface GrainBoundary {
  /** Plain-English statements of what the lake does NOT hold at answer-time. */
  not_available: string[];
  /**
   * Finest grain the payload supports, e.g. "county-month". The consumer must
   * not offer a finer drill-down (a named business, a ZIP, a quarter) than
   * this. Format: "<unit>-<period>".
   */
  finest_grain: string;
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
  /** override_ids that fired during synthesis (e.g. "flood-barrier-mode-1") */
  overrides: string[];

  /**
   * The brain's distilled answer. Plain English, 2-5 sentences.
   * A non-expert should get the picture from this alone.
   */
  conclusion: string;
  /**
   * Master-only grounded speculation, authored IF/THEN with falsifiers. Omitted
   * (undefined) by every leaf brain and by master's empty-synthesis path.
   * Optional so the type-lift touches no other pack's producer.
   */
  conditional_claims?: ConditionalClaim[];
  /** 3-8 metrics. Empty array is valid for narrative-only outputs. */
  key_metrics: BrainOutputMetric[];
  /** 1-4 honest limitation statements. Empty array if none. */
  caveats: string[];
  /**
   * Master-only explicit "what we do NOT have" boundary. Omitted by leaf
   * brains and the empty-synthesis path. Optional (see conditional_claims).
   */
  grain_boundary?: GrainBoundary;
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
   * Master-only analyst-facing revisit horizon — free-form, e.g. "18 months",
   * "Q1 2027", "next FRED release". Mirrors the `predictions.prediction_window
   * TEXT` column so the synthesizer can reuse the same phrasing it logs.
   * Omitted by leaf brains and the empty-synthesis path.
   */
  prediction_window?: string;

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
  | "conditional_claims"
  | "grain_boundary"
  | "prediction_window"
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
