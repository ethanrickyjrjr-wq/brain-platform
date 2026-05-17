/**
 * FAF5 triage: faf5-source returned 0 rows for dms_dest=129 trade_type=1.
 * Determine whether (a) table is empty, (b) 129 isn't in there, (c) trade_type=1
 * isn't in there, or (d) some other shape mismatch.
 */
import { createClient } from "@supabase/supabase-js";
import { env, requireEnv } from "../config/env.mts";

requireEnv(["supabaseUrl", "supabaseKey"]);
const sb = createClient(env.supabaseUrl!, env.supabaseKey!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).schema("data_lake");

// 1) Total row count
const total = await sb
  .from("faf_flows")
  .select("dms_orig", { count: "exact", head: true });
console.log("TOTAL_ROWS:", total.count, total.error?.message ?? "");

// 2) Sample a few raw rows to see column shape
const sample = await sb.from("faf_flows").select("*").limit(3);
if (sample.error) {
  console.log("SAMPLE_ERR:", sample.error.message);
} else {
  console.log("SAMPLE_COLS:", Object.keys(sample.data?.[0] ?? {}));
  console.log("SAMPLE_FIRST:", JSON.stringify(sample.data?.[0], null, 2));
}

// 3) Distinct dms_dest values (top 25 by sample)
const dests = await sb.from("faf_flows").select("dms_dest").limit(5000);
if (dests.error) {
  console.log("DESTS_ERR:", dests.error.message);
} else {
  const uniq = new Set(dests.data?.map((r) => r.dms_dest));
  console.log("UNIQUE_DEST_COUNT (in 5k sample):", uniq.size);
  console.log("HAS_129:", uniq.has(129));
  console.log(
    "DEST_VALUES (sorted, first 25):",
    [...uniq].sort((a, b) => Number(a) - Number(b)).slice(0, 25),
  );
}

// 4) Distinct trade_type values
const tts = await sb.from("faf_flows").select("trade_type").limit(5000);
if (tts.error) {
  console.log("TT_ERR:", tts.error.message);
} else {
  const uniqTT = new Set(tts.data?.map((r) => r.trade_type));
  console.log("TRADE_TYPE_VALUES:", [...uniqTT]);
}

// 5) Specifically count dms_dest=129 (no trade_type filter)
const d129 = await sb
  .from("faf_flows")
  .select("dms_orig", { count: "exact", head: true })
  .eq("dms_dest", 129);
console.log("ROWS_WHERE_DEST_129:", d129.count, d129.error?.message ?? "");

// 6) Count dms_dest=129 AND trade_type=1
const d129t1 = await sb
  .from("faf_flows")
  .select("dms_orig", { count: "exact", head: true })
  .eq("dms_dest", 129)
  .eq("trade_type", 1);
console.log(
  "ROWS_WHERE_DEST_129_TT_1:",
  d129t1.count,
  d129t1.error?.message ?? "",
);

// 7) Lookups should be populated
const zones = await sb
  .from("faf_zone_lookup")
  .select("zone_id", { count: "exact", head: true });
console.log("ZONE_LOOKUP_ROWS:", zones.count, zones.error?.message ?? "");

const sctg = await sb
  .from("faf_sctg_lookup")
  .select("sctg_code", { count: "exact", head: true });
console.log("SCTG_LOOKUP_ROWS:", sctg.count, sctg.error?.message ?? "");
