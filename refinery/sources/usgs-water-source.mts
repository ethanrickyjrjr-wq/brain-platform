import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
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
 * Emits one summary fragment (kind: "hydro-swfl-aggregate") consumed by
 * env-swfl, plus per-row record fragments for ledger traceability.
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

const HIGHWATER_THRESHOLD_FT = 2.0;
const GW_MEDIAN_WINDOW_DAYS = 90;
const GW_HIGHWATER_WINDOW_DAYS = 365;

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
  // env_gw_level_lee_median_ft — parameter 62610, Lee County, last 90 days
  gw_lee_median_ft: number | null;
  gw_lee_window: MetricWindow;
  // env_sw_stage_caloosahatchee_ft — parameter 00065, Caloosahatchee HUC, latest
  sw_stage_caloosahatchee_ft: number | null;
  sw_stage_window: MetricWindow;
  // env_rainfall_swfl_annual_in — parameter 00045, SWFL avg across stations, latest complete year
  rainfall_swfl_annual_in: number | null;
  rainfall_year: number | null;
  rainfall_window: MetricWindow;
  // env_gw_highwater_exceedance_days — parameter 62610, Lee County, >2ft NAVD88, last 365 days
  gw_highwater_days: number | null;
  gw_highwater_total_days_in_window: number | null;
  gw_highwater_window: MetricWindow;
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

function isLeeSite(s: Pick<SiteRow, "county_cd">): boolean {
  return s.county_cd === LEE_FIPS;
}

function isCaloosahatcheeSite(s: Pick<SiteRow, "huc_cd">): boolean {
  return !!s.huc_cd && s.huc_cd.startsWith(CALOOSAHATCHEE_HUC_PREFIX);
}

// ── Aggregator helpers (exported for testability) ──────────────────────────────

