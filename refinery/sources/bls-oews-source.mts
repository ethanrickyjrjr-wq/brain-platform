import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * BLS OEWS SWFL source connector.
 *
 * Live mode: queries data_lake.bls_oews_swfl (Tier-2, populated by
 * ingest/pipelines/bls_oews_swfl/pipeline.py). Fetches the two most recent
 * ref_years so the pack can compute YoY delta.
 *
 * Fixture mode: reads refinery/__fixtures__/bls-oews.sample.json.
 *
 * Data: BLS Occupational Employment and Wage Statistics (OEWS), May survey.
 * MSAs: Cape Coral-Fort Myers (15980 / Lee Co.) + Naples-Marco Island (34940 / Collier Co.)
 * Granularity: major SOC occupation groups (O_GROUP='major'), annual.
 */

const SOURCE_ID = "bls_oews_swfl";
const SCHEMA = "data_lake";
const TABLE = "bls_oews_swfl";
const CITATION_URL = "https://www.bls.gov/oes/tables.htm";

export const CAPE_CORAL_MSA = "15980";
export const NAPLES_MSA = "34940";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "bls-oews.sample.json",
);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OewsDbRow {
  area_code: string;
  area_name: string;
  occ_code: string;
  occ_title: string;
  o_group: string;
  tot_emp: number | null;
  jobs_1000: number | null;
  loc_quotient: number | null;
  h_median: number | null;
  a_median: number | null;
  ref_year: number;
  source_url: string | null;
  _ingested_at: string | null;
}

export interface OewsOccGroup {
  occ_code: string;
  occ_title: string;
  tot_emp: number | null;
  jobs_1000: number | null;
  loc_quotient: number | null;
  h_median: number | null;
  a_median: number | null;
}

export interface OewsMsaSnapshot {
  area_code: string;
  area_name: string;
  ref_year: number;
  total_employment: number;
  top_groups: OewsOccGroup[]; // sorted by tot_emp desc, all major groups
  construction_loc_q: number | null; // 47-0000 loc_quotient
  healthcare_employment: number | null; // 29-0000 + 31-0000 combined tot_emp
  construction_median_wage: number | null; // 47-0000 h_median
}

export interface BlsOewsSummary {
  kind: "bls-oews-swfl-summary";
  ref_year: number;
  cape_coral: OewsMsaSnapshot; // Lee County
  naples: OewsMsaSnapshot; // Collier County
  prior_cape_coral: OewsMsaSnapshot | null;
  prior_naples: OewsMsaSnapshot | null;
  cape_coral_employment_yoy_pct: number | null;
  naples_employment_yoy_pct: number | null;
}

// ── Computation ────────────────────────────────────────────────────────────────

function buildMsaSnapshot(
  rows: OewsDbRow[],
  areaCode: string,
  refYear: number,
): OewsMsaSnapshot {
  const msaRows = rows.filter(
    (r) => r.area_code === areaCode && r.ref_year === refYear,
  );
  const area_name = msaRows[0]?.area_name ?? areaCode;

  const top_groups: OewsOccGroup[] = msaRows
    .filter((r) => r.tot_emp != null)
    .sort((a, b) => (b.tot_emp ?? 0) - (a.tot_emp ?? 0))
    .map((r) => ({
      occ_code: r.occ_code,
      occ_title: r.occ_title,
      tot_emp: r.tot_emp,
      jobs_1000: r.jobs_1000,
      loc_quotient: r.loc_quotient,
      h_median: r.h_median,
      a_median: r.a_median,
    }));

  const total_employment = msaRows.reduce(
    (sum, r) => sum + (r.tot_emp ?? 0),
    0,
  );

  const construction = msaRows.find((r) => r.occ_code === "47-0000");
  const healthcarePract = msaRows.find((r) => r.occ_code === "29-0000");
  const healthcareSupp = msaRows.find((r) => r.occ_code === "31-0000");

  const hcEmp =
    (healthcarePract?.tot_emp ?? 0) + (healthcareSupp?.tot_emp ?? 0) || null;

  return {
    area_code: areaCode,
    area_name,
    ref_year: refYear,
    total_employment,
    top_groups,
    construction_loc_q: construction?.loc_quotient ?? null,
    healthcare_employment: hcEmp,
    construction_median_wage: construction?.h_median ?? null,
  };
}

function yoyPct(latest: number, prior: number | undefined): number | null {
  if (!prior || prior === 0) return null;
  return Math.round(((latest - prior) / prior) * 1000) / 10;
}

