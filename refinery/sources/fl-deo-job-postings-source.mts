import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * FL DEO / CareerSource Florida job postings source connector.
 *
 * Live mode: queries data_lake.fl_deo_job_postings (Tier-2, populated by
 * ingest/pipelines/fl_deo_job_postings/pipeline.py).  Fetches the two most
 * recent distinct weeks so the pack can compute WoW delta.
 *
 * Fixture mode: reads refinery/__fixtures__/fl-deo-job-postings.sample.json.
 *
 * Emits a single fl-deo-postings-swfl-summary fragment. Row-level fragments
 * are not emitted — the pack is a deterministic aggregator with no per-row
 * consumer today.
 */

const SOURCE_ID = "fl_deo_job_postings";
const SCHEMA = "data_lake";
const TABLE = "fl_deo_job_postings";
const CITATION_URL =
  "https://www.careersourceflorida.com/workforce-professionals/labor-market-information/";

export const LEE_FIPS = "12071";
export const COLLIER_FIPS = "12021";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "fl-deo-job-postings.sample.json",
);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DbRow {
  area_fips: string;
  county_name: string;
  naics_sector: string;
  naics_label: string | null;
  week_end_date: string;
  posting_count: number | null;
  source_url: string | null;
  _ingested_at: string | null;
}

export interface CountyWeekPostings {
  total: number;
  by_sector: Array<{ naics_sector: string; naics_label: string; posting_count: number }>;
  top_sector: string | null;
}

export interface PostingsWeekSnapshot {
  week_end_date: string;
  lee: CountyWeekPostings;
  collier: CountyWeekPostings;
}

export interface FlDeoPostingsSummary {
  kind: "fl-deo-postings-swfl-summary";
  latest: PostingsWeekSnapshot;
  prior: PostingsWeekSnapshot | null;
  lee_wow_pct: number | null;
  collier_wow_pct: number | null;
}

// ── Computation ────────────────────────────────────────────────────────────────

function buildWeekSnapshot(
  rows: DbRow[],
  fips: string,
  weekEnd: string,
): CountyWeekPostings {
  const weekRows = rows.filter(
    (r) => r.area_fips === fips && r.week_end_date === weekEnd,
  );
  const sectors = weekRows
    .filter((r) => r.posting_count != null && r.posting_count > 0)
    .sort((a, b) => (b.posting_count ?? 0) - (a.posting_count ?? 0))
    .map((r) => ({
      naics_sector: r.naics_sector,
      naics_label: r.naics_label ?? r.naics_sector,
      posting_count: r.posting_count ?? 0,
    }));
  const total = sectors.reduce((sum, s) => sum + s.posting_count, 0);
  return {
    total,
    by_sector: sectors,
    top_sector: sectors[0]?.naics_label ?? null,
  };
}

function wowPct(
  latest: number,
  prior: number | undefined,
): number | null {
  if (!prior || prior === 0) return null;
  return Math.round(((latest - prior) / prior) * 1000) / 10;
}

export function buildPostingsSummary(rows: DbRow[]): FlDeoPostingsSummary {
  const weeks = [
    ...new Set(rows.map((r) => r.week_end_date)),
  ].sort().reverse();

  const latestWeek = weeks[0] ?? null;
  const priorWeek = weeks[1] ?? null;

  if (!latestWeek) {
    return {
      kind: "fl-deo-postings-swfl-summary",
      latest: {
        week_end_date: "",
        lee: { total: 0, by_sector: [], top_sector: null },
        collier: { total: 0, by_sector: [], top_sector: null },
      },
      prior: null,
      lee_wow_pct: null,
      collier_wow_pct: null,
    };
  }

  const latest: PostingsWeekSnapshot = {
    week_end_date: latestWeek,
    lee: buildWeekSnapshot(rows, LEE_FIPS, latestWeek),
    collier: buildWeekSnapshot(rows, COLLIER_FIPS, latestWeek),
  };

  let prior: PostingsWeekSnapshot | null = null;
  if (priorWeek) {
    prior = {
      week_end_date: priorWeek,
      lee: buildWeekSnapshot(rows, LEE_FIPS, priorWeek),
      collier: buildWeekSnapshot(rows, COLLIER_FIPS, priorWeek),
    };
  }

  return {
    kind: "fl-deo-postings-swfl-summary",
    latest,
    prior,
    lee_wow_pct: prior ? wowPct(latest.lee.total, prior.lee.total) : null,
    collier_wow_pct: prior ? wowPct(latest.collier.total, prior.collier.total) : null,
  };
}

