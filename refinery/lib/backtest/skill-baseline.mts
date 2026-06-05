/**
 * Skill baseline for the Track-B backtest (flywheel_backtest_decision_function).
 *
 * Pure arithmetic — no external imports, no I/O. Scores a set of directional
 * calls against a persistence null (predict_t = observed_{t-1}) and reports the
 * lift, so a "we beat naive carry-forward" claim is a measured number, not a vibe.
 *
 * Denominator (locked, Option b): a call is SCORED ("in-set") iff it is not the
 * first call for its slug (persistence needs a prior) AND its observed outcome is
 * directional (a neutral observed is inconclusive for a directional call). Both
 * system_accuracy and persistence_accuracy are computed over this one shared set
 * so `lift` is an honest delta. A neutral observation is excluded as a TARGET but
 * is retained in the series as the PRIOR for the next call.
 *
 * Provenance is NOT silent: every scored call carries source_tag, the scored
 * denominator is broken out in n_calls_by_tag, and a clean lake_tier1-only
 * accuracy ships alongside the blended system_accuracy. If the two diverge, the
 * caption is forced to acknowledge ODD (odd_extract) contamination.
 */

export type Direction = "bullish" | "bearish" | "neutral";

export interface ScoredCall {
  slug: string;
  family: string;
  as_of_date: string; // YYYY-MM-DD
  predicted: "bullish" | "bearish";
  observed: Direction;
  /** Precomputed by the caller — same semantics as the forward grader. */
  correct: boolean;
  source_tag: "lake_tier1" | "odd_extract" | "fixture";
}

export interface SkillScore {
  /** Blended accuracy over ALL scored calls, any source_tag. */
  system_accuracy: number;
  /** Accuracy over scored calls with source_tag === "lake_tier1" ONLY (odd_extract + fixture excluded). */
  lake_tier1_accuracy: number;
  persistence_accuracy: number;
  /** system_accuracy - persistence_accuracy (same shared denominator). */
  lift: number;
  /** Scored calls: non-first-per-slug AND non-neutral observed. */
  n_calls: number;
  /** Distinct family strings across the INPUT calls (effective N for the caption). */
  n_families: number;
  n_correct: number;
  n_persistence_correct: number;
  /** Scored denominator partitioned by source_tag (sums to n_calls). */
  n_calls_by_tag: Record<string, number>;
}

/**
 * Persistence null for one slug's ordered observation series: predict_t =
 * observed_{t-1}. Output has length max(0, n-1); empty/single input → []. Neutral
 * observations are emitted as predictions (the neutral-target filter lives in the
 * scorer, not here). Pure positional shift — the caller sorts.
 */
export function computePersistenceNull(
  observations: Array<{ date: string; direction: Direction }>,
): Array<{ date: string; predicted: Direction }> {
  const out: Array<{ date: string; predicted: Direction }> = [];
  for (let i = 1; i < observations.length; i++) {
    out.push({
      date: observations[i].date,
      predicted: observations[i - 1].direction,
    });
  }
  return out;
}

/**
 * Score directional calls against the persistence null. Reconstructs the
 * persistence prediction internally (group by slug, sort by as_of_date, call
 * computePersistenceNull) rather than taking it as a param — the harness this
 * feeds does not exist yet.
 */
export function computeSkillScore(calls: ScoredCall[]): SkillScore {
  let n_calls = 0;
  let n_correct = 0;
  let n_persistence_correct = 0;
  let lt_n = 0;
  let lt_correct = 0;
  const n_calls_by_tag: Record<string, number> = {};

  // Group by slug.
  const bySlug = new Map<string, ScoredCall[]>();
  for (const c of calls) {
    const g = bySlug.get(c.slug);
    if (g) g.push(c);
    else bySlug.set(c.slug, [c]);
  }

  for (const group of bySlug.values()) {
    // Sort ascending by as_of_date (lexicographic is correct for YYYY-MM-DD).
    const ordered = [...group].sort((a, b) =>
      a.as_of_date < b.as_of_date ? -1 : a.as_of_date > b.as_of_date ? 1 : 0,
    );
    const preds = computePersistenceNull(
      ordered.map((c) => ({ date: c.as_of_date, direction: c.observed })),
    );
    // preds[k] aligns to ordered[k + 1] (the first call has no prior).
    for (let k = 0; k < preds.length; k++) {
      const target = ordered[k + 1];
      if (target.observed === "neutral") continue; // inconclusive target — drop, but it stays a prior

      // EDGE (intentional, conservative): when the PRIOR observation was neutral,
      // preds[k].predicted is "neutral" — so the persistence null predicts neutral
      // against this directional target and scores as a MISS below (neutral never
      // equals bullish/bearish). We do NOT skip such persistence predictions. That
      // makes the naive carry-forward HARDER to beat, so `lift` is a clean lower
      // bound on system skill rather than an inflated one. Pinned by the
      // "neutral prior ... counts as a persistence miss" test.
      n_calls++;
      n_calls_by_tag[target.source_tag] =
        (n_calls_by_tag[target.source_tag] ?? 0) + 1;
      if (target.correct) n_correct++;
      if (preds[k].predicted === target.observed) n_persistence_correct++;
      if (target.source_tag === "lake_tier1") {
        lt_n++;
        if (target.correct) lt_correct++;
      }
    }
  }

  const system_accuracy = n_calls > 0 ? n_correct / n_calls : 0;
  const persistence_accuracy =
    n_calls > 0 ? n_persistence_correct / n_calls : 0;
  const lake_tier1_accuracy = lt_n > 0 ? lt_correct / lt_n : 0;

  return {
    system_accuracy,
    lake_tier1_accuracy,
    persistence_accuracy,
    lift: system_accuracy - persistence_accuracy,
    n_calls,
    n_families: new Set(calls.map((c) => c.family)).size,
    n_correct,
    n_persistence_correct,
    n_calls_by_tag,
  };
}
