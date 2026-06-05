/**
 * Corridor Factor — DRAFT, NOT WIRED.
 *
 * First Tier-3 derived metric (roadmap §7.1, Goal 5). A single 0–100 composite
 * that ranks a SWFL CRE corridor against the other corridors in the same run on
 * four side-by-side metrics that today are emitted with NO synthesis:
 *
 *   - cap_rate_pct        (% — capitalization rate)
 *   - vacancy_rate_pct    (% — vacant space)
 *   - absorption_sqft     (net absorption, sqft)
 *   - asking_rent_psf     (NNN asking rent, $/sqft/yr)
 *
 * This is a PURE deterministic function. Per CLAUDE.md "math in code, narrative
 * in producers", it does ALL the math; an LLM only ever writes prose ABOUT the
 * number, never computes it.
 *
 * ── STATUS: WIRED (cre-swfl) ─────────────────────────────────────────────────
 * `computeCorridorFactor` is called from `creSwflOutputProducer` in
 * `refinery/packs/cre-swfl.mts`. The diff-review gate (CLAUDE.md RULE 1) was
 * satisfied before push. This file ships function + tests; the pack wires it.
 *
 * ── DESIGN DECISIONS ─────────────────────────────────────────────────────────
 *
 * NORMALIZATION: percentile-rank WITHIN the current SWFL corridor cohort.
 *   Rationale. The SWFL corpus is ~24 corridors — too few for a stable
 *   population mean/SD (z-score) and pathologically sensitive to a single
 *   outlier (one mega-absorption quarter would crush every other z). Min-max is
 *   even more outlier-fragile (the extreme defines the whole 0..1 range).
 *   Percentile-rank is ordinal: it answers the only question a corridor score
 *   should answer — "where does this corridor sit RELATIVE to its SWFL peers
 *   this quarter?" — and is robust to one wild value. It is also self-banding:
 *   the score already lives on a bounded 0–100 scale before weighting. The cost
 *   is that it discards magnitude (the #1 corridor scores the same whether it
 *   leads by a hair or a mile); that is an acceptable trade for a comparative
 *   "factor", and the raw metrics still travel alongside for anyone who needs
 *   magnitude. The cohort is "every corridor passed into THIS call" — the score
 *   is explicitly run-relative, never an absolute grade, and the band labels say
 *   so.
 *
 * POLARITY (never inherited — oriented per metric, assumption stated):
 *   - vacancy_rate_pct  → LOWER is better (bullish). Not debatable: empty space
 *     is bad for a corridor. Oriented "lower_is_better".
 *   - absorption_sqft   → HIGHER is better (bullish). Net space being leased up
 *     is demand. Oriented "higher_is_better".
 *   - cap_rate_pct      → POLARITY DEPENDS ON THE CONSUMER, so it is CONFIG, not
 *     hardcoded. A BUYER/yield-seeker wants a HIGHER cap rate (more income per
 *     dollar); an OWNER/seller reads a higher cap rate as a LOWER valuation /
 *     weaker market. DEFAULT ASSUMPTION HERE: this is a corridor-HEALTH /
 *     owner-equity lens, where a compressing (lower) cap rate signals a
 *     stronger, more sought-after corridor → default "lower_is_better". Flip via
 *     config for a buyer/yield lens.
 *   - asking_rent_psf   → POLARITY DEPENDS ON THE CONSUMER, so it is CONFIG too.
 *     A LANDLORD/owner wants HIGHER rent; a TENANT wants lower. DEFAULT
 *     ASSUMPTION HERE: corridor-health/landlord lens → higher rent = stronger
 *     corridor → default "higher_is_better". Flip via config for a tenant lens.
 *
 *   Polarity is applied by computing a percentile so that 100 ALWAYS means
 *   "best for this lens" before weighting — a "lower_is_better" metric percentile
 *   is inverted. No metric's orientation is ever assumed from another's.
 *
 * WEIGHTING: CONFIG, not hardcoded. Defaults are equal (0.25 each) — the honest
 *   prior when we have no backtest yet (roadmap §8.2 says backtest every derived
 *   metric against 2022–2024 outcomes; until then, equal weight avoids inventing
 *   a precision we don't have). The operator decides the real weights. Weights
 *   are renormalized across only the metrics PRESENT for a corridor, so a
 *   missing input redistributes its weight rather than dragging the score toward
 *   zero. **This is THE decision for the operator (see report).**
 *
 * MISSING DATA: a corridor missing one (or more) inputs must NOT NaN the whole
 *   score. Rules:
 *     - A metric that is null for a corridor is dropped from THAT corridor's
 *       score; its weight is redistributed across the present metrics.
 *     - A corridor with ZERO present metrics yields score=null, band="unknown".
 *     - Percentile cohorts are computed per-metric over only the corridors that
 *       HAVE that metric — a corridor missing absorption simply doesn't appear in
 *       the absorption percentile cohort and isn't penalised for it.
 *     - `components` always reports which metrics contributed and which were
 *       absent, so the gap is visible, never silently smoothed (CLAUDE.md
 *       no-smoothing).
 *
 * OUTPUT SHAPE: `{ score, band, components }` per corridor.
 *   - score: integer 0–100 (rounded), or null when no inputs.
 *   - band: "strong" | "neutral" | "soft" | "unknown" (>=67 / 34–66 / <34 /
 *     no-data). Band thresholds are config too.
 *   - components: per-metric { present, orientedPercentile, weight } so the
 *     score is fully auditable and a downstream surface can show the receipt.
 *
 *   Deliberately NOT a BrainOutputMetric or detail-cell here — emitting it into
 *   a pack is the wiring step that needs operator review. The producer that
 *   eventually consumes this will map `{score, band}` onto a BrainOutputMetric
 *   (variable_type "intensive", units "index 0-100", display_format "raw") or a
 *   detail-table cell at that time.
 */

