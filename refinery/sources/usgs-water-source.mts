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
 * USGS Water Services source connector.
 *
 * Live mode: queries data_lake.usgs_sites (filtered to state_cd='12') and
 * data_lake.usgs_daily (filtered to SWFL site_nos via post-fetch JS filter).
 * Two-query pattern keeps the daily IN-list bounded to ~few hundred sites
 * rather than scanning the statewide FL daily table.
 *
 * Fixture mode: reads refinery/__fixtures__/usgs-water.sample.json.
 *
 * Emits one summary fragment (kind: "hydro-swfl-aggregate") with the
 * Caloosahatchee surface-stage aggregate, consumed by env-swfl, plus
 * per-row record fragments for ledger traceability. Groundwater and
 * rainfall metrics are sourced from separate connectors (Lee County NR
 * WellMonitor and NOAA GHCN-D respectively) — not from usgs_daily.
 *
 * Spec of record: docs/API_BLUEPRINTS_USGS.md (committed bbc4a73).
 */

const SOURCE_ID = "usgs_water";
const SCHEMA = "data_lake";
const DAILY_TABLE = "usgs_daily";
const SITES_TABLE = "usgs_sites";
const API_BASE = "https://waterservices.usgs.gov/nwis";

const LEE_FIPS = "12071";
const COLLIER_FIPS = "12021";
const CALOOSAHATCHEE_HUC_PREFIX = "03090205";
const BIG_CYPRESS_HUC_PREFIX = "03090204";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "usgs-water.sample.json",
);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DailyRow {
  site_no: string;
  parameter_cd: string;
  stat_cd: string;
  obs_date: string;
  value: number | null;
  unit: string;
  datum: string;
  qualifiers: string[] | null;
  source_url: string;
  ingested_at: string;
}

export interface SiteRow {
  site_no: string;
  agency_cd: string;
  station_nm: string | null;
  site_tp_cd: string | null;
  state_cd: string | null;
  county_cd: string | null;
  huc_cd: string | null;
  latitude: number | null;
  longitude: number | null;
  coord_datum_cd: string | null;
  alt_va: number | null;
  alt_datum_cd: string | null;
  parameter_cds: string[] | null;
  site_status: string | null;
  source_url: string;
  refreshed_at: string;
}

export interface MetricWindow {
  start: string | null;
  end: string | null;
  days_covered: number;
  site_nos: string[];
}

export interface HydroSwflAggregate {
  kind: "hydro-swfl-aggregate";
  sw_stage_caloosahatchee_ft: number | null;
  sw_stage_window: MetricWindow;
}

export interface UsgsDailyRecord {
  kind: "usgs-daily-record";
  site_no: string;
  parameter_cd: string;
  obs_date: string;
  value: number | null;
  datum: string;
}

// ── SWFL filter helpers ────────────────────────────────────────────────────────

export function isSwflSite(s: Pick<SiteRow, "county_cd" | "huc_cd">): boolean {
  if (s.county_cd === LEE_FIPS || s.county_cd === COLLIER_FIPS) return true;
  if (
    s.huc_cd &&
    (s.huc_cd.startsWith(CALOOSAHATCHEE_HUC_PREFIX) ||
      s.huc_cd.startsWith(BIG_CYPRESS_HUC_PREFIX))
  ) {
    return true;
  }
  return false;
}

function isCaloosahatcheeSite(s: Pick<SiteRow, "huc_cd">): boolean {
  return !!s.huc_cd && s.huc_cd.startsWith(CALOOSAHATCHEE_HUC_PREFIX);
}

// ── Aggregator helpers ────────────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function latestObsDate(rows: DailyRow[]): string | null {
  let latest: string | null = null;
  for (const r of rows) {
    if (latest === null || r.obs_date > latest) latest = r.obs_date;
  }
  return latest;
}

export function swStageCaloosahatcheeLatest(
  daily: DailyRow[],
  sites: SiteRow[],
): { value: number | null; window: MetricWindow } {
  const caloosaSites = sites.filter(isCaloosahatcheeSite);
  const caloosaSiteNos = new Set(caloosaSites.map((s) => s.site_no));
  const rows = daily.filter(
    (r) =>
      r.parameter_cd === "00065" &&
      caloosaSiteNos.has(r.site_no) &&
      r.value !== null,
  );
  const anchor = latestObsDate(rows);
  if (!anchor) {
    return {
      value: null,
      window: { start: null, end: null, days_covered: 0, site_nos: [] },
    };
  }
  // Take median across all gages reporting on the latest available date.
  const sameDay = rows.filter((r) => r.obs_date === anchor);
  const value = median(sameDay.map((r) => r.value as number));
  const usedSites = Array.from(new Set(sameDay.map((r) => r.site_no))).sort();
  return {
    value: value === null ? null : Math.round(value * 100) / 100,
    window: {
      start: anchor,
      end: anchor,
      days_covered: 1,
      site_nos: usedSites,
    },
  };
}

// ── Aggregate builder ──────────────────────────────────────────────────────────

export function buildHydroSwflAggregate(
  daily: DailyRow[],
  sites: SiteRow[],
): HydroSwflAggregate {
  const swStage = swStageCaloosahatcheeLatest(daily, sites);
  return {
    kind: "hydro-swfl-aggregate",
    sw_stage_caloosahatchee_ft: swStage.value,
    sw_stage_window: swStage.window,
  };
}

// ── Live fetch ─────────────────────────────────────────────────────────────────

