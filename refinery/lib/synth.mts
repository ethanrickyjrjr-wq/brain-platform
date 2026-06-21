/**
 * Master synthesizer — pure functions implementing spec §2 (steps 0-8).
 *
 * Spec: docs/v3-synthesis-spec.md §2 (synthesis steps) and §6 (function list).
 *
 * Deterministic, no I/O, no time-of-day side effects (callers pass `now`).
 * Each function below is independently testable; the
 * `masterSynthesizerOutputProducer` composes them in spec order.
 */

import type {
  BrainOutput,
  BrainOutputDirection,
  BrainOutputMetric,
  BrainOutputProducerResult,
  BrainOutputRelevance,
  BrainTrustTier,
  ConditionalClaim,
  DecayCurve,
  GrainBoundary,
} from "../types/brain-output.mts";
import type { ExogenousSignal } from "../types/exogenous-signal.mts";
import type { OverrideRule } from "../constitution/types.mts";
import type { ResolvedGradeConfig } from "../vocab/loader.mts";
import { computeDirection } from "../grade/grade-predictions.mts";

/**
 * Injected grade-config resolver. composeConditionalThesis stays pure (no vocab
 * I/O) by taking this from its caller (the master producer passes the live
 * resolveGradeConfig). Absent ⇒ the gradeable-anchor selection is skipped and the
 * prior key_metrics[0] behavior stands — so nothing regresses when it is omitted.
 */
export type GradeConfigResolver = (slug: string) => ResolvedGradeConfig;

const MS_PER_HOUR = 3_600_000;

/** A passing upstream + its computed relevance factor. */
export interface PassingUpstream {
  upstream: BrainOutput;
  factor: number;
}

/** Step 2 result — direction vote before override cascade fires. */
export interface DirectionVote {
  direction: BrainOutputDirection;
  magnitude: number;
  drivers: string[];
  agreement_ratio: number;
  weights: { bullish: number; bearish: number; neutral: number };
}

/** Step 3 result — direction + magnitude after cascade may have forced them. */
export interface OverrideResult {
  direction: BrainOutputDirection;
  magnitude: number;
  overrides: string[];
  caveats: string[];
}

/**
 * Step 0 — exponential half-life relevance factor.
 *   factor = 0.5 ^ (hours_since_computed_at / half_life_hours)
 * Capped at 1.0, floored at 0.0. Returns 0 on malformed input.
 */
export function computeRelevanceFactor(b: BrainOutput, now: Date): number {
  const computedAt = Date.parse(b.relevance.computed_at);
  if (!Number.isFinite(computedAt)) return 0;
  const halfLife = b.relevance.half_life_hours;
  if (halfLife <= 0) return 0;
  const hoursOld = Math.max(0, (now.getTime() - computedAt) / MS_PER_HOUR);
  const factor = Math.pow(0.5, hoursOld / halfLife);
  return Math.max(0, Math.min(1, factor));
}

/**
 * Step 1 — Relevance-floor exclusion. Returns the passing set, the excluded
 * set, and the per-excluded caveat strings (spec §2 step 1 shape).
 */
export function applyRelevanceFloor(
  upstreams: BrainOutput[],
  floor: number,
  now: Date,
): {
  passing: PassingUpstream[];
  excluded: PassingUpstream[];
  caveats: string[];
} {
  const passing: PassingUpstream[] = [];
  const excluded: PassingUpstream[] = [];
  const caveats: string[] = [];
  for (const u of upstreams) {
    const factor = computeRelevanceFactor(u, now);
    if (factor < floor) {
      excluded.push({ upstream: u, factor });
      caveats.push(
        `${u.brain_id} excluded from synthesis (relevance ${factor.toFixed(3)}, below floor ${floor})`,
      );
    } else {
      passing.push({ upstream: u, factor });
    }
  }
  return { passing, excluded, caveats };
}

/**
 * Step 2 — Direction voting + magnitude with the mixed-direction split.
 *
 * Each upstream's weighted contribution is `magnitude × confidence ×
 * relevance_factor`. Upstreams whose direction is "mixed" split their weight
 * 50/50 across bullish/bearish — honest uncertainty propagation (locked).
 *
 * Winning direction is adopted iff `agreement_ratio ≥ 0.60`; otherwise the
 * outcome is "mixed". When mixed, drivers is the full passing set so the
 * conclusion still names who pulled which way (contradicts surfaces the conflict).
 */