export type CorridorFactorMetricKey =
  | "cap_rate_pct"
  | "vacancy_rate_pct"
  | "absorption_sqft"
  | "asking_rent_psf";

export type Polarity = "higher_is_better" | "lower_is_better";

export type CorridorFactorBand = "strong" | "neutral" | "soft" | "unknown";

/** One corridor's raw inputs. Any metric may be null (not yet sourced). */
export interface CorridorFactorInput {
  /** Stable corridor key (the DB `corridor_name`). Used only to key results. */
  name: string;
  cap_rate_pct: number | null;
  vacancy_rate_pct: number | null;
  absorption_sqft: number | null;
  asking_rent_psf: number | null;
}

/** Per-metric configuration: how it orients and how much it counts. */
export interface MetricConfig {
  polarity: Polarity;
  /** Relative weight (any non-negative scale; renormalized internally). */
  weight: number;
}

export interface CorridorFactorConfig {
  metrics: Record<CorridorFactorMetricKey, MetricConfig>;
  /** Score >= strong → "strong"; >= neutral → "neutral"; else "soft". */
  bands: { strong: number; neutral: number };
}

/**
 * DEFAULT config. Equal weights (no backtest yet). Polarity defaults documented
 * in the file header: corridor-HEALTH / owner-equity lens.
 *   - cap_rate_pct:     lower_is_better  (compressing cap = stronger corridor)
 *   - vacancy_rate_pct: lower_is_better  (not debatable)
 *   - absorption_sqft:  higher_is_better (demand)
 *   - asking_rent_psf:  higher_is_better (landlord/health lens)
 * Callers wanting a buyer/tenant lens pass a config flipping cap_rate and/or
 * asking_rent to the opposite polarity. NOTHING here is inherited between
 * metrics — each polarity is set explicitly.
 */
export const DEFAULT_CORRIDOR_FACTOR_CONFIG: CorridorFactorConfig = {
  metrics: {
    cap_rate_pct: { polarity: "lower_is_better", weight: 0.25 },
    vacancy_rate_pct: { polarity: "lower_is_better", weight: 0.25 },
    absorption_sqft: { polarity: "higher_is_better", weight: 0.25 },
    asking_rent_psf: { polarity: "higher_is_better", weight: 0.25 },
  },
  // Empirical placeholder — ~equal-thirds of 0–100 (0–33 soft, 34–66 neutral,
  // 67–100 strong). No backtest yet; §8.2 target: 2022–2024 corridor outcomes.
  // Operator tunes once N > 30 quarterly observations are available.
  bands: { strong: 67, neutral: 34 },
};

const METRIC_KEYS: CorridorFactorMetricKey[] = [
  "cap_rate_pct",
  "vacancy_rate_pct",
  "absorption_sqft",
  "asking_rent_psf",
];

/** Per-metric receipt in the output. */
export interface CorridorFactorComponent {
  metric: CorridorFactorMetricKey;
  /** Was a non-null value present for this corridor this run? */
  present: boolean;
  /** Polarity used to orient it (echoed for audit). */
  polarity: Polarity;
  /**
   * Percentile (0–100) AFTER polarity orientation: 100 = best-for-lens within
   * the cohort. null when the metric was absent for this corridor.
   */
  orientedPercentile: number | null;
  /** Renormalized weight actually applied (0 when absent). */
  weight: number;
}

