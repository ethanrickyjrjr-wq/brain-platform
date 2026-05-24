import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

const SOURCE_ID = "zori_swfl";

// Zillow Research publishes monthly (~3rd week, for the prior month). Setting
// the source-level TTL to 35 days gives one publish cycle of slack — Stage 4
// will compute confidence freshness against this same value via PackDefinition.
const TTL_SECONDS = 86400 * 35;

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "__fixtures__",
  "zori-swfl.sample.json",
);

const PORTAL_URL = "https://www.zillow.com/research/data/";
const LIVE_CITATION =
  "Zillow Observed Rent Index (ZORI), ZIP-level monthly composite, all-homes " +
  "(SFR + Condo + Multifamily), monthly, from data_lake.zori_swfl. " +
  "Source: Zillow Research, files.zillowstatic.com.";

export interface ZoriZipRow {
  zip_code: string;
  /** ISO 8601 date string, e.g. "2026-04-30" */
  period_end: string;
  rent_index: number;
  metro: string | null;
  county_name: string | null;
  city: string | null;
}

async function fetchFromSupabase(): Promise<ZoriZipRow[]> {
  // Trailing 24 months covers the YoY/MoM window the pack needs plus a small
  // buffer for backfill checks. The pack itself computes deltas in TS.
  const monthsBack = 24;
  const sinceDate = new Date();
  sinceDate.setUTCMonth(sinceDate.getUTCMonth() - monthsBack);
  const sinceIso = sinceDate.toISOString().slice(0, 10);

  // Supabase enforces a server-side max_rows cap (default 1000) that
  // `.limit(N)` cannot exceed. Trailing 24mo × ~100 SWFL ZIPs is ~2,400 rows,
  // so paginate via `.range()`. Keeps the source self-sufficient — no
  // project-level config dependency.
  const PAGE_SIZE = 1000;
  const all: ZoriZipRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await getSupabase()
      .schema("data_lake")
      .from("zori_swfl")
      .select("zip_code, period_end, rent_index, metro, county_name, city")
      .gte("period_end", sinceIso)
      .order("zip_code", { ascending: true })
      .order("period_end", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`zori-source: Supabase fetch failed — ${error.message}`);
    }
    const page = (data ?? []) as ZoriZipRow[];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    if (offset > 100_000) {
      throw new Error(
        `zori-source: pagination exceeded 100k rows — investigate before raising the ceiling`,
      );
    }
  }
  return all;
}

async function fetchFromFixture(): Promise<ZoriZipRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as ZoriZipRow[];
}

export const zoriSource: SourceConnector = {
  source_id: SOURCE_ID,
  // Tier 3 = private-sector industry aggregator (Zillow Research). See
  // refinery/types/pack.mts:30-36 for the tier definitions. Maps to a
  // trust_tier_score of 0.6 in the confidence formula — honest read of
  // a single-vendor methodology-driven index.
  trust_tier: 3,
  async fetch(): Promise<RawFragment[]> {
    const fetched_at = isoTimestamp();
    const rows =
      env.source === "fixture"
        ? await fetchFromFixture()
        : await fetchFromSupabase();

    return rows.map(
      (r): RawFragment<ZoriZipRow> => ({
        fragment_id: fragmentId(SOURCE_ID, `${r.zip_code}_${r.period_end}`),
        source_id: SOURCE_ID,
        source_trust_tier: 3,
        fetched_at,
        raw: {
          zip_code: r.zip_code,
          period_end: r.period_end,
          rent_index: r.rent_index,
        },
        normalized: r,
      }),
    );
  },
  citationMeta(
    verifiedDate: string,
    ttlSeconds: number,
  ): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? `Zillow Observed Rent Index — ZORI (fixture)`
          : `${LIVE_CITATION} Portal: ${PORTAL_URL}.`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};

export { TTL_SECONDS as ZORI_TTL_SECONDS };