export function voteDirection(passing: PassingUpstream[]): DirectionVote {
  const weights = { bullish: 0, bearish: 0, neutral: 0 };
  for (const { upstream: u, factor } of passing) {
    const w = u.magnitude * u.confidence * factor;
    if (u.direction === "mixed") {
      weights.bullish += 0.5 * w;
      weights.bearish += 0.5 * w;
    } else if (u.direction === "bullish") {
      weights.bullish += w;
    } else if (u.direction === "bearish") {
      weights.bearish += w;
    } else if (u.direction === "neutral") {
      weights.neutral += w;
    }
  }
  // ⚠️ LOCKED HONESTY INVARIANT (spec 2026-06-07-smart-grading-system-design.md §6).
  // Neutral weight STAYS in the agreement-ratio denominator. Do NOT change this to
  // `bullish + bearish` ("neutral abstains") — that manufactures a confident directional
  // call from a near-silent lake (a single magnitude-0.1 whisper would win). It shipped
  // once (da0a79d, 2026-06-09) and was REVERTED after a RULE 3 C1 audit + web pass: the
  // ISM PMI diffusion index — the canonical up/same/down→direction method — INCLUDES the
  // neutral ("same") responses (at 0.5 weight), never drops them. More gradeable calls come
  // from §6-A leaf predictions, not from loosening this vote. Changing this line REQUIRES
  // updating spec §6 ("approach C′") in the same commit.
  const total = weights.bullish + weights.bearish + weights.neutral;
  if (total === 0) {
    return {
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      agreement_ratio: 0,
      weights,
    };
  }
  const sortedKeys = (Object.keys(weights) as Array<keyof typeof weights>).sort(
    (a, b) => weights[b] - weights[a],
  );
  const winningKey = sortedKeys[0];
  const agreement_ratio = weights[winningKey] / total;
  if (agreement_ratio >= 0.6) {
    // Mixed upstreams contributed to both bullish and bearish — count them as
    // drivers of either non-neutral winner, so the conclusion still names them.
    const winners = passing.filter(
      ({ upstream }) =>
        upstream.direction === winningKey ||
        (winningKey !== "neutral" && upstream.direction === "mixed"),
    );
    const avgMag =
      winners.length === 0
        ? 0
        : winners.reduce((s, { upstream }) => s + upstream.magnitude, 0) / winners.length;
    return {
      direction: winningKey,
      magnitude: agreement_ratio * avgMag,
      drivers: winners.map(({ upstream }) => upstream.brain_id),
      agreement_ratio,
      weights,
    };
  }
  return {
    direction: "mixed",
    magnitude: agreement_ratio,
    drivers: passing.map(({ upstream }) => upstream.brain_id),
    agreement_ratio,
    weights,
  };
}

/**
 * Step 3 — Apply the override cascade in priority order (high → low).
 *
 * First direction-forcing match wins; subsequent direction-forcing rules are
 * skipped. `add_caveat` rules stack — every matching add_caveat rule appends
 * its override_id + caveat string.
 *
 * Per spec §2 step 3 an override sets `magnitude = max(current, 0.85)`.
 *
 * For `force_signal_direction`, v1 routes on the FIRST signal matching the
 * canonical critical-confirmed shape (only signal-direction-forcing rule in
 * the spec today). Future rules with different signal predicates will need a
 * per-rule signal picker — easy extension when that arrives.
 */
export function applyOverrideCascade(
  vote: DirectionVote,
  passing: PassingUpstream[],
  signals: ExogenousSignal[],
  cascade: OverrideRule[],
): OverrideResult {
  const sorted = [...cascade].sort((a, b) => b.priority - a.priority);
  const upstreams = passing.map((p) => p.upstream);
  let direction: BrainOutputDirection = vote.direction;
  let magnitude = vote.magnitude;
  const overrides: string[] = [];
  const caveats: string[] = [];
  let directionForced = false;

  for (const rule of sorted) {
    if (!rule.condition(upstreams, signals)) continue;
    if (rule.effect === "add_caveat") {
      overrides.push(rule.override_id);
      caveats.push(
        rule.caveatText
          ? rule.caveatText(upstreams, signals)
          : `Override "${rule.override_id}" fired (priority ${rule.priority})`,
      );
      continue;
    }
    if (directionForced) continue;
    if (rule.effect === "force_bearish") {
      direction = "bearish";
      magnitude = Math.max(magnitude, 0.85);
      overrides.push(rule.override_id);
      caveats.push(`Override "${rule.override_id}" forced bearish (priority ${rule.priority})`);
      directionForced = true;
    } else if (rule.effect === "force_bullish") {
      direction = "bullish";
      magnitude = Math.max(magnitude, 0.85);
      overrides.push(rule.override_id);
      caveats.push(`Override "${rule.override_id}" forced bullish (priority ${rule.priority})`);
      directionForced = true;
    } else if (rule.effect === "force_signal_direction") {
      const sig = signals.find(
        (s) => s.severity === "critical" && s.classification === "confirmed" && s.confidence > 0.85,
      );
      if (sig && sig.direction !== "neutral") {
        direction = sig.direction;
        magnitude = Math.max(magnitude, 0.85);
        overrides.push(rule.override_id);
        caveats.push(
          `Override "${rule.override_id}" forced ${direction} from signal "${sig.entity}" (priority ${rule.priority})`,
        );
        directionForced = true;
      }
    }
  }

  return { direction, magnitude, overrides, caveats };
}