export interface CorridorFactorResult {
  name: string;
  /** Integer 0–100, or null when the corridor had zero present inputs. */
  score: number | null;
  band: CorridorFactorBand;
  components: CorridorFactorComponent[];
}

/**
 * Percentile rank of `value` within `cohort` on a 0–100 scale, "higher value →
 * higher percentile" orientation. Uses the mean-of-strictly-less + half-of-ties
 * convention (a.k.a. mid-rank), so a single-element cohort scores 50 (no
 * information to rank against) and identical values share the same percentile.
 *
 * cohort MUST be the set of non-null values for the metric (caller guarantees).
 */
export function percentileRank(value: number, cohort: number[]): number {
  const n = cohort.length;
  if (n === 0) return 50; // degenerate; caller shouldn't hit this
  if (n === 1) return 50; // nothing to compare against → neutral
  let below = 0;
  let equal = 0;
  for (const c of cohort) {
    if (c < value) below += 1;
    else if (c === value) equal += 1;
  }
  // mid-rank: count ties as half below
  return ((below + equal / 2) / n) * 100;
}

/** Map a finished 0–100 score (or null) to a band using config thresholds. */
export function bandFor(
  score: number | null,
  bands: { strong: number; neutral: number },
): CorridorFactorBand {
  if (score == null) return "unknown";
  if (score >= bands.strong) return "strong";
  if (score >= bands.neutral) return "neutral";
  return "soft";
}

/**
 * Compute the Corridor Factor for EVERY corridor in `inputs`, scored relative to
 * that same set (the run cohort). Pure: no IO, no clock, no globals; identical
 * inputs → identical output.
 *
 * Returns one result per input, in input order.
 */
export function computeCorridorFactor(
  inputs: CorridorFactorInput[],
  config: CorridorFactorConfig = DEFAULT_CORRIDOR_FACTOR_CONFIG,
): CorridorFactorResult[] {
  // Build per-metric cohorts: the non-null values across all corridors. A
  // corridor missing a metric simply isn't in that metric's cohort, and is
  // never penalised for the gap.
  const cohorts: Record<CorridorFactorMetricKey, number[]> = {
    cap_rate_pct: [],
    vacancy_rate_pct: [],
    absorption_sqft: [],
    asking_rent_psf: [],
  };
  for (const key of METRIC_KEYS) {
    for (const row of inputs) {
      const v = row[key];
      if (v != null && Number.isFinite(v)) cohorts[key].push(v);
    }
  }

  return inputs.map((row): CorridorFactorResult => {
    // 1. Per-metric oriented percentile (null when absent).
    const raw: Array<{
      metric: CorridorFactorMetricKey;
      present: boolean;
      polarity: Polarity;
      orientedPercentile: number | null;
      baseWeight: number;
    }> = METRIC_KEYS.map((key) => {
      const cfg = config.metrics[key];
      const v = row[key];
      const present = v != null && Number.isFinite(v);
      let orientedPercentile: number | null = null;
      if (present) {
        // Higher-value percentile within the cohort...
        const p = percentileRank(v as number, cohorts[key]);
        // ...then orient so 100 ALWAYS means best-for-lens. A lower_is_better
        // metric is inverted (100 - p). Polarity is taken from config per
        // metric — never inherited from another metric.
        orientedPercentile = cfg.polarity === "lower_is_better" ? 100 - p : p;
      }
      return {
        metric: key,
        present,
        polarity: cfg.polarity,
        orientedPercentile,
        baseWeight: cfg.weight,
      };
    });

    // 2. Renormalize weights across ONLY the present metrics so a missing input
    //    redistributes its weight instead of dragging the score toward 0.
    const presentWeightSum = raw.reduce(
      (acc, r) => acc + (r.present ? r.baseWeight : 0),
      0,
    );

    const components: CorridorFactorComponent[] = raw.map((r) => ({
      metric: r.metric,
      present: r.present,
      polarity: r.polarity,
      orientedPercentile: r.orientedPercentile,
      weight:
        r.present && presentWeightSum > 0 ? r.baseWeight / presentWeightSum : 0,
    }));

    // 3. Weighted sum of oriented percentiles → 0–100 score. Zero present
    //    metrics (or all-zero weights) → null score, "unknown" band.
    let score: number | null = null;
    if (presentWeightSum > 0) {
      const weighted = components.reduce(
        (acc, c) =>
          c.present && c.orientedPercentile != null
            ? acc + c.orientedPercentile * c.weight
            : acc,
        0,
      );
      score = Math.round(weighted);
    }

    return {
      name: row.name,
      score,
      band: bandFor(score, config.bands),
      components,
    };
  });
}
