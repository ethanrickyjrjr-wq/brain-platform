/**
 * Deterministic prediction grader — the flywheel's missing edge (Goal 9, Phase 2).
 *
 * Drains the queue Phase 1 fills: each master refine pins a gradeable prediction
 * (predictions-log deriveGradeFields) and snapshots every numeric metric
 * (metric-observations-log). This job waits for a prediction's window to close,
 * looks up what the metric actually did, and banks an immutable machine verdict.
 *
 * HARD RULE: zero LLM imports. Every verdict is pure deterministic math — that is
 * the entire point of the grader (the moat is the *scored* history, not prose).
 *
 * The write is a single atomic DB transaction via the public.grade_prediction RPC
 * (docs/sql/20260601_grade_predictions.sql): INSERT outcomes + UPDATE predictions
 * either both land or neither does. If the RPC throws, grade_status stays
 * gradeable/pending_data and the row retries next run.
 */

import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import {
  resolveGradeConfig,
  type ResolvedGradeConfig,
} from "../vocab/loader.mts";

export type ObservedDirection = "bullish" | "bearish" | "neutral";

/** The predictions-row fields the grader queues on. */
export interface DuePrediction {
  id: string;
  gradeable_slug: string;
  baseline_value: number;
  predicted_direction: "bullish" | "bearish";
  /** YYYY-MM-DD (pinned at capture as refined_at + window_days, UTC). */
  window_end_date: string;
}

/** A resolved metric observation — the value once the window closed. */
export interface Observation {
  value: number;
  observed_at: string;
  source_url: string | null;
}

/** A raw metric_observations candidate, before the master-deprioritizing tiebreak. */
export interface CandidateObservation extends Observation {
  brain_id: string;
}

/** Payload for the atomic grade_prediction RPC. */
export interface GradePayload {
  prediction_id: string;
  observed_value: number;
  baseline_value: number;
  predicted_direction: "bullish" | "bearish";
  observed_direction: ObservedDirection;
  direction_correct: boolean;
  error: number;
  observed_at: string;
  source_url: string | null;
  grade_config: ResolvedGradeConfig;
}

/** Storage seam — real impl wraps supabase-js; tests inject an in-memory fake. */
export interface GraderStore {
  /** Predictions due for grading: status gradeable|pending_data, window closed. */
  selectDue(): Promise<DuePrediction[]>;
  /** Earliest metric value at/after the window close, or null if none yet. */
  findObservation(
    slug: string,
    windowEndDate: string,
  ): Promise<Observation | null>;
  /** Atomic INSERT outcome + UPDATE prediction→graded (the RPC). */
  gradePrediction(payload: GradePayload): Promise<void>;
  /** No observation yet — keep it queued for a later run. */
  markPendingData(id: string): Promise<void>;
  /** Slug lost its grading config since capture — drop from the machine queue. */
  markUngradeable(id: string): Promise<void>;
}

export interface GradeTally {
  graded: number;
  pending: number;
  skipped: number;
  errors: number;
}

export interface RunGraderOpts {
  /** Compute verdicts and log, but make no writes. */
  dryRun?: boolean;
  /**
   * Live grading-config resolver. Defaults to the vocabulary's resolveGradeConfig
   * — re-resolved at grade time so a slug that lost its polarity block since
   * capture is skipped, not mis-graded. Injectable for deterministic tests.
   */
  resolveConfig?: (slug: string) => ResolvedGradeConfig;
}

/**
 * Resolve observed direction from the value once the window closed. Pure.
 *
 * grade_basis 'delta' grades the move vs the pinned baseline; 'sign' grades the
 * sign of the value itself (the metric is already a change/z-score). epsilon_mode
 * 'relative' scales the deadband by |baseline|. direction_polarity flips the
 * result for lower-is-bullish metrics. A move inside the deadband is 'neutral'.
 *
 * Caller guarantees cfg.gradeable === true (epsilon / grade_basis / window_days
 * non-null, direction_polarity !== 'none').
 */
