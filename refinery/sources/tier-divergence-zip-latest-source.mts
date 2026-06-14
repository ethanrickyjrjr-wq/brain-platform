/**
 * tier-divergence-swfl source — reads data_lake.tier_divergence_zip_latest (the
 * brain-input view, ONE row per both-tier SWFL ZIP, pre-computed spread + YoY).
 * Mirrors zhvi-zip-latest-source.mts: per-ZIP math lives in the SQL view; the pack
 * only does the regional rollup.
 *
 * GATE B is here: fetch throws on 0 rows in live mode, and on a partial view below
 * MIN_VIEW_ROWS — a missing GRANT or thin view must fail loud, never a silent
 * null-output brain.
 *
 * VENDOR CAVEAT: the Zillow top/bottom ZHVI tiers are RAW (no _sm_sa variant
 * exists). The divergence read leans on YoY, which cancels seasonality.
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
import { assertViewRowFloor } from "../lib/view-row-floor.mts";

const SOURCE_ID = "tier_divergence_zip_latest";
const TTL_SECONDS = 86400 * 35;

// GATE B partial-view floor. Probe 2026-06-14: 107 of 109 SWFL ZIPs carry BOTH
// tiers (the divergence universe). Floor = 85 (~80% of 107) — well above normal
// month-to-month ZIP churn, so it trips only on a genuinely partial view.
const MIN_VIEW_ROWS = 85;

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "__fixtures__",
  "tier-divergence-zip-latest.sample.json",
);

const PORTAL_URL = "https://www.zillow.com/research/data/";
const LIVE_CITATION =
  "Zillow Home Value Index (ZHVI) tier split, ZIP-level all-homes (SFR + Condo): " +
  "top-tier (0.67-1.0, luxury) vs bottom-tier (0.0-0.33, starter), RAW (not " +
  "seasonally adjusted; no _sm_sa tier variant is published). Latest per-ZIP " +
  "spread + YoY from data_lake.tier_divergence_zip_latest (brain-input view; " +
  "MAX-within-±7d YoY). Source: Zillow Research, files.zillowstatic.com.";

/** Shape of one row from data_lake.tier_divergence_zip_latest (one per both-tier ZIP). */
export interface TierDivergenceZipLatestRow {
  zip_code: string;
  metro: string | null;
  county_name: string | null;
  city: string | null;
  /** ISO date "YYYY-MM-DD" — the latest period_end where BOTH tiers are present. */
  latest_period: string;
  /** Latest top-tier (luxury) ZHVI value (float8). */
  top_tier_value_latest: number;
  /** Latest bottom-tier (starter) ZHVI value (float8). */
  bottom_tier_value_latest: number;
  /** 3-month trailing avg of the top tier (smoothed LEVEL input). */
  top_tier_value_3m_avg: number;
  /** 3-month trailing avg of the bottom tier (smoothed LEVEL input). */
  bottom_tier_value_3m_avg: number;
  /** 3m-avg top / 3m-avg bottom — the SMOOTHED spread level (×). */
  tier_spread_ratio: number;
  /** 12-month YoY % of the spread ratio — null when no partner row in ±7d window. */
  tier_spread_yoy_pct: number | null;
  /** 12-month YoY % of the bottom (starter) tier — null when no ±7d partner. */
  bottom_tier_yoy_pct: number | null;
  /** 12-month YoY % of the top (luxury) tier — null when no ±7d partner. */
  top_tier_yoy_pct: number | null;
  /** Top-tier YoY % as of 1 month prior (T-1mo vs T-13mo, same ±7d window). Used for K-shape MoM direction. Null when either anchor absent. */
  top_tier_yoy_prior_month_pct: number | null;
  /** Bottom-tier YoY % as of 1 month prior (T-1mo vs T-13mo, same ±7d window). Used for K-shape MoM direction. Null when either anchor absent. */
  bottom_tier_yoy_prior_month_pct: number | null;
}

async function fetchFromSupabase(): Promise<TierDivergenceZipLatestRow[]> {
  const { data, error } = await getSupabase()
    .schema("data_lake")
    .from("tier_divergence_zip_latest")
    .select(
      "zip_code, metro, county_name, city, latest_period, top_tier_value_latest, bottom_tier_value_latest, top_tier_value_3m_avg, bottom_tier_value_3m_avg, tier_spread_ratio, tier_spread_yoy_pct, bottom_tier_yoy_pct, top_tier_yoy_pct, top_tier_yoy_prior_month_pct, bottom_tier_yoy_prior_month_pct",
    )
    .order("zip_code");

  if (error) throw new Error(`tier_divergence_zip_latest fetch failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      "GATE B: data_lake.tier_divergence_zip_latest returned 0 rows in live mode. " +
        "Verify: (1) GRANT SELECT ON data_lake.tier_divergence_zip_latest TO service_role was run, " +
        "(2) NOTIFY pgrst, 'reload schema' was issued, " +
        "(3) the view has data (SELECT count(*) FROM data_lake.tier_divergence_zip_latest).",
    );
  }
  // GATE B (partial view): grant works + rows returned, but fewer than the SWFL
  // both-tier ZIP universe → loud deterministic abort, not a silent partial median.
  assertViewRowFloor(SOURCE_ID, data.length, MIN_VIEW_ROWS);

  return data.map(
    (r): TierDivergenceZipLatestRow => ({
      zip_code: r.zip_code as string,
      metro: (r.metro as string | null) ?? null,
      county_name: (r.county_name as string | null) ?? null,
      city: (r.city as string | null) ?? null,
      latest_period: (r.latest_period as string).slice(0, 10),
      top_tier_value_latest: r.top_tier_value_latest as number,
      bottom_tier_value_latest: r.bottom_tier_value_latest as number,
      top_tier_value_3m_avg: r.top_tier_value_3m_avg as number,
      bottom_tier_value_3m_avg: r.bottom_tier_value_3m_avg as number,
      tier_spread_ratio: r.tier_spread_ratio as number,
      tier_spread_yoy_pct: (r.tier_spread_yoy_pct as number | null) ?? null,
      bottom_tier_yoy_pct: (r.bottom_tier_yoy_pct as number | null) ?? null,
      top_tier_yoy_pct: (r.top_tier_yoy_pct as number | null) ?? null,
    }),
  );
}

async function fetchFromFixture(): Promise<TierDivergenceZipLatestRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as TierDivergenceZipLatestRow[];
}

export const tierDivergenceZipLatestSource: SourceConnector = {
  source_id: SOURCE_ID,
  // Trust tier 3 = private-sector industry aggregator (Zillow Research). The view
  // is Tier-2 in-lake storage, but the data provenance tier is the origin.
  trust_tier: 3,
  async fetch(): Promise<RawFragment[]> {
    const fetched_at = isoTimestamp();
    const rows = env.source === "fixture" ? await fetchFromFixture() : await fetchFromSupabase();

    return rows.map(
      (r): RawFragment<TierDivergenceZipLatestRow> => ({
        // One fragment per ZIP (the view is latest-per-ZIP; no period_end in the key).
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
          ? "Zillow ZHVI tier split — top vs bottom latest-per-ZIP (fixture: tier-divergence-zip-latest.sample.json)"
          : `${LIVE_CITATION} Portal: ${PORTAL_URL}.`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};

export { TTL_SECONDS as TIER_DIVERGENCE_ZIP_LATEST_TTL_SECONDS };
