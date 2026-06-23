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
const AGG_VIEW = "census_cbp_fl_agg_by_naics";

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
  // Aggregate view: sector-level NAICS only (~20 rows) with SUM already pushed
  // to SQL — replaces the old 43k-row paged fetch + TS map-reduce.
  const { data, error } = await sb
    .from(AGG_VIEW)
    .select("naics_code,naics_label,year,fl_establishments,fl_employment,fl_annual_payroll");
  if (error) throw new Error(`census_cbp: aggregate view query failed — ${error.message}`);
  if (!data || data.length === 0)
    throw new Error(
      `census_cbp: ${SCHEMA}.${AGG_VIEW} returned 0 rows — confirm view was created and GRANT SELECT applied (docs/sql/20260623_census_cbp_fl_agg_by_naics_view.sql).`,
    );
  return (data as CbpRow[]).map((r) => ({
    ...r,
    fl_establishments: Number(r.fl_establishments) || 0,
    fl_employment: Number(r.fl_employment) || 0,
    fl_annual_payroll: Number(r.fl_annual_payroll) || 0,
    year: Number(r.year),
  }));
}

export const macroFloridaCbpSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,
  async fetch(): Promise<RawFragment[]> {
    const sectors = env.source === "fixture" ? await loadFixture() : await fetchLive();
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
        ? `Census CBP FL (fixture; ${SCHEMA}.census_cbp_fl sector-level aggregation) — fixture://refinery/__fixtures__/macro-florida-cbp.sample.json`
        : `Census CBP FL via ${SCHEMA}.${AGG_VIEW} (sector-level NAICS, all FL counties summed in SQL from ${SCHEMA}.census_cbp_fl; Census Bureau CBP API) — ${env.supabaseUrl ?? "supabase"}/rest/v1/${AGG_VIEW}`;
    return {
      source: src,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
