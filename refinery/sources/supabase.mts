import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, requireEnv } from "../config/env.mts";

let cached: SupabaseClient | null = null;

/**
 * Read-only Supabase client for premise-engine's database (tssgulkyczfefucmrtda).
 * The Refinery never writes — no insert/update/upsert anywhere in refinery/.
 * Only called in live mode; fixture mode never touches the network.
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  requireEnv(["supabaseUrl", "supabaseKey"]);
  cached = createClient(env.supabaseUrl as string, env.supabaseKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