// ── Live fetch ─────────────────────────────────────────────────────────────────

const COLS =
  "area_fips,county_name,naics_sector,naics_label,week_end_date,posting_count,source_url,_ingested_at";

async function fetchLive(): Promise<DbRow[]> {
  const sb = getSupabase().schema(SCHEMA);

  // Fetch the two most recent distinct week_end_dates — enough for WoW delta.
  const weeksResp = await sb
    .from(TABLE)
    .select("week_end_date")
    .order("week_end_date", { ascending: false })
    .limit(200);

  if (weeksResp.error) {
    throw new Error(
      `fl-deo-job-postings-source: week query failed — ${weeksResp.error.message}`,
    );
  }

  const weeks = [
    ...new Set((weeksResp.data ?? []).map((r) => r.week_end_date as string)),
  ]
    .sort()
    .reverse()
    .slice(0, 2);

  if (weeks.length === 0) return [];

  const [leeResp, collierResp] = await Promise.all([
    sb
      .from(TABLE)
      .select(COLS)
      .eq("area_fips", LEE_FIPS)
      .in("week_end_date", weeks)
      .order("week_end_date", { ascending: false }),
    sb
      .from(TABLE)
      .select(COLS)
      .eq("area_fips", COLLIER_FIPS)
      .in("week_end_date", weeks)
      .order("week_end_date", { ascending: false }),
  ]);

  if (leeResp.error) {
    throw new Error(
      `fl-deo-job-postings-source: Lee query failed — ${leeResp.error.message}`,
    );
  }
  if (collierResp.error) {
    throw new Error(
      `fl-deo-job-postings-source: Collier query failed — ${collierResp.error.message}`,
    );
  }

  return [
    ...((leeResp.data ?? []) as DbRow[]),
    ...((collierResp.data ?? []) as DbRow[]),
  ];
}

// ── Fixture ────────────────────────────────────────────────────────────────────

interface FixtureShape {
  records: DbRow[];
}

async function loadFixture(): Promise<DbRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as FixtureShape;
  return data.records;
}

// ── Connector ──────────────────────────────────────────────────────────────────

export const flDeoJobPostingsSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,

  async fetch(): Promise<RawFragment[]> {
    const rows =
      env.source === "fixture" ? await loadFixture() : await fetchLive();

    const fetched_at = isoTimestamp();
    const summary = buildPostingsSummary(rows);

    return [
      {
        fragment_id: fragmentId(SOURCE_ID, "fl-deo-postings-swfl-summary"),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: {
          latest_week: summary.latest.week_end_date,
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
        ? `CareerSource Florida / FL DEO Online Job Posting Analytics via data_lake.fl_deo_job_postings (${CITATION_URL}; NAICS supersectors; Lee + Collier counties; weekly)`
        : `FL DEO job postings (fixture; fl-deo-job-postings.sample.json)`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};

// ── Smoke-test entry point ─────────────────────────────────────────────────────
// bash: REFINERY_SOURCE=fixture npx tsx refinery/sources/fl-deo-job-postings-source.mts

if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  flDeoJobPostingsSource.fetch().then((fragments) => {
    const summary = fragments.find(
      (f) =>
        (f.normalized as { kind?: string }).kind ===
        "fl-deo-postings-swfl-summary",
    );
    console.log(JSON.stringify(summary?.normalized ?? null, null, 2));
    console.log(`\nTotal fragments: ${fragments.length}`);
  });
}
