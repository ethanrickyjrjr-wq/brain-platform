import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client that bypasses RLS via the service-role key.
 *
 * Use for writes from API routes against tables whose RLS policies grant
 * INSERT/UPDATE to `service_role` (e.g. `public.waitlist` — see
 * `docs/sql/20260523_waitlist.sql`). Never import from client components or
 * code that ships to the browser; the key would leak.
 *
 * Env vars: `BRAINS_SUPABASE_URL` + `BRAINS_SUPABASE_SERVICE_KEY` (same pair
 * the refinery uses; see `refinery/config/env.mts:76-77` and `.env.example`).
 *
 * Throws at call time (not module load) when env is missing so dev/build
 * environments without the key still boot.
 */
export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.BRAINS_SUPABASE_URL;
  const key = process.env.BRAINS_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "createServiceRoleClient: BRAINS_SUPABASE_URL and BRAINS_SUPABASE_SERVICE_KEY must be set",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
