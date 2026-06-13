import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { selectAllPaged, type PagedQuery } from "../lib/paginate.mts";
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
    impacted_county_fips: ["12021", "12071", "12015", "12043", "12051", "12115"],
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

/**
 * Per-ZIP AAL constants — v1 of the env-swfl per-ZIP flood-loss restructure
 * (docs/superpowers/plans/2026-05-19-env-swfl-flood-restructure.md §A + §D).
 *
 * AAL = sum(paid B+C+ICO over the last AAL_WINDOW_YEARS calendar years) /
 *       AAL_WINDOW_YEARS / insured_denominator(zip).
 * insured_denominator(zip) = ZIP_POPULATION_2020[zip] * INSURED_PENETRATION_FACTOR.
 *
 * The 0.30 penetration factor is the NSI (National Structure Inventory) proxy
 * for NFIP coverage rate — replaced in v2 with the live OpenFEMA NFIP Policies
 * insured-property count. Population estimates are 2020 ACS rounded to the
 * nearest 1000. Unknown ZIPs fall back to SWFL_ZIP_POPULATION_DEFAULT and the
 * fragment's insured_denominator_basis surfaces "ZIP not in coverage table"
 * so downstream caveats can flag the gap.
 *
 * The barrier-island classification table in refinery/lib/swfl-geo.mts carries
 * the same population estimate for the 12 classified ZIPs; this map exists as
 * the broader SWFL coverage list specifically for AAL-denominator math (claims
 * archive ZIPs frequently sit outside the barrier-island sub-table).
 */
export const AAL_WINDOW_YEARS = 10;
export const INSURED_PENETRATION_FACTOR = 0.3;
export const SWFL_ZIP_POPULATION_DEFAULT = 25000;
export const ZIP_POPULATION_2020: ReadonlyMap<string, number> = new Map([
  // Classified by swfl-geo (12 ZIPs) — same population estimates kept in sync.
  ["33931", 7000], // Fort Myers Beach
  ["33957", 7000], // Sanibel
  ["33924", 1000], // Captiva
  ["34145", 18000], // Marco Island
  ["33921", 1000], // Boca Grande
  ["34134", 23000], // Bonita Beach
  ["34102", 17000], // Naples coastal
  ["33914", 36000], // Cape Coral SW
  ["33901", 24000], // Fort Myers downtown
  ["33990", 24000], // Cape Coral E
  ["34109", 25000], // North Naples
  ["34112", 33000], // East Naples
  // Common non-classified SWFL ZIPs appearing in the claims archive.
  ["33908", 27000], // South Fort Myers
  ["34103", 19000], // Naples
  ["33950", 18000], // Punta Gorda
  ["33952", 23000], // Port Charlotte
  ["34135", 18000], // Bonita Springs east
]);

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
  /** Current FEMA-mapped zone (OpenFEMA floodZoneCurrent); flood_zone is the rated zone. */
  flood_zone_current?: string | null;
  occupancy_type: number | null;
  number_of_floors_insured: number | null;
  amount_paid_on_building_claim: number | null;
  amount_paid_on_contents_claim: number | null;
  amount_paid_on_ico_claim: number | null;
  building_property_value: number | null;
  building_damage_amount: number | null;
}

/**
 * Date boundary splitting 2024 Helene and Milton NFIP claims.
 * Claims with date_of_loss < this value → Helene; on/after → Milton.
 *
 * SOURCE: NHC Tropical Cyclone Advisory Archive.
 *   Milton  landfall: 2024-10-09 (Siesta Key FL ~11 PM EDT)
 *     https://www.nhc.noaa.gov/archive/2024/al14/al142024.discus.032.shtml
 *   Helene  landfall: 2024-09-26 (Big Bend FL ~11 PM EDT) — SWFL surge impact
 *     https://www.nhc.noaa.gov/archive/2024/al09/al092024.discus.024.shtml
 *
 * Any claim with date_of_loss on or after 2024-10-09 is attributed to Milton;
 * any 2024 claim before that date is attributed to Helene. Claims with null
 * date_of_loss in 2024 are excluded from per-storm attribution.
 */
export const HELENE_MILTON_SPLIT_DATE = "2024-10-09";

/**
 * Per-named-storm SWFL paid total — one fragment per entry in SWFL_STORM_YEARS.
 * For 2024, Helene and Milton are split by date_of_loss at HELENE_MILTON_SPLIT_DATE.
 * Claims with null date_of_loss in a multi-storm year are excluded from per-storm
 * attribution (they are counted in the combined swfl_storm_year_claims_usd metric).
 */
