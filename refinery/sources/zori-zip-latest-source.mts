/**
 * §05 source — reads data_lake.zori_zip_latest (the brain-input pivot view, one
 * row per ZIP, pre-computed YoY/MoM). Replaces zori-source.mts's 24-month raw
 * read after GATE A ×3 cycles prove the view and the pack compute identically.
 *
 * GATE B is here: fetch throws on 0 rows in live mode (a missing GRANT or empty
 * view should be a loud failure, never a silent null-output brain).
 *
 * Column names follow the ZORI ZipSnapshot shape in rentals-swfl.mts:
 *   rent_index_latest / rent_yoy_pct / rent_mom_pct
 * (NOT ZHVI's home_value_latest / value_yoy_pct / value_mom_pct).
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

const SOURCE_ID = "zori_zip_latest";
const TTL_SECONDS = 86400 * 35;

// GATE B partial-view floor (check: zhvi_zori_gate_b_minrows). Live ZORI coverage is
// 94 SWFL ZIPs (confirmed against data_lake.zori_zip_latest 2026-06-13) — sparser than
// ZHVI (109), as ZORI only covers ZIPs with enough rental signal. Floor = floor(94 *
// 0.85) = 79 (the <95-count rule): a ~16% margin, far above normal month-to-month ZIP
// churn, so it trips only on a genuinely partial / half-refreshed view.
const MIN_VIEW_ROWS = 79;

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "__fixtures__",
  "zori-zip-latest.sample.json",
);

const PORTAL_URL = "https://www.zillow.com/research/data/";
const LIVE_CITATION =
  "Zillow Observed Rent Index (ZORI), ZIP-level monthly composite, all-homes " +
  "(SFR + Condo + Multifamily), latest per-ZIP snapshot from " +
  "data_lake.zori_zip_latest (brain-input pivot view; MAX-within-±7d YoY/MoM; " +
  "rent_index cast float8 — byte-identical to the PostgREST-served JS double). " +
  "Source: Zillow Research, files.zillowstatic.com.";

/** Shape of one row from data_lake.zori_zip_latest (mirrors ZipSnapshot in rentals-swfl). */
export interface ZoriZipLatestRow {
  zip_code: string;
  metro: string | null;
  county_name: string | null;
  city: string | null;
  /** ISO date "YYYY-MM-DD" — the latest period_end for this ZIP. */
  latest_period: string;
  /** Latest ZORI rent index (float8; cast from numeric). */
  rent_index_latest: number;
  /** 12-month YoY % — null when no partner row in ±7d window. */
  rent_yoy_pct: number | null;
  /** 1-month MoM % — null when no partner row in ±7d window. */
  rent_mom_pct: number | null;
}

async function fetchFromSupabase(): Promise<ZoriZipLatestRow[]> {
  const { data, error } = await getSupabase()
    .schema("data_lake")
    .from("zori_zip_latest")
    .select(
      "zip_code, metro, county_name, city, latest_period, rent_index_latest, rent_yoy_pct, rent_mom_pct",
    )
    .order("zip_code");

  if (error) throw new Error(`zori_zip_latest fetch failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      "GATE B: data_lake.zori_zip_latest returned 0 rows in live mode. " +
        "Verify: (1) GRANT SELECT ON data_lake.zori_zip_latest TO service_role was run, " +
        "(2) NOTIFY pgrst, 'reload schema' was issued, " +
        "(3) the view has data (SELECT count(*) FROM data_lake.zori_zip_latest).",
    );
  }
  // GATE B (partial view): grant works + rows returned, but fewer than the SWFL ZIP
  // universe → loud deterministic abort, not a silent partial-coverage median.
  assertViewRowFloor(SOURCE_ID, data.length, MIN_VIEW_ROWS);

  return data.map(
    (r): ZoriZipLatestRow => ({
      zip_code: r.zip_code as string,
      metro: (r.metro as string | null) ?? null,
      county_name: (r.county_name as string | null) ?? null,
      city: (r.city as string | null) ?? null,
      latest_period: (r.latest_period as string).slice(0, 10),
      rent_index_latest: r.rent_index_latest as number,
      rent_yoy_pct: (r.rent_yoy_pct as number | null) ?? null,
      rent_mom_pct: (r.rent_mom_pct as number | null) ?? null,
    }),
  );
}

async function fetchFromFixture(): Promise<ZoriZipLatestRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as ZoriZipLatestRow[];
}

export const zoriZipLatestSource: SourceConnector = {
  source_id: SOURCE_ID,
  // Trust tier 3 = private-sector industry aggregator (Zillow Research). The view
  // is Tier-2 in-lake storage, but the data provenance tier is the origin.
  trust_tier: 3,
  async fetch(): Promise<RawFragment[]> {
    const fetched_at = isoTimestamp();
    const rows = env.source === "fixture" ? await fetchFromFixture() : await fetchFromSupabase();

    return rows.map(
      (r): RawFragment<ZoriZipLatestRow> => ({
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
          ? "Zillow Observed Rent Index — ZORI latest-per-ZIP (fixture: zori-zip-latest.sample.json)"
          : `${LIVE_CITATION} Portal: ${PORTAL_URL}.`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};

export { TTL_SECONDS as ZORI_ZIP_LATEST_TTL_SECONDS };