function daysBetween(start: string, end: string): number {
  const ms = Date.parse(end) - Date.parse(start);
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

function addDays(date: string, delta: number): string {
  const d = new Date(Date.parse(date));
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

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

export function medianGwLeeLast90Days(
  daily: DailyRow[],
  sites: SiteRow[],
): { value: number | null; window: MetricWindow } {
  const leeSites = sites.filter(isLeeSite);
  const leeSiteNos = new Set(leeSites.map((s) => s.site_no));
  const rows = daily.filter(
    (r) =>
      r.parameter_cd === "62610" &&
      leeSiteNos.has(r.site_no) &&
      r.value !== null,
  );
  const anchor = latestObsDate(rows);
  if (!anchor) {
    return {
      value: null,
      window: { start: null, end: null, days_covered: 0, site_nos: [] },
    };
  }
  const windowStart = addDays(anchor, -GW_MEDIAN_WINDOW_DAYS);
  const inWindow = rows.filter((r) => r.obs_date >= windowStart);
  const value = median(inWindow.map((r) => r.value as number));
  const usedSites = Array.from(new Set(inWindow.map((r) => r.site_no))).sort();
  return {
    value: value === null ? null : Math.round(value * 100) / 100,
    window: {
      start: windowStart,
      end: anchor,
      days_covered: daysBetween(windowStart, anchor),
      site_nos: usedSites,
    },
  };
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

export function annualRainfallSwfl(
  daily: DailyRow[],
  sites: SiteRow[],
): { value: number | null; year: number | null; window: MetricWindow } {
  const swflSites = sites.filter(isSwflSite);
  const swflSiteNos = new Set(swflSites.map((s) => s.site_no));
  const rows = daily.filter(
    (r) =>
      r.parameter_cd === "00045" &&
      swflSiteNos.has(r.site_no) &&
      r.value !== null,
  );
  if (rows.length === 0) {
    return {
      value: null,
      year: null,
      window: { start: null, end: null, days_covered: 0, site_nos: [] },
    };
  }

  // Group by (site, year) and sum; pick the latest year that has at least
  // 10 monthly samples per station (heuristic for "complete year").
  const byYearSite = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const year = Number(r.obs_date.slice(0, 4));
    const key = `${year}|${r.site_no}`;
    const e = byYearSite.get(key) ?? { total: 0, count: 0 };
    e.total += r.value as number;
    e.count += 1;
    byYearSite.set(key, e);
  }

  // Per-year, average across stations that had >=10 monthly samples.
  const perYear = new Map<number, number[]>();
  for (const [key, agg] of byYearSite) {
    if (agg.count < 10) continue;
    const year = Number(key.split("|")[0]);
    const arr = perYear.get(year) ?? [];
    arr.push(agg.total);
    perYear.set(year, arr);
  }

  if (perYear.size === 0) {
    return {
      value: null,
      year: null,
      window: { start: null, end: null, days_covered: 0, site_nos: [] },
    };
  }
  const latestYear = Math.max(...perYear.keys());
  const stationTotals = perYear.get(latestYear) as number[];
  const swflAvg =
    stationTotals.reduce((s, v) => s + v, 0) / stationTotals.length;

  const yearRows = rows.filter((r) => r.obs_date.startsWith(`${latestYear}-`));
  const usedSites = Array.from(new Set(yearRows.map((r) => r.site_no))).sort();
  return {
    value: Math.round(swflAvg * 100) / 100,
    year: latestYear,
    window: {
      start: `${latestYear}-01-01`,
      end: `${latestYear}-12-31`,
      days_covered: 365,
      site_nos: usedSites,
    },
  };
}

export function gwHighwaterDaysLeeYear(
  daily: DailyRow[],
  sites: SiteRow[],
): {
  exceedance_days: number | null;
  total_days_in_window: number | null;
  window: MetricWindow;
} {
  const leeSites = sites.filter(isLeeSite);
  const leeSiteNos = new Set(leeSites.map((s) => s.site_no));
  const rows = daily.filter(
    (r) =>
      r.parameter_cd === "62610" &&
      leeSiteNos.has(r.site_no) &&
      r.value !== null,
  );
  const anchor = latestObsDate(rows);
  if (!anchor) {
    return {
      exceedance_days: null,
      total_days_in_window: null,
      window: { start: null, end: null, days_covered: 0, site_nos: [] },
    };
  }
  const windowStart = addDays(anchor, -GW_HIGHWATER_WINDOW_DAYS);
  const inWindow = rows.filter((r) => r.obs_date >= windowStart);
  // De-dupe per-day across multiple Lee wells: a day is "exceedance" if ANY
  // Lee well exceeded the threshold that day.
  const exceedDates = new Set(
    inWindow
      .filter((r) => (r.value as number) > HIGHWATER_THRESHOLD_FT)
      .map((r) => r.obs_date),
  );
  const allDates = new Set(inWindow.map((r) => r.obs_date));
  const usedSites = Array.from(new Set(inWindow.map((r) => r.site_no))).sort();
  return {
    exceedance_days: exceedDates.size,
    total_days_in_window: allDates.size,
    window: {
      start: windowStart,
      end: anchor,
      days_covered: daysBetween(windowStart, anchor),
      site_nos: usedSites,
    },
  };
}

// ── Aggregate builder ──────────────────────────────────────────────────────────

export function buildHydroSwflAggregate(
  daily: DailyRow[],
  sites: SiteRow[],
): HydroSwflAggregate {
  const gwMedian = medianGwLeeLast90Days(daily, sites);
  const swStage = swStageCaloosahatcheeLatest(daily, sites);
  const rain = annualRainfallSwfl(daily, sites);
  const exceedance = gwHighwaterDaysLeeYear(daily, sites);
  return {
    kind: "hydro-swfl-aggregate",
    gw_lee_median_ft: gwMedian.value,
    gw_lee_window: gwMedian.window,
    sw_stage_caloosahatchee_ft: swStage.value,
    sw_stage_window: swStage.window,
    rainfall_swfl_annual_in: rain.value,
    rainfall_year: rain.year,
    rainfall_window: rain.window,
    gw_highwater_days: exceedance.exceedance_days,
    gw_highwater_total_days_in_window: exceedance.total_days_in_window,
    gw_highwater_window: exceedance.window,
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

  const sitesResp = await sb
    .from(SITES_TABLE)
    .select(SITE_COLS)
    .eq("state_cd", "12");
  if (sitesResp.error) {
    throw new Error(
      `usgs-water-source: sites query failed — ${sitesResp.error.message}`,
    );
  }
  const allFlSites = (sitesResp.data ?? []) as SiteRow[];
  const swflSites = allFlSites.filter(isSwflSite);

  if (swflSites.length === 0) {
    return { daily: [], sites: [] };
  }

  const swflSiteNos = swflSites.map((s) => s.site_no);
  const dailyResp = await sb
    .from(DAILY_TABLE)
    .select(DAILY_COLS)
    .in("site_no", swflSiteNos)
    .order("obs_date", { ascending: false });
  if (dailyResp.error) {
    throw new Error(
      `usgs-water-source: daily query failed — ${dailyResp.error.message}`,
    );
  }
  return {
    daily: (dailyResp.data ?? []) as DailyRow[],
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
