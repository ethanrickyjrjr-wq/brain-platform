/**
 * Supabase signal adapter. Read-only, server-side only (service key never
 * reaches the client). Degrades gracefully when env is unset.
 *
 * latestDltLoads — reads data_lake._dlt_loads for dlt-pipeline freshness.
 * directTableFreshness — reads MAX(inserted_at) on non-dlt tables directly.
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

export interface DirectLoad {
  table_name: string; // "schema.table" or "table" (defaults to public)
  last_inserted: string; // ISO timestamp from MAX(inserted_at)
}

/**
 * For non-dlt pipelines that write directly via psycopg.
 * Queries MAX(inserted_at) on each specified table.
 * tableSpecs format: "public.fl_dor_sales_tax" or "fl_dor_sales_tax".
 */
export async function directTableFreshness(tableSpecs: string[]): Promise<{
  available: boolean;
  loads: DirectLoad[];
}> {
  if (!URL || !KEY || tableSpecs.length === 0)
    return { available: false, loads: [] };
  try {
    const results: DirectLoad[] = [];
    for (const spec of tableSpecs) {
      const [schema, table] = spec.includes(".")
        ? spec.split(".", 2)
        : ["public", spec];
      const sb = createClient(URL, KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        db: { schema },
      });
      const { data } = await sb
        .from(table)
        .select("inserted_at")
        .order("inserted_at", { ascending: false })
        .limit(1);
      if (data?.[0]?.inserted_at) {
        results.push({ table_name: spec, last_inserted: data[0].inserted_at });
      }
    }
    return { available: true, loads: results };
  } catch {
    return { available: false, loads: [] };
  }
}

export const supabaseMeta = { hasEnv: Boolean(URL && KEY) };