export function buildOewsSummary(rows: OewsDbRow[]): BlsOewsSummary {
  const years = [...new Set(rows.map((r) => r.ref_year))].sort().reverse();
  const latestYear = years[0] ?? 0;
  const priorYear = years[1] ?? null;

  const cape_coral = buildMsaSnapshot(rows, CAPE_CORAL_MSA, latestYear);
  const naples = buildMsaSnapshot(rows, NAPLES_MSA, latestYear);

  const prior_cape_coral = priorYear
    ? buildMsaSnapshot(rows, CAPE_CORAL_MSA, priorYear)
    : null;
  const prior_naples = priorYear
    ? buildMsaSnapshot(rows, NAPLES_MSA, priorYear)
    : null;

  return {
    kind: "bls-oews-swfl-summary",
    ref_year: latestYear,
    cape_coral,
    naples,
    prior_cape_coral,
    prior_naples,
    cape_coral_employment_yoy_pct: prior_cape_coral
      ? yoyPct(cape_coral.total_employment, prior_cape_coral.total_employment)
      : null,
    naples_employment_yoy_pct: prior_naples
      ? yoyPct(naples.total_employment, prior_naples.total_employment)
      : null,
  };
}

// ── Live fetch ─────────────────────────────────────────────────────────────────

const COLS =
  "area_code,area_name,occ_code,occ_title,o_group,tot_emp,jobs_1000,loc_quotient,h_median,a_median,ref_year,source_url,_ingested_at";

async function fetchLive(): Promise<OewsDbRow[]> {
  const sb = getSupabase().schema(SCHEMA);

  // Get the two most recent ref_years present in the table.
  const yearsResp = await sb
    .from(TABLE)
    .select("ref_year")
    .order("ref_year", { ascending: false })
    .limit(200);

  if (yearsResp.error) {
    throw new Error(
      `bls-oews-source: ref_year query failed — ${yearsResp.error.message}`,
    );
  }

  const years = [
    ...new Set((yearsResp.data ?? []).map((r) => r.ref_year as number)),
  ]
    .sort()
    .reverse()
    .slice(0, 2);

  if (years.length === 0) return [];

  const resp = await sb
    .from(TABLE)
    .select(COLS)
    .in("area_code", [CAPE_CORAL_MSA, NAPLES_MSA])
    .in("ref_year", years)
    .eq("o_group", "major")
    .order("ref_year", { ascending: false });

  if (resp.error) {
    throw new Error(
      `bls-oews-source: data query failed — ${resp.error.message}`,
    );
  }

  return (resp.data ?? []) as OewsDbRow[];
}

// ── Fixture ────────────────────────────────────────────────────────────────────

interface FixtureShape {
  records: OewsDbRow[];
}

async function loadFixture(): Promise<OewsDbRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as FixtureShape;
  return data.records;
}

// ── Connector ──────────────────────────────────────────────────────────────────

export const blsOewsSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,

  async fetch(): Promise<RawFragment[]> {
    const rows =
      env.source === "fixture" ? await loadFixture() : await fetchLive();

    const fetched_at = isoTimestamp();
    const summary = buildOewsSummary(rows);

    return [
      {
        fragment_id: fragmentId(SOURCE_ID, "bls-oews-swfl-summary"),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: {
          ref_year: summary.ref_year,
          row_count: rows.length,
        },
        normalized: summary,
      },
    ];
  },

  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    const isLive = env.source !== "fixture";
    return {
      source: isLive
        ? `BLS Occupational Employment and Wage Statistics (OEWS), May survey — Cape Coral-Fort Myers MSA (Lee Co.) + Naples-Marco Island MSA (Collier Co.) via data_lake.bls_oews_swfl (${CITATION_URL}; major SOC groups; annual)`
        : `BLS OEWS SWFL (fixture; bls-oews.sample.json)`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};

// ── Smoke-test entry point ─────────────────────────────────────────────────────
// bash: REFINERY_SOURCE=fixture npx tsx refinery/sources/bls-oews-source.mts

if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  blsOewsSource.fetch().then((fragments) => {
    const summary = fragments.find(
      (f) =>
        (f.normalized as { kind?: string }).kind === "bls-oews-swfl-summary",
    );
    console.log(JSON.stringify(summary?.normalized ?? null, null, 2));
    console.log(`\nTotal fragments: ${fragments.length}`);
  });
}
