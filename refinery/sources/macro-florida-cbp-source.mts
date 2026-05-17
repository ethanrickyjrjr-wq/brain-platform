import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

const SOURCE_ID = "census_cbp_fl";
const SCHEMA = "data_lake";
const TABLE = "census_cbp_fl";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "macro-florida-cbp.sample.json",
);

export interface MacroFloridaCbpNormalized {
  kind: "fl-cbp-aggregate";
  naics_code: string;
  naics_label: string;
  fl_establishments: number;
  fl_employment: number;
  fl_annual_payroll: number;
  year: number;
}

interface CbpRow {
  naics_code: string;
  naics_label: string;
  fl_establishments: number;
  fl_employment: number;
  fl_annual_payroll: number;
  year: number;
}

interface FixtureShape {
  sectors: CbpRow[];
}

async function loadFixture(): Promise<CbpRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return (JSON.parse(raw) as FixtureShape).sectors;
}

async function fetchLive(): Promise<CbpRow[]> {
  const sb = getSupabase().schema(SCHEMA);

  // Step 1: find latest year
  const { data: yearData, error: yearErr } = await sb
    .from(TABLE)
    .select("year")
    .eq("fips_state", "12")
    .order("year", { ascending: false })
    .limit(1)
    .single();
  if (yearErr)
    throw new Error(`census_cbp: max-year query failed — ${yearErr.message}`);
  const maxYear = (yearData as { year: number }).year;

  // Step 2: fetch all FL rows for that year
  const { data, error } = await sb
    .from(TABLE)
    .select(
      "naics_code,naics_label,establishment_count,employment,annual_payroll,year",
    )
    .eq("fips_state", "12")
    .eq("year", maxYear);
  if (error)
    throw new Error(`census_cbp: data query failed — ${error.message}`);

  // Step 3: aggregate by naics_code in TS (sum across all FL counties)
  const byNaics = new Map<string, CbpRow>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const key = String(row["naics_code"] ?? "");
    const existing = byNaics.get(key);
    const estab = Number(row["establishment_count"]) || 0;
    const emp = Number(row["employment"]) || 0;
    const pay = Number(row["annual_payroll"]) || 0;
    if (existing) {
      existing.fl_establishments += estab;
      existing.fl_employment += emp;
      existing.fl_annual_payroll += pay;
    } else {
      byNaics.set(key, {
        naics_code: key,
        naics_label: String(row["naics_label"] ?? ""),
        fl_establishments: estab,
        fl_employment: emp,
        fl_annual_payroll: pay,
        year: maxYear,
      });
    }
  }

  return Array.from(byNaics.values()).sort(
    (a, b) => b.fl_establishments - a.fl_establishments,
  );
}

export const macroFloridaCbpSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,
  async fetch(): Promise<RawFragment[]> {
    const sectors =
      env.source === "fixture" ? await loadFixture() : await fetchLive();
    const fetched_at = isoTimestamp();
    return sectors.map(
      (s): RawFragment<MacroFloridaCbpNormalized> => ({
        fragment_id: fragmentId(SOURCE_ID, `${s.naics_code}-${s.year}`),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: s as unknown as Record<string, unknown>,
        normalized: { kind: "fl-cbp-aggregate", ...s },
      }),
    );
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    const src =
      env.source === "fixture"
        ? `Census CBP FL (fixture; ${SCHEMA}.${TABLE} county aggregation) — fixture://refinery/__fixtures__/macro-florida-cbp.sample.json`
        : `Census CBP FL via ${SCHEMA}.${TABLE} (dlt-ingested from Census Bureau CBP API, all FL counties aggregated) — ${env.supabaseUrl ?? "supabase"}/rest/v1/${TABLE}`;
    return {
      source: src,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
