import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * fema-nfip source connector — Southwest Florida NFIP paid-claim history,
 * Tier 2 mirror of OpenFEMA FimaNfipClaims (data_lake.fema_nfip_claims).
 *
 * COMPLEMENT to env-swfl-source.mts:
 *   env-swfl-source = modeled flood exposure (NFHL polygons, structural risk)
 *   fema-nfip       = realized flood loss (paid policyholder claims)
 * Same brain (env-swfl) reads both — modeled risk + realized loss in one OUTPUT.
 *
 * Trust tier: 1 (federal authoritative — OpenFEMA is the official NFIP archive).
 *
 * METRIC FRAMING — storm-vs-baseline, NOT rolling windows. SWFL NFIP claims
 * concentrate in a handful of named hurricane years (Charley 2004, Wilma 2005,
 * Irma 2017, Ian 2022, Helene 2024, Milton 2024). Rolling means would average
 * Ian's signal across decades of background noise and lose the structure that
 * matters operationally. The hardcoded SWFL_STORM_YEARS list below carries a
 * LAST_REVIEWED date; update it when a new named storm hits SWFL.
 *
 * The connector aggregates upstream of the brain so the brain's outputProducer
 * stays a thin reader. One fragment per (county, year) bucket PLUS one
 * SWFL-rollup fragment carrying the 4 brain metrics directly.
 *
 * SWFL scope (matches env-swfl-source.mts SWFL_COUNTIES): 6 counties keyed by
 * 5-char FIPS. The brain reads the base table directly, not the convenience
 * view at docs/sql/fema_nfip_claims_swfl.sql.
 *
 * Coverage caveat surfaced on every render: NFIP claims are policyholder-only.
 * Uninsured losses and properties not covered by NFIP are NOT in this archive.
 * True SWFL flood loss is larger than what these numbers show.
 */

const SOURCE_ID = "fema_nfip_claims";
const SCHEMA = "data_lake";
const TABLE = "fema_nfip_claims";

/**
 * 6 SWFL counties. Order matches env-swfl-source.mts SWFL_COUNTIES.
 * Mirrors the same county set the brain has used for modeled-risk metrics.
 */
const SWFL_COUNTIES: ReadonlyArray<{ fips: string; name: string }> = [
  { fips: "12071", name: "Lee" },
  { fips: "12021", name: "Collier" },
  { fips: "12015", name: "Charlotte" },
  { fips: "12043", name: "Glades" },
  { fips: "12051", name: "Hendry" },
  { fips: "12115", name: "Sarasota" },
];

const SWFL_FIPS = SWFL_COUNTIES.map((c) => c.fips);
const COUNTY_NAME_BY_FIPS = new Map(SWFL_COUNTIES.map((c) => [c.fips, c.name]));

/**
 * Named SWFL-impacting hurricanes — the storm-year list.
 * LAST_REVIEWED: 2026-05-17. Update this constant AND bump LAST_REVIEWED when a
 * new storm landfalls in or pushes water into the 6-county SWFL footprint.
 * Auto-detection (rolling-median outlier) is fragile for N=5; explicit named
 * storms with a reviewed-by date is more defensible.
 */
export const SWFL_STORM_YEARS_LAST_REVIEWED = "2026-05-17";
export interface SwflStorm {
  year: number;
  name: string;
  landfall_date: string;
  impacted_county_fips: ReadonlyArray<string>;
}
export const SWFL_STORM_YEARS: ReadonlyArray<SwflStorm> = [
  {
    year: 2004,
    name: "Charley",
    landfall_date: "2004-08-13",
    impacted_county_fips: ["12015", "12071"],
  },
  {
    year: 2005,
    name: "Wilma",
    landfall_date: "2005-10-24",
    impacted_county_fips: ["12021", "12071"],
  },
  {
    year: 2017,
    name: "Irma",
    landfall_date: "2017-09-10",
    impacted_county_fips: [
      "12021",
      "12071",
      "12015",
      "12043",
      "12051",
      "12115",
    ],
  },
  {
    year: 2022,
    name: "Ian",
    landfall_date: "2022-09-28",
    impacted_county_fips: ["12071", "12021", "12015"],
  },
  {
    year: 2024,
    name: "Helene",
    landfall_date: "2024-09-26",
    impacted_county_fips: ["12115", "12015"],
  },
  {
    year: 2024,
    name: "Milton",
    landfall_date: "2024-10-09",
    impacted_county_fips: ["12115", "12015", "12071", "12021"],
  },
];

const STORM_YEAR_SET = new Set(SWFL_STORM_YEARS.map((s) => s.year));
const STORM_NAME_BY_YEAR = new Map<number, string>();
for (const s of SWFL_STORM_YEARS) {
  const existing = STORM_NAME_BY_YEAR.get(s.year);
  STORM_NAME_BY_YEAR.set(s.year, existing ? `${existing}+${s.name}` : s.name);
}

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "fema-nfip-swfl.sample.json",
);

