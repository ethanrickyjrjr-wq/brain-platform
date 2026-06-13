/**
 * Track-B backward-engine decision function (flywheel_backtest_decision_function).
 *
 * Given a metric's value AS OF a past date and the deterministic grading config
 * for its slug, emit the directional call the system WOULD have made then. This
 * is a thin adapter over the already-correct `computeDirection()` in the forward
 * grader — the grading math is NOT re-implemented here, only re-pointed at an
 * as-of value instead of a window-close observation.
 *
 * Pure: no Supabase calls, no LLM imports, no I/O. The transitive import of
 * `computeDirection` pulls @supabase/supabase-js into the module graph but never
 * constructs a client at import time (the extract-to-leaf cleanup is deferred —
 * touching the live grading path isn't worth it this pass).
 *
 * Provenance: `source_tag` rides verbatim from input to call. The math does NOT
 * gate on it — the harness / ian_retrodiction_demo decides whether to filter or
 * caveat ODD-extracted values. This keeps odd_extract deltas taggable instead of
 * silently mixing with lake_tier1 values downstream.
 */

import { computeDirection, type ObservedDirection } from "../../grade/grade-predictions.mts";
import type { ResolvedGradeConfig } from "../../vocab/loader.mts";

export type { ObservedDirection };

export type SourceTag = "lake_tier1" | "odd_extract" | "fixture" | "view_vintage";

export interface AsOfInput {
  slug: string;
  /** YYYY-MM-DD — the point in time this value was current. */
  as_of_date: string;
  as_of_value: number;
  /** Required only for cfg.grade_basis === "delta"; ignored for "sign". */
  prior_value: number | null;
  /** Echoed verbatim into the call; the math never gates on it. */
  source_tag: SourceTag;
}

export interface BacktestCall {
  slug: string;
  as_of_date: string;
  direction: ObservedDirection;
  /** Echoed from cfg.grade_basis. */
  basis: "sign" | "delta";
  /** Echoed from cfg.direction_polarity (never "none" — a none-polarity input returns null). */
  polarity: "higher_is_bullish" | "lower_is_bullish";
  source_tag: SourceTag;
}

/**
 * Emit the as-of directional call, or null when the call is not gradeable.
 *
 * Returns null when:
 *   • !cfg.gradeable                         (slug has no usable grading rule)
 *   • cfg.direction_polarity === "none"      (Gap-3 guard; also narrows the type)
 *   • grade_basis === "delta" && prior_value === null  (delta needs a baseline)
 *
 * sign basis  → computeDirection(as_of_value, 0, cfg)          — baseline ignored
 * delta basis → computeDirection(as_of_value, prior_value!, cfg)
 */
export function computeBacktestCall(
  input: AsOfInput,
  cfg: ResolvedGradeConfig,
): BacktestCall | null {
  if (!cfg.gradeable) return null;
  // gradeable === true already implies a directional polarity, but make the
  // invariant explicit: this both guards correctness and narrows
  // DirectionPolarity ("none" included) to BacktestCall.polarity's 2-value union.
  if (cfg.direction_polarity === "none") return null;

  // grade_basis is non-null whenever gradeable === true; this narrows the type.
  const basis = cfg.grade_basis;
  if (basis !== "sign" && basis !== "delta") return null;

  let direction: ObservedDirection;
  if (basis === "sign") {
    direction = computeDirection(input.as_of_value, 0, cfg);
  } else {
    if (input.prior_value === null) return null;
    direction = computeDirection(input.as_of_value, input.prior_value, cfg);
  }

  return {
    slug: input.slug,
    as_of_date: input.as_of_date,
    direction,
    basis,
    polarity: cfg.direction_polarity,
    source_tag: input.source_tag,
  };
}