/**
 * Step 4 — Pairwise contradictions among passing upstreams. Restricted to
 * pairs where BOTH are non-neutral, non-mixed AND BOTH have confidence > 0.5.
 * Strings shaped exactly per spec §2 step 4.
 */
export function detectContradictions(passing: PassingUpstream[]): string[] {
  const out: string[] = [];
  const xs = passing.map((p) => p.upstream);
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const a = xs[i];
      const b = xs[j];
      if (a.direction === b.direction) continue;
      if (a.direction === "neutral" || b.direction === "neutral") continue;
      if (a.direction === "mixed" || b.direction === "mixed") continue;
      if (a.confidence <= 0.5 || b.confidence <= 0.5) continue;
      out.push(`${a.brain_id} (${a.direction}) vs ${b.brain_id} (${b.direction})`);
    }
  }
  return out;
}

/** Step 5 — Conclusion template composition. Deterministic, no LLM. */
export function composeConclusion(args: {
  direction: BrainOutputDirection;
  magnitude: number;
  drivers: string[];
  overrides: string[];
  contradicts: string[];
  confidence: number;
  trust_tier: BrainTrustTier;
  upstream_count: number;
}): string {
  const {
    direction,
    magnitude,
    drivers,
    overrides,
    contradicts,
    confidence,
    trust_tier,
    upstream_count,
  } = args;
  const dirClause = {
    bullish: "Read is bullish",
    bearish: "Read is bearish",
    neutral: "Read is neutral",
    mixed: "Read is mixed",
  }[direction];
  const magDesc = magnitude >= 0.75 ? "high" : magnitude >= 0.4 ? "moderate" : "low";
  const parts: string[] = [`${dirClause} (${magDesc} magnitude).`];
  if (drivers.length > 0) parts.push(`Driven by: ${drivers.join(", ")}.`);
  if (overrides.length > 0) parts.push(`Overrides: ${overrides.join(", ")}.`);
  if (contradicts.length > 0) parts.push(`Note conflicts: ${contradicts[0]}.`);
  const plural = upstream_count === 1 ? "" : "s";
  parts.push(
    `Combined confidence ${confidence.toFixed(2)}, trust tier T${trust_tier}, based on ${upstream_count} upstream brain${plural}.`,
  );
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Master dossier authoring (THE-GOAL Tier-2). These ENRICH the deterministic
// core (steps 0-7) without altering it — pure functions, no LLM, no I/O.
// v1 conditionals are macro/county-grain; the corridor-grain thesis ships with
// the deferred corridor work (master holds no per-corridor counterfactuals).
// ---------------------------------------------------------------------------

type ConditionalDomain =
  | "macro"
  | "tourism"
  | "credit"
  | "cre"
  | "env"
  | "properties"
  | "logistics"
  | "traffic"
  | "housing";

/**
 * Coarse domain bucket for an upstream brain_id, used to key the conditional
 * thesis template. Unmapped ids fall through to "macro" (its premise-on-rates
 * template reads sensibly as a generic).
 */
const BRAIN_DOMAIN: Record<string, ConditionalDomain> = {
  "macro-us": "macro",
  "macro-florida": "macro",
  "macro-swfl": "macro",
  "tourism-tdt": "tourism",
  "sector-credit-swfl": "credit",
  "franchise-outcomes": "credit",
  "cre-swfl": "cre",
  "env-swfl": "env",
  "properties-lee-value": "properties",
  "logistics-swfl": "logistics",
  "logistics-swfl-nowcast": "logistics",
  "traffic-swfl": "traffic",
  "housing-swfl": "housing",
  "rentals-swfl": "housing",
  "permits-swfl": "housing",
};

/**
 * (domain × direction) → (condition, falsifier) seed table, keyed
 * "<domain>:<bullish|bearish>". Missing rows fall back to a generic
 * premise-holds conditional. Macro/county-grain by construction.
 */
const THESIS_TABLE: Record<string, { condition: string; falsifier: string }> = {
  "macro:bearish": {
    condition: "rates stay elevated and the macro read stays bearish",
    falsifier:
      "SOFR falls below its current trigger, or Florida unemployment drops for two consecutive prints",
  },
  "macro:bullish": {
    condition: "the rate path eases and the macro read stays bullish",
    falsifier: "the macro direction flips bearish on the next FRED or BLS print",
  },
  "tourism:bullish": {
    condition: "tourist-tax collections keep rising year over year",
    falsifier: "collections decline month over month for two consecutive months",
  },
  "tourism:bearish": {
    condition: "tourist-tax collections keep falling year over year",
    falsifier: "collections rise month over month for two consecutive months",
  },
  "credit:bearish": {
    condition: "small-business charge-offs stay above the sector-distress threshold",
    falsifier: "the flagged sector's charge-off rate falls back under threshold",
  },
  "credit:bullish": {
    condition: "small-business charge-offs stay below the sector-distress threshold",
    falsifier: "a flagged sector's charge-off rate crosses the distress threshold",
  },
  "cre:bullish": {
    condition: "corridor asking rents hold and net absorption stays positive",
    falsifier: "net absorption turns negative or asking rents decline",
  },
  "cre:bearish": {
    condition: "corridor vacancy keeps rising and asking rents soften",
    falsifier: "net absorption turns positive for two consecutive quarters",
  },
  "env:bearish": {
    condition:
      "the flood-barrier signal stays in effect (high-risk flood-zone coverage paired with elevated modeled annual loss)",
    falsifier: "modeled average annual loss drops below the barrier threshold",
  },
  "properties:bullish": {
    condition: "parcel sales velocity stays above its historical pace",
    falsifier: "the sales-velocity z-score goes negative",
  },
  "properties:bearish": {
    condition: "parcel sales velocity stays below its historical pace",
    falsifier: "the sales-velocity z-score turns positive",
  },
};

/** Highest weighted passing upstream in the given pool (mag × conf × factor). */
function dominantOf(pool: PassingUpstream[]): PassingUpstream {
  return [...pool].sort(
    (a, b) =>
      b.upstream.magnitude * b.upstream.confidence * b.factor -
      a.upstream.magnitude * a.upstream.confidence * a.factor,
  )[0];
}

/**
 * Choose the metric slug to cite as a directional claim's gradeable anchor
 * (yield-leak fix, "approach B"). deriveGradeFields grades the FIRST numeric
 * basis_ref and — by design — does NOT skip to a later gradeable one, so a claim
 * is gradeable only if its first cited metric is itself gradeable. We therefore
 * prefer the dominant upstream's first GRADEABLE key_metric (in the payload) over a
 * blind key_metrics[0] that may carry no grade block.
 *
 * HONESTY: for a sign-basis slug whose own value direction CONTRADICTS the claim
 * direction we skip it — never anchor a bullish claim on a bearish-signed driver, a
 * structural mis-grade that would poison the calibration signal the flywheel banks.
 * This changes WHICH already-emitted driver is cited as checkable; it never changes
 * the claim's direction (no manufactured bet). Falls back to the prior
 * key_metrics[0] behavior when nothing gradeable/aligned exists ⇒ no regression for
 * a genuinely non-gradeable read.
 */
function pickAnchorMetric(
  keyMetrics: BrainOutputMetric[],
  allowedMetrics: Set<string>,
  claimDirection: BrainOutputDirection,
  gradeConfigFor?: GradeConfigResolver,
): string | undefined {
  // No resolver injected ⇒ exact prior behavior (the dominant's top metric).
  if (!gradeConfigFor) {
    const top = keyMetrics[0]?.metric;
    return top && allowedMetrics.has(top) ? top : undefined;
  }

  const numeric = keyMetrics.filter(
    (m) => allowedMetrics.has(m.metric) && typeof m.value === "number" && Number.isFinite(m.value),
  );

  // A sign-basis gradeable slug whose OWN value direction opposes the claim would
  // grade the claim backwards — never anchor on it (the calibration poison).
  const contradicts = (m: BrainOutputMetric, cfg: ResolvedGradeConfig): boolean =>
    cfg.gradeable &&
    (claimDirection === "bullish" || claimDirection === "bearish") &&
    cfg.grade_basis === "sign" &&
    (() => {
      const implied = computeDirection(m.value as number, 0, cfg);
      return implied !== "neutral" && implied !== claimDirection;
    })();

  // 1. The checkable anchor: first gradeable, non-contradicting driver (author order).
  for (const m of numeric) {
    const cfg = gradeConfigFor(m.metric);
    if (cfg.gradeable && !contradicts(m, cfg)) return m.metric;
  }
  // 2. Else a NON-gradeable numeric driver — the row is honestly ungradeable, never
  //    mis-graded (this is what keeps a contradicting gradeable slug from sneaking
  //    in as the first numeric ref that deriveGradeFields would then score wrong).
  for (const m of numeric) {
    if (!gradeConfigFor(m.metric).gradeable) return m.metric;
  }
  // 3. Only contradicting gradeable slugs exist — cite brain_id alone ⇒ ungradeable.
  return undefined;
}

/**
 * basis_refs for a dominant driver — intersect-or-drop against the two
 * allowlists so the emitted slugs are guaranteed to resolve in the payload:
 *   • brain_id  must be in allowedBrainIds  (= Set(vote.drivers))
 *   • metric slug must be in allowedMetrics (= Set(finalKeyMetrics[*].metric))
 * A ref that misses either set is silently dropped rather than emitting a dead
 * citation. Empty result is valid — it means the dominant's refs are both
 * absent from the delivered payload (e.g. metric squeezed by the dynamic-cap rollup).
 */
function basisRefsFor(
  p: PassingUpstream,
  allowedBrainIds: Set<string>,
  allowedMetrics: Set<string>,
  claimDirection: BrainOutputDirection,
  gradeConfigFor?: GradeConfigResolver,
): string[] {
  const refs: string[] = [];
  if (allowedBrainIds.has(p.upstream.brain_id)) refs.push(p.upstream.brain_id);
  const anchor = pickAnchorMetric(
    p.upstream.key_metrics,
    allowedMetrics,
    claimDirection,
    gradeConfigFor,
  );
  if (anchor) refs.push(anchor);
  return refs;
}

/**
 * composeConditionalThesis — master's grounded IF/THEN speculation. v1 emits a
 * single lead conditional keyed on (winning vote direction × dominant domain).
 *
 * Signature intentionally excludes confidence/confidence_dispersion: the
 * producer has neither at author time (Stage 4 computes them after). Internal
 * dispersion across the passing upstreams' confidences GATES the phrasing (a
 * wide split widens the premise) but is never re-exposed as a number — the
 * payload carries the engine's single confidence_dispersion.
 *
 * `finalKeyMetrics` is the rolled-up key_metrics master will emit (already
 * computed before this call in the producer). It is used only to build the
 * allowedMetrics set for basis_refs intersection — it never alters
 * direction/magnitude/conclusion.
 */
export function composeConditionalThesis(args: {
  passing: PassingUpstream[];
  vote: DirectionVote;
  trust_tier: BrainTrustTier;
  finalKeyMetrics: BrainOutputMetric[];
  /** Live grade-config resolver; when present, directional/neutral claims anchor on
   *  a GRADEABLE driver slug so the deterministic grader can score them (yield fix). */
  gradeConfigFor?: GradeConfigResolver;
}): ConditionalClaim[] {
  const { passing, vote, finalKeyMetrics, gradeConfigFor } = args;
  if (passing.length === 0) return [];

  // Allowlists for basis_refs intersection.
  const allowedBrainIds = new Set(vote.drivers);
  const allowedMetrics = new Set(finalKeyMetrics.map((m) => m.metric));

  // Internal dispersion gate — population std-dev of passing confidences.
  const confs = passing.map((p) => p.upstream.confidence);
  const mean = confs.reduce((s, c) => s + c, 0) / confs.length;
  const dispersion = Math.sqrt(confs.reduce((s, c) => s + (c - mean) ** 2, 0) / confs.length);
  const wideSplit = dispersion >= 0.15;

  // Mixed read → one split conditional naming the contested pair.
  // For mixed, vote.drivers = all passing brain_ids, so the filter is a no-op
  // in practice — but explicit for correctness.
  if (vote.direction === "mixed") {
    const sorted = [...passing].sort(
      (a, b) =>
        b.upstream.magnitude * b.upstream.confidence * b.factor -
        a.upstream.magnitude * a.upstream.confidence * a.factor,
    );
    const bull = sorted.find((p) => p.upstream.direction === "bullish");
    const bear = sorted.find((p) => p.upstream.direction === "bearish");
    const refs = [bull?.upstream.brain_id, bear?.upstream.brain_id].filter(
      (x): x is string => typeof x === "string" && allowedBrainIds.has(x),
    );
    return [
      {
        condition:
          "the upstream split resolves — the strongest bullish and bearish reads do not currently agree",
        then_direction: "mixed",
        basis:
          "upstream brains are pulling in opposite directions; no single direction clears the agreement threshold",
        basis_refs:
          refs.length > 0
            ? refs
            : passing
                .map((p) => p.upstream.brain_id)
                .filter((id) => allowedBrainIds.has(id))
                .slice(0, 2),
        falsifier: "one side's weight clears 60% of the total on the next refine, breaking the tie",
      },
    ];
  }

  // Neutral read → a holding-pattern conditional.
  // Dominant is chosen from the neutral-direction upstreams (the same set that
  // won the vote and therefore appear in vote.drivers) — not from all passing.
  // This guarantees the brain_id ref resolves against OUTPUT.drivers.
  if (vote.direction === "neutral") {
    const neutralPassing = passing.filter((p) => p.upstream.direction === "neutral");
    const dominant = dominantOf(neutralPassing.length > 0 ? neutralPassing : passing);
    return [
      {
        condition:
          "the current cross-sector signals hold without a decisive move in either direction",
        then_direction: "neutral",
        basis: `no upstream read dominates; the strongest is ${dominant.upstream.brain_id}`,
        basis_refs: basisRefsFor(
          dominant,
          allowedBrainIds,
          allowedMetrics,
          "neutral",
          gradeConfigFor,
        ),
        falsifier: "any major upstream posts a decisive directional move on its next refine",
      },
    ];
  }

  // Directional read (bullish | bearish) → table lookup on dominant domain.
  const direction = vote.direction;
  const aligned = passing.filter(
    (p) => p.upstream.direction === direction || p.upstream.direction === "mixed",
  );
  const dominant = dominantOf(aligned.length > 0 ? aligned : passing);
  const domain = BRAIN_DOMAIN[dominant.upstream.brain_id] ?? "macro";
  const row = THESIS_TABLE[`${domain}:${direction}`] ?? {
    condition: `the ${domain} signal holds its current direction`,
    falsifier: `the ${domain} read reverses on its next update`,
  };
  const condition = wideSplit
    ? `the upstream split narrows toward ${direction} and ${row.condition}`
    : row.condition;

  return [
    {
      condition,
      then_direction: direction,
      basis: `driven by the ${direction} read from ${dominant.upstream.brain_id}`,
      basis_refs: basisRefsFor(
        dominant,
        allowedBrainIds,
        allowedMetrics,
        direction,
        gradeConfigFor,
      ),
      falsifier: row.falsifier,
    },
  ];
}

/**
 * composeGrainBoundary — the explicit "what we do NOT have" boundary. master's
 * synthesized read holds at a county-month grain (Lee/Collier, monthly); finer
 * drill-downs are named as unavailable so a downstream Claude stops at the
 * grain instead of inventing them. finest_grain is authored, not derived (no
 * upstream declares grain in BrainOutput).
 */
export function composeGrainBoundary(args: {
  passing: PassingUpstream[];
  originalCount: number;
  relevanceFloor: number;
}): GrainBoundary {
  const { passing, originalCount } = args;
  const present = new Set(passing.map((p) => BRAIN_DOMAIN[p.upstream.brain_id] ?? "macro"));

  const not_available: string[] = [
    "Outcomes for a specific named business or street address — the lake holds sector- and corridor-level aggregates, not individual firms.",
    "Geography finer than what an upstream explicitly publishes (most reads are Lee/Collier county level).",
    "Sub-monthly timing on most series — the synthesized read moves at a monthly grain.",
  ];
  if (!present.has("cre")) {
    not_available.push(
      "Corridor-level commercial real-estate detail is not weighted in this read right now.",
    );
  }
  if (!present.has("housing")) {
    not_available.push(
      "ZIP-level housing and rental detail is not weighted in this read right now.",
    );
  }
  const excluded = originalCount - passing.length;
  if (excluded > 0) {
    not_available.push(
      `${excluded} upstream read(s) fell below the relevance floor and are not reflected here.`,
    );
  }

  // Routes — sanctioned finer-grain offers. master's default grain is
  // county-month, but some upstreams publish finer (per-ZIP, per-association).
  // Surface those as plain user offers so a downstream Claude can route to the
  // grain we actually hold instead of opening with a flat "we don't carry it."
  //
  // GATE ON CONTRIBUTION, NOT WIRING. Each rule fires only when its upstream
  // emitted the finer-grain metric THIS run — a present-but-empty upstream
  // (env-swfl before §1's per-ZIP FEMA data lands; a brain that returned 0 rows
  // for the geography) must never light a false offer. Same failure mode as the
  // cre-swfl MarketBeat coverage caveat that fired on an empty feed.
  const byId = new Map(passing.map((p) => [p.upstream.brain_id, p.upstream]));
  const routes: string[] = [];
  const envSwfl = byId.get("env-swfl");
  if (envSwfl && envSwfl.key_metrics.some((m) => /^swfl_zip_/.test(m.metric))) {
    routes.push("Flood risk is tracked per ZIP — want it for a specific ZIP or address?");
  }
  // Corridor current-events route. Gated on cre's deterministic
  // `corridor_pulse_signals_live` count (>0), NOT on cre being present —
  // corridor-pulse is TTL-bounded and can empty while cre still votes; an
  // unconditional offer is the inverse-FMB false-offer bug. Text is kept
  // DISTINCT from the flood route above so a downstream Claude routes to the
  // right brain (CRE current events vs per-ZIP flood) instead of free-styling —
  // the failure that surfaced a sector charge-off on a Fort Myers Beach query.
  const cre = byId.get("cre-swfl");
  if (
    cre &&
    cre.key_metrics.some((m) => m.metric === "corridor_pulse_signals_live" && Number(m.value) > 0)
  ) {
    routes.push(
      "Recent commercial real-estate current events — leasing, sales, openings and closings — are tracked per area; want the latest for a specific area?",
    );
  }
  // Housing per-ZIP route. housing-swfl publishes one row per SWFL ZIP in a
  // `detail_tables` entry (grain "zip") — finer than master's county-month
  // headline. Gate on that table actually carrying rows THIS run (housing's
  // housing_by_zip table is [] when Redfin returns no SWFL ZIP medians,
  // housing-swfl.mts:525), NOT on housing-swfl merely being wired — same
  // contribution-not-wiring rule as the flood/corridor routes above. Wording is
  // kept DISTINCT from the flood ("flood risk") and corridor ("current events")
  // offers so a downstream Claude routes to the housing report, not the wrong one.
  const housing = byId.get("housing-swfl");
  if (housing && housing.detail_tables?.some((t) => t.grain === "zip" && t.rows.length > 0)) {
    routes.push(
      "Housing prices, days on market and supply are tracked per ZIP — want it for a specific ZIP or town?",
    );
  }
  // TODO(§3 + §9): add a condo-association route once condo-sirs-swfl is wired
  // to master AND holds per-association grain. Today its connector is
  // count-only-by-county (dbpr-sirs-source.mts), so offering "filings for that
  // building?" would be the inverse FMB bug — offering a grain we don't hold.

  return {
    not_available,
    finest_grain: "county-month",
    ...(routes.length > 0 ? { routes } : {}),
  };
}

/**
 * predictedWindow — the analyst-facing revisit horizon master logs and surfaces.
 * Free-form to mirror predictions.prediction_window TEXT. Undefined for the
 * empty/neutral read (no horizon to revisit).
 */
export function predictedWindow(args: {
  passing: PassingUpstream[];
  vote: DirectionVote;
}): string | undefined {
  const { passing, vote } = args;
  if (passing.length === 0 || vote.direction === "neutral") return undefined;
  const ids = new Set(passing.map((p) => p.upstream.brain_id));
  if (ids.has("logistics-swfl-nowcast")) {
    return "next freight-shock print (days), then re-confirm at the next monthly macro release";
  }
  return "~2-3 quarters (re-confirm on the next macro and tourism prints)";
}

/**
 * Step 6 — Key-metrics rollup. Reserve-then-fill, ordering-independent.
 *
 * Pass 1 (reserve): one metric per passing upstream, in DAG order. Every
 * upstream that produced any metric at all gets a seat at the table —
 * guaranteeing a T1 brain cannot lose its representation to a T2 brain that
 * simply ran earlier in the DAG.
 *
 * Pass 2 (fill): remaining slots up to the cap are filled from each upstream's
 * second metric (preserving the original "top 2 per upstream" producer
 * contract). Candidates are ranked by upstream `trust_tier` ascending (T1
 * before T2), then by `confidence × relevance_factor` descending, with DAG
 * order as a final tiebreak. This is the V2 fix the spec flagged.
 *
 * Overflow case (reserved.length > cap): trim the reservation by the same
 * ranking rule. When reserved.length > cap (cap = t1Count + 1), the
 * math-honest outcome is "best-tier brains keep their seat," not "whoever
 * ran first."
 *
 * Region headline floor: the consumer-facing region read MUST always surface the
 * region home-price and region rent figures when their upstreams pass — the
 * tier×weight cap was silently dropping them (housing's price is reserve-pass[0]
 * but could be trimmed in overflow; rentals' rent INDEX is its key_metrics[1], so
 * it landed in the fill pass and got cut behind higher-weight T1 secondaries).
 * GUARANTEED_MASTER_METRICS names those two slugs; after the normal rollup, any
 * named slug a passing upstream emitted is force-included if it isn't already
 * present. Deterministic: the scan is in DAG order, the slugs are a fixed set.
 */
// The region headline metrics master must never drop: one home-price (housing-swfl),
// one rent (rentals-swfl). Both are emitted by exactly one upstream each, so the
// scan resolves to a single metric per slug.
const GUARANTEED_MASTER_METRICS = [
  "housing_median_sale_price_swfl",
  "rental_rent_index_zori_regional_median",
] as const;

export function rollupKeyMetrics(passing: PassingUpstream[]): BrainOutputMetric[] {
  const rolled = rollupKeyMetricsBase(passing);

  // Region headline floor — force-include each guaranteed slug a passing upstream
  // emitted if the cap-trim dropped it. Scanned in DAG order over every upstream's
  // full key_metrics (the rent INDEX is key_metrics[1], so a [0]/[1]-only scan would
  // miss it — read the whole list). Appended after the ranked rollup so the existing
  // ordering is undisturbed when the slugs already survived.
  const present = new Set(rolled.map((m) => m.metric));
  const forced: BrainOutputMetric[] = [];
  for (const slug of GUARANTEED_MASTER_METRICS) {
    if (present.has(slug)) continue;
    for (const { upstream } of passing) {
      const hit = upstream.key_metrics.find((m) => m.metric === slug);
      if (hit) {
        forced.push(hit);
        present.add(slug);
        break;
      }
    }
  }
  return forced.length > 0 ? [...rolled, ...forced] : rolled;
}

/** The ranked reserve-then-fill rollup. Wrapped by rollupKeyMetrics, which then
 *  enforces the region-headline floor on top of this result. */
function rollupKeyMetricsBase(passing: PassingUpstream[]): BrainOutputMetric[] {
  const t1Count = passing.filter((p) => p.upstream.trust_tier === 1).length;
  const cap = t1Count + 1;
  type Indexed = {
    metric: BrainOutputMetric;
    tier: BrainTrustTier;
    weight: number;
    order: number;
  };

  const rank = (a: Indexed, b: Indexed): number =>
    a.tier - b.tier || b.weight - a.weight || a.order - b.order;

  const reserved: Indexed[] = [];
  const secondaries: Indexed[] = [];
  passing.forEach(({ upstream, factor }, i) => {
    const weight = upstream.confidence * factor;
    if (upstream.key_metrics.length > 0) {
      reserved.push({
        metric: upstream.key_metrics[0],
        tier: upstream.trust_tier,
        weight,
        order: i,
      });
    }
    if (upstream.key_metrics.length > 1) {
      secondaries.push({
        metric: upstream.key_metrics[1],
        tier: upstream.trust_tier,
        weight,
        order: i,
      });
    }
  });

  if (reserved.length >= cap) {
    return [...reserved]
      .sort(rank)
      .slice(0, cap)
      .map((c) => c.metric);
  }

  const remaining = cap - reserved.length;
  const fill = [...secondaries].sort(rank).slice(0, remaining);
  return [...reserved.map((c) => c.metric), ...fill.map((c) => c.metric)];
}

/**
 * Step 7 — Decay propagation. `half_life_hours` is the weighted average across
 * passing upstreams (weight = magnitude × confidence × relevance_factor — same
 * formula as direction voting). `decay_curve` quantized per spec thresholds.
 */
export function propagateDecay(passing: PassingUpstream[], now: Date): BrainOutputRelevance {
  const computed_at = now.toISOString();
  if (passing.length === 0) {
    return { decay_curve: "hours", half_life_hours: 24, computed_at };
  }
  let totalWeight = 0;
  let weightedHL = 0;
  for (const { upstream, factor } of passing) {
    const w = upstream.magnitude * upstream.confidence * factor;
    weightedHL += w * upstream.relevance.half_life_hours;
    totalWeight += w;
  }
  const half_life_hours =
    totalWeight > 0
      ? weightedHL / totalWeight
      : passing.reduce((s, p) => s + p.upstream.relevance.half_life_hours, 0) / passing.length;
  return {
    decay_curve: quantizeDecay(half_life_hours),
    half_life_hours,
    computed_at,
  };
}

function quantizeDecay(hours: number): DecayCurve {
  if (hours < 72) return "hours";
  if (hours < 500) return "days";
  if (hours < 2000) return "weeks";
  if (hours < 8760) return "months";
  return "permanent";
}

/**
 * Utility — deduplicate caveat strings, preserving first-occurrence order.
 *
 * Master's producer lifts upstream caveats AND emits its own (relevance-floor
 * exclusions, override-cascade firings). Two paths can independently surface
 * identical strings: e.g. an upstream's own template happens to match a
 * master-side template, or two upstreams template the same caveat. OUTPUT
 * receipts should show each distinct caveat once.
 *
 * Exact-string equality. No case- or whitespace-folding — caveats are
 * templated and deterministic; any divergence is intentional, not noise.
 */
export function dedupeCaveats(caveats: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of caveats) {
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/**
 * Step 8 — Empty-synthesis result. Master NEVER hallucinates from nothing.
 * Returns the full BrainOutputProducerResult slice that the master producer
 * can return directly.
 */
export function emptySynthesisResult(
  originalCount: number,
  floor: number,
  now: Date,
): BrainOutputProducerResult {
  const computed_at = now.toISOString();
  return {
    direction: "neutral",
    magnitude: 0,
    drivers: [],
    overrides: [],
    conclusion: `Insufficient current data for synthesis. ${originalCount} upstream brains below relevance floor ${floor}.`,
    key_metrics: [],
    caveats: ["All upstream brains below relevance threshold"],
    contradicts: [],
    upstream_count: 0,
    trust_tier: 4,
    relevance: { decay_curve: "hours", half_life_hours: 24, computed_at },
    exogenous_signals: [],
  };
}