/** Raw row shape as it lands from data_lake.fema_nfip_claims (Tier 2 columns). */
interface ClaimRow {
  id: string;
  year_of_loss: number | null;
  date_of_loss: string | null;
  state: string | null;
  county_code: string | null;
  reported_city: string | null;
  reported_zipcode: string | null;
  flood_zone: string | null;
  occupancy_type: number | null;
  number_of_floors_insured: number | null;
  amount_paid_on_building_claim: number | null;
  amount_paid_on_contents_claim: number | null;
  amount_paid_on_ico_claim: number | null;
  building_property_value: number | null;
  building_damage_amount: number | null;
}

/** Per-(county, year) bucket — one fragment per bucket. */
export interface NfipCountyYear {
  kind: "nfip-county-year";
  county_code: string;
  county_name: string;
  year: number;
  is_storm_year: boolean;
  storm_name: string | null;
  /** Sum of (building + contents + ICO) paid claims in USD. */
  paid_total_usd: number;
  /** Number of claim rows contributing to this bucket. */
  claim_count: number;
}

/** SWFL-rollup fragment — carries the 4 env-swfl brain metrics directly. */
export interface NfipSwflAggregate {
  kind: "nfip-swfl-aggregate";
  /** Sum of paid (building + contents + ICO) across all 6 SWFL counties in named storm years. */
  storm_year_total_usd: number;
  /** Median of annual SWFL-wide paid totals, restricted to non-storm years. The "boring-times floor." */
  baseline_annual_usd: number;
  /** Count of SWFL_STORM_YEARS with year >= 2000. */
  storm_year_count_since_2000: number;
  /** Most recent complete year's SWFL total ÷ baseline_annual_usd. >1 = elevated. */
  post_ian_ratio: number;
  /** The year used for post_ian_ratio numerator — max(year_of_loss) in the data. */
  latest_complete_year: number;
  /** Total paid (B+C+ICO) for latest_complete_year across SWFL. */
  latest_complete_year_total_usd: number;
  /** LAST_REVIEWED date for the storm-year list (caveat plumbing). */
  storm_year_list_reviewed_at: string;
  /** The 6 SWFL FIPS the aggregate covers. */
  county_codes: ReadonlyArray<string>;
}

