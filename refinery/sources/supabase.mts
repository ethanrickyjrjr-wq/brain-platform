import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, requireEnv } from "../config/env.mts";

let cached: SupabaseClient | null = null;
let premiseCached: SupabaseClient | null = null;

/**
 * Brains Supabase client (jtkdowmrjaxfvwmemxso) — all live source reads go here.
 *
 * The Refinery used to be read-only. Two telemetry/state writebacks have
 * since landed (both append-only, both tolerant of failure, both fired from
 * Stage 4 AFTER the .md is written + validated):
 *   1. `lib/predictions-log.mts::logPrediction` — inserts into
 *      `public.predictions` on master refines (roadmap §6.1.4).
 *   2. `sources/fdot-freight-source.mts::writeShockLogRow` — inserts into
 *      `data_lake.fdot_freight_nowcast_shock_log` on nowcast refines
 *      (Lane 2D.1; closes the reader/writer loop for the brain's rolling
 *      baseline). FIRST refinery write against `data_lake.*`.
 *
 * Both writers build their own ephemeral clients (so test injection works
 * without monkeying with this cache); the cached client below is still the
 * canonical READ client for every source connector. Only called in live
 * mode; fixture mode never touches the network.
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  requireEnv(["supabaseUrl", "supabaseKey"]);
  cached = createClient(env.supabaseUrl as string, env.supabaseKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/**
 * Premise Engine Supabase client (tssgulkyczfefucmrtda) — transition-period only.
 * Used exclusively by the migration script; remove once all tables are on Brains.
 */
export function getPremiseSupabase(): SupabaseClient {
  if (premiseCached) return premiseCached;
  requireEnv(["premiseSupabaseUrl", "premiseSupabaseKey"]);
  premiseCached = createClient(
    env.premiseSupabaseUrl as string,
    env.premiseSupabaseKey as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return premiseCached;
}