export interface NfipStormTotal {
  kind: "nfip-storm-total";
  storm_name: string;
  year: number;
  landfall_date: string;
  paid_total_usd: number;
  claim_count: number;
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

/**
 * Per-ZIP NFIP aggregate — carries the v1 inputs the env-swfl pack needs to
 * emit per-ZIP flood-loss metrics (AAL$, percentile rank, denominator basis,
 * median building property value for the insurance-vs-NOI ratio). Top-6
 * highest-AAL SWFL ZIPs only — `aggregateZipRollupTop6` ranks across all SWFL
 * ZIPs with ≥1 claim in window, then truncates.
 *
 * Barrier-island classification and cap-rate basis-point translation live in
 * refinery/lib/swfl-geo.mts; the pack joins them at render time. This fragment
 * stays free of geographic interpretation so the source can be unit-tested
 * without dragging in the static SWFL geography table.
 */
export interface NfipZipAggregate {
  kind: "nfip-zip-aggregate";
  zip: string;
  county_code: string;
  county_name: string;
  /** sum(paid_total in window) / window_years / insured_denominator. USD/yr. */
  aal_usd_per_insured_property: number;
  /** Percentile rank (0-100, linear method) across all SWFL ZIPs with ≥1 claim
   *  in window. 100 = highest-AAL ZIP; 0 = lowest. */
  aal_pct_swfl_rank: number;
  /** Median of building_property_value across this ZIP's in-window claims.
   *  Feeds the insurance-as-pct-of-NOI calculation downstream. */
  median_building_property_value_usd: number;
  claim_count_in_window: number;
  window_years: number;
  window_end_year: number;
  insured_denominator: number;
  insured_denominator_basis: string;
  /** Total paid (B+C+ICO) in window, pre-AAL math. Carried for traceability. */
  paid_total_in_window_usd: number;
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
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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
  out.sort((a, b) => a.county_code.localeCompare(b.county_code) || a.year - b.year);
  return out;
}

/** Compute the 4 SWFL-rollup metrics from the per-county-year aggregates. */
function aggregateSwflRollup(buckets: NfipCountyYear[]): NfipSwflAggregate | null {
  if (buckets.length === 0) return null;

  // Yearly SWFL-wide totals.
  const yearlyTotals = new Map<number, number>();
  for (const b of buckets) {
    yearlyTotals.set(b.year, (yearlyTotals.get(b.year) ?? 0) + b.paid_total_usd);
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
  const latest_complete_year_total_usd = yearlyTotals.get(latest_complete_year) ?? 0;
  const post_ian_ratio =
    baseline_annual_usd > 0 ? latest_complete_year_total_usd / baseline_annual_usd : 0;

  return {
    kind: "nfip-swfl-aggregate",
    storm_year_total_usd: Math.round(storm_year_total_usd * 100) / 100,
    baseline_annual_usd: Math.round(baseline_annual_usd * 100) / 100,
    storm_year_count_since_2000,
    post_ian_ratio: Math.round(post_ian_ratio * 1000) / 1000,
    latest_complete_year,
    latest_complete_year_total_usd: Math.round(latest_complete_year_total_usd * 100) / 100,
    storm_year_list_reviewed_at: SWFL_STORM_YEARS_LAST_REVIEWED,
    county_codes: SWFL_FIPS,
  };
}

/**
 * Compute per-named-storm SWFL paid totals from raw claim rows.
 * Returns one NfipStormTotal per entry in SWFL_STORM_YEARS (6 total).
 * For 2024 (Helene + Milton), splits by date_of_loss at HELENE_MILTON_SPLIT_DATE;
 * claims with null date_of_loss in 2024 are excluded from per-storm attribution.
 */
function aggregateStormTotals(rows: ClaimRow[]): NfipStormTotal[] {
  // Group storm-year claims by calendar year
  const byYear = new Map<number, ClaimRow[]>();
  for (const r of rows) {
    if (r.year_of_loss == null) continue;
    if (!r.county_code || !SWFL_FIPS.includes(r.county_code)) continue;
    if (!STORM_YEAR_SET.has(r.year_of_loss)) continue;
    const arr = byYear.get(r.year_of_loss) ?? [];
    arr.push(r);
    byYear.set(r.year_of_loss, arr);
  }

  const out: NfipStormTotal[] = [];
  for (const storm of SWFL_STORM_YEARS) {
    const yearRows = byYear.get(storm.year) ?? [];

    let stormRows: ClaimRow[];
    if (storm.year === 2024) {
      if (storm.name === "Helene") {
        stormRows = yearRows.filter(
          (r) => r.date_of_loss != null && r.date_of_loss < HELENE_MILTON_SPLIT_DATE,
        );
      } else {
        // Milton: on or after the split date
        stormRows = yearRows.filter(
          (r) => r.date_of_loss != null && r.date_of_loss >= HELENE_MILTON_SPLIT_DATE,
        );
      }
    } else {
      stormRows = yearRows;
    }

    out.push({
      kind: "nfip-storm-total",
      storm_name: storm.name,
      year: storm.year,
      landfall_date: storm.landfall_date,
      paid_total_usd: Math.round(stormRows.reduce((s, r) => s + paidTotal(r), 0) * 100) / 100,
      claim_count: stormRows.length,
    });
  }

  return out;
}

/**
 * Group rows into per-ZIP buckets, rank by per-insured-property AAL across all
 * SWFL ZIPs with ≥1 claim in window, and return the top N (default 6) with
 * pre-computed percentile rank.
 *
 * Why top-6 specifically: env-swfl emits 5 metrics per ZIP (AAL$, percentile
 * rank, barrier-score, cap-rate bps, insurance-pct-NOI). At top-6 that's 30
 * key_metric slots — comfortably under spec-validator's per-brain ceiling once
 * the existing SWFL-wide aggregates and hydro reading are summed in.
 *
 * Why we rank across the full distribution but emit only the top N: the
 * percentile-rank metric ONLY makes sense relative to the full SWFL ZIP set
 * (with ≥1 claim in window). If we ranked only inside the top-6, every
 * fragment would carry rank ∈ {100, 80, 60, 40, 20, 0} regardless of real
 * distribution. Plan §A is explicit: "Percentile rank across all SWFL ZIPs
 * with ≥1 claim in window."
 *
 * Rows excluded silently: non-SWFL county_code, null/non-5-digit
 * reported_zipcode, year_of_loss outside [max_year - AAL_WINDOW_YEARS + 1,
 * max_year]. These are not error conditions — they're rows that don't belong
 * to the per-ZIP SWFL AAL math.
 */
export function aggregateZipRollupTop6(rows: ClaimRow[], topN: number = 6): NfipZipAggregate[] {
  // Determine the window from the data itself: end = max year present, span
  // = AAL_WINDOW_YEARS. This is preferable to wall-clock now() because the
  // fixture and the live archive both end at the last completed reporting
  // year, not the calling timestamp.
  let maxYear = 0;
  for (const r of rows) {
    if (r.year_of_loss != null && r.year_of_loss > maxYear) {
      maxYear = r.year_of_loss;
    }
  }
  if (maxYear === 0) return [];
  const minYear = maxYear - AAL_WINDOW_YEARS + 1;

  // Bucket eligible rows by ZIP.
  const byZip = new Map<string, ClaimRow[]>();
  for (const r of rows) {
    if (!r.county_code || !SWFL_FIPS.includes(r.county_code)) continue;
    if (r.year_of_loss == null || r.year_of_loss < minYear || r.year_of_loss > maxYear) {
      continue;
    }
    if (!r.reported_zipcode || !/^\d{5}$/.test(r.reported_zipcode)) continue;
    const arr = byZip.get(r.reported_zipcode) ?? [];
    arr.push(r);
    byZip.set(r.reported_zipcode, arr);
  }
  if (byZip.size === 0) return [];

  interface ZipRaw {
    zip: string;
    county_code: string;
    paid_total: number;
    claim_count: number;
    median_bv: number;
    insured_denominator: number;
    insured_denominator_basis: string;
    aal: number;
  }
  const raw: ZipRaw[] = [];
  for (const [zip, bucket] of byZip) {
    const paid = bucket.reduce((s, r) => s + paidTotal(r), 0);
    const bvs = bucket.map((r) => toNum(r.building_property_value)).filter((v) => v > 0);
    const medianBV = median(bvs);
    const known = ZIP_POPULATION_2020.has(zip);
    const pop = ZIP_POPULATION_2020.get(zip) ?? SWFL_ZIP_POPULATION_DEFAULT;
    const denom = pop * INSURED_PENETRATION_FACTOR;
    const aal = paid / AAL_WINDOW_YEARS / denom;
    const county_code = bucket[0].county_code as string;
    raw.push({
      zip,
      county_code,
      paid_total: paid,
      claim_count: bucket.length,
      median_bv: Math.round(medianBV * 100) / 100,
      insured_denominator: Math.round(denom * 100) / 100,
      insured_denominator_basis: known
        ? `2020 ACS population estimate ${pop.toLocaleString()} × ${INSURED_PENETRATION_FACTOR} NSI proxy (v1)`
        : `SWFL median population estimate ${SWFL_ZIP_POPULATION_DEFAULT.toLocaleString()} × ${INSURED_PENETRATION_FACTOR} NSI proxy (v1; ZIP not in coverage table)`,
      aal: Math.round(aal * 100) / 100,
    });
  }

  // Descending by AAL — top of list = highest per-insured-property loss.
  raw.sort((a, b) => b.aal - a.aal);
  const n = raw.length;

  const out: NfipZipAggregate[] = [];
  const take = Math.min(topN, n);
  for (let i = 0; i < take; i++) {
    const r = raw[i];
    // Linear percentile rank: top (i=0) = 100; bottom (i=n-1) = 0.
    // For n=1 the rank is undefined under the linear method — define it as
    // 100 (single ZIP is by construction the highest).
    const pct = n === 1 ? 100 : Math.round(((n - 1 - i) / (n - 1)) * 10000) / 100;
    out.push({
      kind: "nfip-zip-aggregate",
      zip: r.zip,
      county_code: r.county_code,
      county_name: COUNTY_NAME_BY_FIPS.get(r.county_code) ?? r.county_code,
      aal_usd_per_insured_property: r.aal,
      aal_pct_swfl_rank: pct,
      median_building_property_value_usd: r.median_bv,
      claim_count_in_window: r.claim_count,
      window_years: AAL_WINDOW_YEARS,
      window_end_year: maxYear,
      insured_denominator: r.insured_denominator,
      insured_denominator_basis: r.insured_denominator_basis,
      paid_total_in_window_usd: Math.round(r.paid_total * 100) / 100,
    });
  }
  return out;
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

const FEMA_CLAIM_COLUMNS =
  "id,year_of_loss,date_of_loss,state,county_code,reported_city,reported_zipcode,flood_zone,flood_zone_current,occupancy_type,number_of_floors_insured,amount_paid_on_building_claim,amount_paid_on_contents_claim,amount_paid_on_ico_claim,building_property_value,building_damage_amount";

async function fetchLive(): Promise<FixtureShape> {
  const sb = getSupabase().schema(SCHEMA);
  // Page via selectAllPaged ordered by the unique `id`: PostgREST silently caps
  // any single response at db-max-rows=1000, so the full SWFL archive (~86.6k
  // claims) only assembles by paging. Small per-page bodies also avoid the GHA
  // runner's large-response socket reset (SESSION_LOG 2026-06-01).
  const claims = await selectAllPaged<ClaimRow>(
    () =>
      sb
        .from(TABLE)
        .select(FEMA_CLAIM_COLUMNS)
        .eq("state", "FL")
        .in("county_code", SWFL_FIPS) as unknown as PagedQuery<ClaimRow>,
    "id",
    // Row-floor guard (issue #61): the SWFL archive held 86,574 claims (probed
    // live 2026-06-03). 50k is above the 1000 db-max-rows cap and below real
    // volume — catches the exact truncation that once read FMB AAL as $264/yr
    // instead of $30,074/yr. Complements assertClaimsNonEmpty (the 0-row guard).
    { minRows: 50_000 },
  );
  assertClaimsNonEmpty(claims);
  return { claims };
}

export const femaNfipSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,
  async fetch(): Promise<RawFragment[]> {
    const data = env.source === "fixture" ? await loadFixture() : await fetchLive();
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

    const zipRollup = aggregateZipRollupTop6(data.claims);
    for (const zipAgg of zipRollup) {
      fragments.push({
        fragment_id: fragmentId(SOURCE_ID, `zip-${zipAgg.zip}`),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: {
          zip: zipAgg.zip,
          county_code: zipAgg.county_code,
          claim_count_in_window: zipAgg.claim_count_in_window,
          window_end_year: zipAgg.window_end_year,
        },
        normalized: zipAgg,
      });
    }

    const stormTotals = aggregateStormTotals(data.claims);
    for (const st of stormTotals) {
      fragments.push({
        fragment_id: fragmentId(SOURCE_ID, `storm-${st.storm_name.toLowerCase()}-${st.year}`),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: {
          storm_name: st.storm_name,
          year: st.year,
          paid_total_usd: st.paid_total_usd,
          claim_count: st.claim_count,
        },
        normalized: st,
      });
    }

    return fragments;
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    const liveUrl =
      env.source === "live" && env.supabaseUrl
        ? `${env.supabaseUrl}/rest/v1/${TABLE}?select=id,year_of_loss,date_of_loss,state,county_code,reported_city,reported_zipcode,flood_zone,flood_zone_current,occupancy_type,number_of_floors_insured,amount_paid_on_building_claim,amount_paid_on_contents_claim,amount_paid_on_ico_claim,building_property_value,building_damage_amount&state=eq.FL&county_code=in.(${SWFL_FIPS.join(",")})`
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