const DAILY_COLS =
  "site_no,parameter_cd,stat_cd,obs_date,value,unit,datum,qualifiers,source_url,ingested_at";
const SITE_COLS =
  "site_no,agency_cd,station_nm,site_tp_cd,state_cd,county_cd,huc_cd," +
  "latitude,longitude,coord_datum_cd,alt_va,alt_datum_cd,parameter_cds,site_status,source_url,refreshed_at";

async function fetchLive(): Promise<{ daily: DailyRow[]; sites: SiteRow[] }> {
  const sb = getSupabase().schema(SCHEMA);

  // PostgREST silently caps any single response at db-max-rows=1000. The FL
  // sites table is ~900 rows (close to the cap), so page by the unique site_no —
  // a sampled sites read would drop SWFL sites before the isSwflSite filter
  // runs, cascading into the daily read.
  const allFlSites = await selectAllPaged<SiteRow>(
    () =>
      sb
        .from(SITES_TABLE)
        .select(SITE_COLS)
        .eq("state_cd", "12") as unknown as PagedQuery<SiteRow>,
    "site_no",
  );
  const swflSites = allFlSites.filter(isSwflSite);

  if (swflSites.length === 0) {
    return { daily: [], sites: [] };
  }

  const swflSiteNos = swflSites.map((s) => s.site_no);
  // Page the daily values by the unique _dlt_id. The old single read ordered
  // obs_date desc and would silently keep only the newest 1000 readings; sort
  // desc in TS after assembling the full set to preserve the prior contract.
  const daily = await selectAllPaged<DailyRow>(
    () =>
      sb
        .from(DAILY_TABLE)
        .select(DAILY_COLS)
        .in("site_no", swflSiteNos) as unknown as PagedQuery<DailyRow>,
    "_dlt_id",
  );
  daily.sort((a, b) =>
    a.obs_date < b.obs_date ? 1 : a.obs_date > b.obs_date ? -1 : 0,
  );
  return {
    daily,
    sites: swflSites,
  };
}

// ── Fixture ────────────────────────────────────────────────────────────────────

interface FixtureShape {
  sites: SiteRow[];
  daily: DailyRow[];
}

async function loadFixture(): Promise<{ daily: DailyRow[]; sites: SiteRow[] }> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as FixtureShape;
  const swflSites = data.sites.filter(isSwflSite);
  const swflSiteNos = new Set(swflSites.map((s) => s.site_no));
  const swflDaily = data.daily.filter((r) => swflSiteNos.has(r.site_no));
  return { daily: swflDaily, sites: swflSites };
}

// ── Connector ──────────────────────────────────────────────────────────────────

export const usgsWaterSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,

  async fetch(): Promise<RawFragment[]> {
    const { daily, sites } =
      env.source === "fixture" ? await loadFixture() : await fetchLive();

    const fetched_at = isoTimestamp();
    const fragments: RawFragment[] = [];

    // Per-row records for ledger traceability. Only the summary fragment is
    // consumed by env-swfl; record fragments exist so a downstream brain or
    // an audit can replay the underlying observations.
    for (const r of daily) {
      const norm: UsgsDailyRecord = {
        kind: "usgs-daily-record",
        site_no: r.site_no,
        parameter_cd: r.parameter_cd,
        obs_date: r.obs_date,
        value: r.value,
        datum: r.datum,
      };
      fragments.push({
        fragment_id: fragmentId(
          SOURCE_ID,
          `${r.site_no}-${r.parameter_cd}-${r.obs_date}`,
        ),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: {
          site_no: r.site_no,
          parameter_cd: r.parameter_cd,
          obs_date: r.obs_date,
        },
        normalized: norm,
      });
    }

    const aggregate = buildHydroSwflAggregate(daily, sites);
    fragments.push({
      fragment_id: fragmentId(SOURCE_ID, "hydro-swfl-aggregate"),
      source_id: SOURCE_ID,
      source_trust_tier: 1,
      fetched_at,
      raw: {
        swfl_site_count: sites.length,
        daily_row_count: daily.length,
      },
      normalized: aggregate,
    });

    return fragments;
  },

  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    const isLive = env.source !== "fixture";
    return {
      source: isLive
        ? `USGS Water Services daily values via data_lake.usgs_daily + data_lake.usgs_sites (${API_BASE}/dv/?stateCd=FL&parameterCd={72019,62610,00065,00045}&statCd={00003,00006}&siteStatus=active; SWFL filter county_cd IN ('${LEE_FIPS}','${COLLIER_FIPS}') OR huc_cd LIKE '${CALOOSAHATCHEE_HUC_PREFIX}%' OR huc_cd LIKE '${BIG_CYPRESS_HUC_PREFIX}%')`
        : "USGS Water Services (fixture; usgs-water.sample.json, 57 rows across 4 parameterCds + 4 SWFL sites)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};

// ── Smoke-test entry point ─────────────────────────────────────────────────────
// Windows PowerShell: $env:REFINERY_SOURCE="fixture"; npx tsx refinery/sources/usgs-water-source.mts
// bash/zsh:           REFINERY_SOURCE=fixture npx tsx refinery/sources/usgs-water-source.mts

if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  usgsWaterSource.fetch().then((fragments) => {
    const summary = fragments.find(
      (f) =>
        (f.normalized as { kind?: string }).kind === "hydro-swfl-aggregate",
    );
    console.log(JSON.stringify(summary?.normalized ?? null, null, 2));
    console.log(`\nTotal fragments: ${fragments.length}`);
  });
}