export function computeDirection(
  observed: number,
  baseline: number,
  cfg: ResolvedGradeConfig,
): ObservedDirection {
  const epsilon = cfg.epsilon ?? 0;
  let raw: ObservedDirection;
  if (cfg.grade_basis === "sign") {
    // The metric value is already a change / z-score: grade its own sign.
    raw =
      Math.abs(observed) <= epsilon
        ? "neutral"
        : observed > 0
          ? "bullish"
          : "bearish";
  } else {
    // delta: grade the move vs the pinned baseline.
    const diff = observed - baseline;
    const deadband =
      cfg.epsilon_mode === "relative" ? epsilon * Math.abs(baseline) : epsilon;
    raw =
      Math.abs(diff) <= deadband ? "neutral" : diff > 0 ? "bullish" : "bearish";
  }
  // A directional call that lands inside the deadband did not come true — it is
  // graded against predicted_direction (bullish|bearish) and so reads incorrect.
  if (raw === "neutral") return "neutral";
  if (cfg.direction_polarity === "lower_is_bullish") {
    return raw === "bullish" ? "bearish" : "bullish";
  }
  return raw;
}

/**
 * Pick the authoritative observation from raw candidates: earliest observed_at,
 * and among rows sharing that vintage prefer the leaf brain over master's
 * re-surfaced copy. Pure. Returns null for an empty candidate list.
 */
export function pickEarliestObservation(
  candidates: CandidateObservation[],
): Observation | null {
  if (candidates.length === 0) return null;
  const stamped = candidates.map((c) => ({ c, t: Date.parse(c.observed_at) }));
  const minT = Math.min(...stamped.map((x) => x.t));
  const atMin = stamped.filter((x) => x.t === minT).map((x) => x.c);
  const chosen = atMin.find((c) => c.brain_id !== "master") ?? atMin[0];
  return {
    value: chosen.value,
    observed_at: chosen.observed_at,
    source_url: chosen.source_url,
  };
}

/**
 * Drain the grade queue. Re-resolves each slug's config LIVE (a slug that lost
 * its polarity block since capture is skipped, not mis-graded). Errors from the
 * store leave the row queued and are tallied; the queue is retried next run.
 */
export async function runGrader(
  store: GraderStore,
  opts: RunGraderOpts = {},
): Promise<GradeTally> {
  const dryRun = opts.dryRun ?? false;
  const resolveConfig = opts.resolveConfig ?? resolveGradeConfig;
  const tally: GradeTally = { graded: 0, pending: 0, skipped: 0, errors: 0 };

  const due = await store.selectDue();
  if (due.length === 0) {
    console.log("0 predictions due for grading.");
    return tally;
  }

  for (const pred of due) {
    const cfg = resolveConfig(pred.gradeable_slug);

    // Slug lost (or never had) a usable grading rule since capture — drop it from
    // the machine queue rather than guess. No outcome row.
    if (!cfg.gradeable) {
      console.log(
        `[SKIP unconfigured] ${pred.gradeable_slug} — ${cfg.reason ?? "ungradeable"}`,
      );
      if (!dryRun) await store.markUngradeable(pred.id);
      tally.skipped++;
      continue;
    }

    const obs = await store.findObservation(
      pred.gradeable_slug,
      pred.window_end_date,
    );

    // Window closed but the next vintage has not been ingested yet — keep queued.
    if (!obs) {
      console.log(
        `[PENDING] ${pred.gradeable_slug} window_end=${pred.window_end_date} — no observation yet`,
      );
      if (!dryRun) await store.markPendingData(pred.id);
      tally.pending++;
      continue;
    }

    const observed_direction = computeDirection(
      obs.value,
      pred.baseline_value,
      cfg,
    );
    const direction_correct = observed_direction === pred.predicted_direction;

    if (dryRun) {
      console.log(
        `[DRY-RUN would grade] ${pred.gradeable_slug} observed=${observed_direction} correct=${direction_correct}`,
      );
      tally.graded++;
      continue;
    }

    try {
      await store.gradePrediction({
        prediction_id: pred.id,
        observed_value: obs.value,
        baseline_value: pred.baseline_value,
        predicted_direction: pred.predicted_direction,
        observed_direction,
        direction_correct,
        // A sign-basis metric IS already a change / z-score, so its realized
        // magnitude is the value itself; a delta-basis error is the move vs baseline.
        error:
          cfg.grade_basis === "sign"
            ? obs.value
            : obs.value - pred.baseline_value,
        observed_at: obs.observed_at,
        source_url: obs.source_url,
        grade_config: cfg,
      });
      console.log(
        `[GRADED] ${pred.gradeable_slug} observed=${observed_direction} correct=${direction_correct}`,
      );
      tally.graded++;
    } catch (e) {
      // Verdict not banked: status stays gradeable/pending_data, retried next run.
      console.error(
        `[ERROR] ${pred.gradeable_slug} grade failed — left queued:`,
        e instanceof Error ? e.message : e,
      );
      tally.errors++;
    }
  }

  return tally;
}

