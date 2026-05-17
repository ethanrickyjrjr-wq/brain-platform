/**
 * Predictions logger — roadmap §6.1.4.
 *
 * One row per successful master refine, written to Supabase `predictions`.
 * The hook is silent-no-op when Supabase env isn't configured (matches the
 * locked v1.1 decision #11 pattern: local .md is the artifact; registry is
 * metadata). Non-master packs are also a no-op — the spec scopes logging to
 * master only because master is the synthesized customer-facing call.
 *
 * The companion `outcomes` table (FK prediction_id) stays empty until an
 * analyst observes reality. We do not predict the outcome here.
 */

import { createClient } from "@supabase/supabase-js";
import type { BrainOutput } from "../types/brain-output.mts";

/** Pack id that triggers the log. Master is the only synthesizer today. */
const MASTER_PACK_ID = "master";

/** What we persist into predictions.metadata — everything the SGD job or
 *  backtest harness might want later that isn't a first-class column. */
export interface PredictionMetadata {
  direction: BrainOutput["direction"];
  magnitude: BrainOutput["magnitude"];
  trust_tier: BrainOutput["trust_tier"];
  upstream_count: BrainOutput["upstream_count"];
  contradicts: BrainOutput["contradicts"];
  relevance_half_life_hours: number;
  /** Top key_metrics — bounded to keep the JSONB row size honest. */
  top_key_metrics: BrainOutput["key_metrics"];
  version: BrainOutput["version"];
}

export interface PredictionRow {
  brain_id: string;
  refined_at: string;
  conclusion: string;
  confidence: number;
  /** Stage 4 has no honest revisit window; left null for analyst backfill. */
  prediction_window: null;
  metadata: PredictionMetadata;
}

/** How many key_metrics to embed in metadata. The full metric list is in the
 *  rendered .md; metadata is for fast scan during backtest, not full replay. */
const MAX_METRICS_IN_METADATA = 5;

/** Build the row Stage 4 would insert. Pure function — exposed for tests. */
export function buildPredictionRow(brainOutput: BrainOutput): PredictionRow {
  return {
    brain_id: brainOutput.brain_id,
    refined_at: brainOutput.refined_at,
    conclusion: brainOutput.conclusion,
    confidence: brainOutput.confidence,
    prediction_window: null,
    metadata: {
      direction: brainOutput.direction,
      magnitude: brainOutput.magnitude,
      trust_tier: brainOutput.trust_tier,
      upstream_count: brainOutput.upstream_count,
      contradicts: brainOutput.contradicts,
      relevance_half_life_hours: brainOutput.relevance.half_life_hours,
      top_key_metrics: brainOutput.key_metrics.slice(
        0,
        MAX_METRICS_IN_METADATA,
      ),
      version: brainOutput.version,
    },
  };
}

export type LogResult =
  | { kind: "skipped"; reason: "not-master" | "no-supabase-env" }
  | { kind: "inserted"; row: PredictionRow }
  | { kind: "error"; message: string };

export interface LogPredictionOpts {
  packId: string;
  brainOutput: BrainOutput;
  /** Optional injection point for tests. */
  supabaseUrl?: string;
  supabaseKey?: string;
}

/**
 * Insert a master refine into `predictions`. Errors are surfaced as
 * `kind: "error"` rather than thrown — a refine that successfully wrote the
 * .md should not be retroactively aborted by a telemetry insert failure. The
 * caller decides whether to log/ignore/escalate.
 */
export async function logPrediction(
  opts: LogPredictionOpts,
): Promise<LogResult> {
  if (opts.packId !== MASTER_PACK_ID) {
    return { kind: "skipped", reason: "not-master" };
  }
  const url = opts.supabaseUrl ?? process.env.BRAINS_SUPABASE_URL;
  const key = opts.supabaseKey ?? process.env.BRAINS_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return { kind: "skipped", reason: "no-supabase-env" };
  }
  const row = buildPredictionRow(opts.brainOutput);
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.from("predictions").insert(row);
  if (error) {
    return { kind: "error", message: error.message };
  }
  return { kind: "inserted", row };
}
