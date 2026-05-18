import { readFileSync } from "node:fs";

const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
for (const l of lines) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const url = process.env.BRAINS_SUPABASE_URL!;
const key = process.env.BRAINS_SUPABASE_SERVICE_KEY!;
if (!url || !key) {
  console.error("missing creds");
  process.exit(1);
}

const probes: Array<{ schema: string; table: string }> = [
  { schema: "data_lake", table: "fhfa_hpi" },
  { schema: "data_lake", table: "usgs_daily" },
  { schema: "data_lake", table: "usgs_sites" },
  { schema: "data_lake", table: "bls_qcew" },
  { schema: "data_lake", table: "fdot_aadt_fl" },
  { schema: "data_lake", table: "fdot_aadt_swfl_yearly" },
  { schema: "data_lake", table: "fema_nfip_claims" },
  { schema: "data_lake", table: "fema_nfip_claims_swfl" },
  { schema: "data_lake", table: "leepa_parcels" },
  { schema: "data_lake", table: "leepa_parcels_lee_lastsales" },
  { schema: "data_lake", table: "leepa_parcels_lee_homestead_gap" },
  { schema: "data_lake", table: "leepa_parcels_sales_yearly" },
  { schema: "data_lake", table: "leepa_parcels_homestead_gap" },
  { schema: "data_lake", table: "leepa_parcels_summary" },
  { schema: "data_lake", table: "fema_nfip" },
  { schema: "data_lake", table: "nfip_claims" },
  { schema: "data_lake", table: "fema_nfip_swfl_aggregate" },
  { schema: "data_lake", table: "fema_nfip_claims_yearly_county" },
  { schema: "data_lake", table: "faf_flows" },
  { schema: "data_lake", table: "faf_zone_lookup" },
  { schema: "data_lake", table: "faf_sctg_lookup" },
  { schema: "data_lake", table: "census_cbp" },
  { schema: "data_lake", table: "census_cbp_fl" },
];

for (const p of probes) {
  try {
    const r = await fetch(`${url}/rest/v1/${p.table}?select=*&limit=0`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Accept-Profile": p.schema,
        Prefer: "count=exact",
      },
    });
    const cr = r.headers.get("content-range") ?? "";
    const status = String(r.status);
    if (status === "200" || status === "206") {
      const total = cr.split("/")[1] ?? "?";
      console.log(`OK    ${p.schema}.${p.table.padEnd(34)} rows=${total}`);
    } else {
      let body = "";
      try {
        body = (await r.text()).slice(0, 120).replace(/\s+/g, " ");
      } catch {}
      console.log(
        `${status.padEnd(4)} ${p.schema}.${p.table.padEnd(34)} ${body}`,
      );
    }
  } catch (e) {
    console.log(`ERR  ${p.schema}.${p.table} ${(e as Error).message}`);
  }
}