interface FixtureShape {
  claims: ClaimRow[];
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function paidTotal(row: ClaimRow): number {
  return (
    toNum(row.amount_paid_on_building_claim) +
    toNum(row.amount_paid_on_contents_claim) +
    toNum(row.amount_paid_on_ico_claim)
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Group rows into (county_code, year) buckets and emit per-bucket aggregates. */
function aggregateCountyYears(rows: ClaimRow[]): NfipCountyYear[] {
  const buckets = new Map<string, ClaimRow[]>();
  for (const r of rows) {
    if (!r.county_code || r.year_of_loss == null) continue;
    if (!SWFL_FIPS.includes(r.county_code)) continue;
    const key = `${r.county_code}::${r.year_of_loss}`;
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }
  const out: NfipCountyYear[] = [];
  for (const [key, bucket] of buckets) {
    const [county_code, yearStr] = key.split("::");
    const year = Number(yearStr);
    const total = bucket.reduce((s, r) => s + paidTotal(r), 0);
    out.push({
      kind: "nfip-county-year",
      county_code,
      county_name: COUNTY_NAME_BY_FIPS.get(county_code) ?? county_code,
      year,
      is_storm_year: STORM_YEAR_SET.has(year),
      storm_name: STORM_NAME_BY_YEAR.get(year) ?? null,
      paid_total_usd: Math.round(total * 100) / 100,
      claim_count: bucket.length,
    });
  }
  // Stable ordering: county fips, then year asc.
  out.sort(
    (a, b) => a.county_code.localeCompare(b.county_code) || a.year - b.year,
  );
  return out;
}

/** Compute the 4 SWFL-rollup metrics from the per-county-year aggregates. */
function aggregateSwflRollup(
  buckets: NfipCountyYear[],
): NfipSwflAggregate | null {
  if (buckets.length === 0) return null;

  // Yearly SWFL-wide totals.
  const yearlyTotals = new Map<number, number>();
  for (const b of buckets) {
    yearlyTotals.set(
      b.year,
      (yearlyTotals.get(b.year) ?? 0) + b.paid_total_usd,
    );
  }

  // Storm-year total = sum of paid across all named storm years.
  let storm_year_total_usd = 0;
  for (const year of STORM_YEAR_SET) {
    storm_year_total_usd += yearlyTotals.get(year) ?? 0;
  }

  // Baseline = median of yearly SWFL totals, EXCLUDING storm years.
  const nonStormYearTotals: number[] = [];
  for (const [year, total] of yearlyTotals) {
    if (!STORM_YEAR_SET.has(year)) nonStormYearTotals.push(total);
  }
  const baseline_annual_usd = median(nonStormYearTotals);

  // Storm-year count since 2000.
  let storm_year_count_since_2000 = 0;
  for (const year of STORM_YEAR_SET) {
    if (year >= 2000) storm_year_count_since_2000 += 1;
  }

  // Latest complete year = max year present in the data.
  let latest_complete_year = 0;
  for (const year of yearlyTotals.keys()) {
    if (year > latest_complete_year) latest_complete_year = year;
  }
  const latest_complete_year_total_usd =
    yearlyTotals.get(latest_complete_year) ?? 0;
  const post_ian_ratio =
    baseline_annual_usd > 0
      ? latest_complete_year_total_usd / baseline_annual_usd
      : 0;

  return {
    kind: "nfip-swfl-aggregate",
    storm_year_total_usd: Math.round(storm_year_total_usd * 100) / 100,
    baseline_annual_usd: Math.round(baseline_annual_usd * 100) / 100,
    storm_year_count_since_2000,
    post_ian_ratio: Math.round(post_ian_ratio * 1000) / 1000,
    latest_complete_year,
    latest_complete_year_total_usd:
      Math.round(latest_complete_year_total_usd * 100) / 100,
    storm_year_list_reviewed_at: SWFL_STORM_YEARS_LAST_REVIEWED,
    county_codes: SWFL_FIPS,
  };
}

async function loadFixture(): Promise<FixtureShape> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as FixtureShape;
}

/**
 * Throws a helpful error when the live query returns no rows. Same pattern as
 * fdot-source.mts:208-214 — silent zero produces a brain that looks correct
 * but is hollow. Names BOTH the pipeline command and the grant SQL because in
 * practice 0 rows almost always means one of those two steps was skipped.
 */
export function assertClaimsNonEmpty(rows: ClaimRow[]): void {
  if (rows.length > 0) return;
  throw new Error(
    `fema-nfip-source: ${SCHEMA}.${TABLE} returned 0 rows for state=FL county_code in (${SWFL_FIPS.join(",")}). ` +
      "Confirm the dlt pipeline ran (python -m ingest.pipelines.fema.pipeline) and that docs/sql/fema_nfip_claims_grant.sql was applied (service_role needs SELECT on data_lake.fema_nfip_claims).",
  );
}

async function fetchLive(): Promise<FixtureShape> {
  const sb = getSupabase().schema(SCHEMA);
  const resp = await sb
    .from(TABLE)
    .select(
      "id,year_of_loss,date_of_loss,state,county_code,reported_city,reported_zipcode,flood_zone,occupancy_type,number_of_floors_insured,amount_paid_on_building_claim,amount_paid_on_contents_claim,amount_paid_on_ico_claim,building_property_value,building_damage_amount",
    )
    .eq("state", "FL")
    .in("county_code", SWFL_FIPS)
    .limit(500000);
  if (resp.error) {
    throw new Error(
      `fema-nfip-source: ${SCHEMA}.${TABLE} query failed — ${resp.error.message}`,
    );
  }
  const claims = (resp.data ?? []) as ClaimRow[];
  assertClaimsNonEmpty(claims);
  return { claims };
}

export const femaNfipSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,
  async fetch(): Promise<RawFragment[]> {
    const data =
      env.source === "fixture" ? await loadFixture() : await fetchLive();
    const fetched_at = isoTimestamp();

    const countyYears = aggregateCountyYears(data.claims);
    const fragments: RawFragment[] = [];

    for (const agg of countyYears) {
      fragments.push({
        fragment_id: fragmentId(SOURCE_ID, `${agg.county_code}-${agg.year}`),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: {
          county_code: agg.county_code,
          year: agg.year,
          claim_count: agg.claim_count,
        },
        normalized: agg,
      });
    }

    const rollup = aggregateSwflRollup(countyYears);
    if (rollup) {
      fragments.push({
        fragment_id: fragmentId(SOURCE_ID, "swfl-aggregate"),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: {
          storm_year_count: rollup.storm_year_count_since_2000,
          latest_year: rollup.latest_complete_year,
        },
        normalized: rollup,
      });
    }

    return fragments;
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    const liveUrl =
      env.source === "live" && env.supabaseUrl
        ? `${env.supabaseUrl}/rest/v1/${TABLE}?select=id,year_of_loss,date_of_loss,state,county_code,reported_city,reported_zipcode,flood_zone,occupancy_type,number_of_floors_insured,amount_paid_on_building_claim,amount_paid_on_contents_claim,amount_paid_on_ico_claim,building_property_value,building_damage_amount&state=eq.FL&county_code=in.(${SWFL_FIPS.join(",")})`
        : `fixture://refinery/__fixtures__/fema-nfip-swfl.sample.json`;
    return {
      source:
        env.source === "fixture"
          ? `OpenFEMA FimaNfipClaims (fixture; ${SCHEMA}.${TABLE}, FL state, 6 SWFL counties ${SWFL_FIPS.join("+")}, storm-list reviewed ${SWFL_STORM_YEARS_LAST_REVIEWED}) — ${liveUrl}`
          : `OpenFEMA FimaNfipClaims via ${SCHEMA}.${TABLE} (dlt-ingested from https://www.fema.gov/api/open/v2/FimaNfipClaims; FL state, 6 SWFL counties ${SWFL_FIPS.join("+")}, full archive, storm-list reviewed ${SWFL_STORM_YEARS_LAST_REVIEWED}) — ${liveUrl}`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
