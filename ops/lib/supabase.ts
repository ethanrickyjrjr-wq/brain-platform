/**
 * Supabase signal adapter. Read-only, server-side only (service key never
 * reaches the client). Degrades gracefully when env is unset.
 *
 * Reads data_lake._dlt_loads to get the latest successful load per schema —
 * the tier-2 pipeline freshness signal.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

export interface DltLoad {
  schema_name: string;
  last_loaded: string; // ISO timestamp
}

export async function latestDltLoads(): Promise<{
  available: boolean;
  loads: DltLoad[];
}> {
  if (!URL || !KEY) return { available: false, loads: [] };
  try {
    const sb = createClient(URL, KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "data_lake" },
    });
    // _dlt_loads: one row per load; status 0 = success.
    const { data, error } = await sb
      .from("_dlt_loads")
      .select("schema_name, inserted_at, status")
      .eq("status", 0)
      .order("inserted_at", { ascending: false })
      .limit(2000);
    if (error || !data) return { available: false, loads: [] };
    const bySchema = new Map<string, string>();
    for (const row of data as Array<{
      schema_name: string;
      inserted_at: string;
    }>) {
      if (!bySchema.has(row.schema_name)) {
        bySchema.set(row.schema_name, row.inserted_at);
      }
    }
    return {
      available: true,
      loads: [...bySchema.entries()].map(([schema_name, last_loaded]) => ({
        schema_name,
        last_loaded,
      })),
    };
  } catch {
    return { available: false, loads: [] };
  }
}

export const supabaseMeta = { hasEnv: Boolean(URL && KEY) };