/** Real store over supabase-js. Not unit-tested — exercised by --dry-run against the live DB. */
export function createSupabaseGraderStore(
  url: string,
  key: string,
): GraderStore {
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // window_end_date is a UTC-pinned DATE (capture used addDaysUTC) — compare to UTC today.
  const today = new Date().toISOString().slice(0, 10);

  return {
    async selectDue() {
      // status IN (gradeable, pending_data) is equivalent to "no machine outcome
      // yet": grade_prediction atomically flips status->graded as it writes the
      // outcome, so the partial-unique NOT EXISTS is redundant given that invariant.
      // pending_data is included so a row that was missing its observation requeues.
      const { data, error } = await sb
        .from("predictions")
        .select(
          "id, gradeable_slug, baseline_value, predicted_direction, window_end_date",
        )
        .in("grade_status", ["gradeable", "pending_data"])
        .lte("window_end_date", today)
        .not("gradeable_slug", "is", null)
        .not("baseline_value", "is", null)
        .not("predicted_direction", "is", null);
      if (error) throw new Error(`selectDue failed: ${error.message}`);
      return (data ?? []) as DuePrediction[];
    },

    async findObservation(slug, windowEndDate) {
      const { data, error } = await sb
        .from("metric_observations")
        .select("value, observed_at, source_url, brain_id")
        .eq("slug", slug)
        .gte("observed_at", windowEndDate)
        .order("observed_at", { ascending: true })
        .limit(20);
      if (error) throw new Error(`findObservation failed: ${error.message}`);
      return pickEarliestObservation((data ?? []) as CandidateObservation[]);
    },

    async gradePrediction(payload) {
      const { error } = await sb.rpc("grade_prediction", {
        p_prediction_id: payload.prediction_id,
        p_observed_value: payload.observed_value,
        p_baseline_value: payload.baseline_value,
        p_predicted_direction: payload.predicted_direction,
        p_observed_direction: payload.observed_direction,
        p_direction_correct: payload.direction_correct,
        p_error: payload.error,
        p_observed_at: payload.observed_at,
        p_source_url: payload.source_url,
        p_grade_config: payload.grade_config,
      });
      if (error)
        throw new Error(`grade_prediction RPC failed: ${error.message}`);
    },

    async markPendingData(id) {
      const { error } = await sb
        .from("predictions")
        .update({ grade_status: "pending_data" })
        .eq("id", id);
      if (error) throw new Error(`markPendingData failed: ${error.message}`);
    },

    async markUngradeable(id) {
      const { error } = await sb
        .from("predictions")
        .update({ grade_status: "ungradeable" })
        .eq("id", id);
      if (error) throw new Error(`markUngradeable failed: ${error.message}`);
    },
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.SUPABASE_URL ?? process.env.BRAINS_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ?? process.env.BRAINS_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error(
      "grade-predictions: SUPABASE_URL / SUPABASE_SERVICE_KEY not set — cannot grade.",
    );
    process.exit(1);
  }

  const store = createSupabaseGraderStore(url, key);
  let tally: GradeTally;
  try {
    tally = await runGrader(store, { dryRun });
  } catch (e) {
    console.error(
      "grade-predictions: fatal:",
      e instanceof Error ? e.message : e,
    );
    process.exit(1);
    return;
  }

  console.log(
    `Done. Graded: ${tally.graded}, Pending: ${tally.pending}, Skipped: ${tally.skipped}, Errors: ${tally.errors}`,
  );
  process.exit(tally.errors > 0 ? 1 : 0);
}

// CLI entry — repo idiom (works under both `bun` and `node`; import.meta.main is
// deliberately avoided for portability, matching refinery/sources/*-source.mts).
if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  void main();
}
