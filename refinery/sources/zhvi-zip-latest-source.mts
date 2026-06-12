/**
 * §05 source — reads data_lake.zhvi_zip_latest (the brain-input pivot view, one
 * row per ZIP, pre-computed YoY/MoM). Replaces zhvi-source.mts's 24-month raw
 * read after GATE A ×3 cycles prove the view and the pack compute identically.
 *
 * GATE B is here: fetch throws on 0 rows in live mode (a missing GRANT or empty
 * view should be a loud failure, never a silent null-output brain).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

const SOURCE_ID = "zhvi_zip_latest";
const TTL_SECONDS = 86400 * 35;

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "__fixtures__",
  "zhvi-zip-latest.sample.json",
);

const PORTAL_URL = "https://www.zillow.com/research/data/";
const LIVE_CITATION =
  "Zillow Home Value Index (ZHVI), ZIP-level all-homes (SFR + Condo) middle-tier " +
  "(0.33-0.67) seasonally-adjusted, latest per-ZIP snapshot from " +
  "data_lake.zhvi_zip_latest (brain-input pivot view; MAX-within-±7d YoY/MoM). " +
  "Source: Zillow Research, files.zillowstatic.com.";

/** Shape of one row from data_lake.zhvi_zip_latest (mirrors ZipSnapshot in home-values-swfl). */
export interface ZhviZipLatestRow {
  zip_code: string;
  metro: string | null;
  county_name: string | null;
  city: string | null;
  /** ISO date "YYYY-MM-DD" — the latest period_end for this ZIP. */
  latest_period: string;
  /** Latest ZHVI home value (float8). */
  home_value_latest: number;
  /** 12-month YoY % — null when no partner row in ±7d window. */
  value_yoy_pct: number | null;
  /** 1-month MoM % — null when no partner row in ±7d window. */
  value_mom_pct: number | null;
}

async function fetchFromSupabase(): Promise<ZhviZipLatestRow[]> {
  const { data, error } = await getSupabase()
    .schema("data_lake")
    .from("zhvi_zip_latest")
    .select(
      "zip_code, metro, county_name, city, latest_period, home_value_latest, value_yoy_pct, value_mom_pct",
    )
    .order("zip_code");

  if (error) throw new Error(`zhvi_zip_latest fetch failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      "GATE B: data_lake.zhvi_zip_latest returned 0 rows in live mode. " +
        "Verify: (1) GRANT SELECT ON data_lake.zhvi_zip_latest TO service_role was run, " +
        "(2) NOTIFY pgrst, 'reload schema' was issued, " +
        "(3) the view has data (SELECT count(*) FROM data_lake.zhvi_zip_latest).",
    );
  }

  return data.map(
    (r): ZhviZipLatestRow => ({
      zip_code: r.zip_code as string,
      metro: (r.metro as string | null) ?? null,
      county_name: (r.county_name as string | null) ?? null,
      city: (r.city as string | null) ?? null,
      latest_period: (r.latest_period as string).slice(0, 10),
      home_value_latest: r.home_value_latest as number,
      value_yoy_pct: (r.value_yoy_pct as number | null) ?? null,
      value_mom_pct: (r.value_mom_pct as number | null) ?? null,
    }),
  );
}

async function fetchFromFixture(): Promise<ZhviZipLatestRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as ZhviZipLatestRow[];
}

export const zhviZipLatestSource: SourceConnector = {
  source_id: SOURCE_ID,
  // Trust tier 3 = private-sector industry aggregator (Zillow Research). The view
  // is Tier-2 in-lake storage, but the data provenance tier is the origin.
  trust_tier: 3,
  async fetch(): Promise<RawFragment[]> {
    const fetched_at = isoTimestamp();
    const rows = env.source === "fixture" ? await fetchFromFixture() : await fetchFromSupabase();

    return rows.map(
      (r): RawFragment<ZhviZipLatestRow> => ({
        // One fragment per ZIP (the view is latest-per-ZIP; no period_end needed in key).
        fragment_id: fragmentId(SOURCE_ID, r.zip_code),
        source_id: SOURCE_ID,
        source_trust_tier: 3,
        fetched_at,
        raw: { zip_code: r.zip_code, latest_period: r.latest_period },
        normalized: r,
      }),
    );
  },
  citationMeta(verifiedDate: string, ttlSeconds: number): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? "Zillow Home Value Index — ZHVI latest-per-ZIP (fixture: zhvi-zip-latest.sample.json)"
          : `${LIVE_CITATION} Portal: ${PORTAL_URL}.`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};

export { TTL_SECONDS as ZHVI_ZIP_LATEST_TTL_SECONDS };
