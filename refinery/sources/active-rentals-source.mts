import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";
import { buildSourceCitationUrl } from "../lib/citation-url.mts";

/**
 * Active-rentals source — SWFL active rental listing inventory from SteadyAPI's weekly /rentals-search
 * sweep (both counties, county-form only — see ingest/pipelines/rentals/constants.py for why the
 * per-Lee-city fallback in the original plan was dropped: county-form paginates cleanly and covers
 * MORE than the proposed city list).
 *
 * Reads data_lake.rental_listing_stats (GROUPING SETS: region / county / ZIP) — count + observed price
 * MIN/MAX only (a safe aggregate over the vendor's own per-listing price.min/max; NEVER a derived
 * median blended from those ranges — the source-faithful median rent per ZIP already lives in
 * market-temperature-swfl via data_lake.market_details_swfl).
 *
 * Emits ONE summary fragment carrying the region row + per-county + per-ZIP rows.
 */

const SOURCE_ID = "active_rentals_swfl";
const SCHEMA = "data_lake";
const VIEW = "rental_listing_stats";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "rental-listing-stats.sample.json",
);

export interface RentalStatRow {
  county: string | null;
  zip_code: string | null;
  rental_listing_count: number;
  observed_price_min: number | null;
  observed_price_max: number | null;
  captured_date: string | null;
}

export interface ActiveRentalsSummary {
  kind: "active-rentals-summary";
  region: RentalStatRow | null;
  by_county: RentalStatRow[];
  by_zip: RentalStatRow[];
  captured_date: string | null;
  source_url: string;
}

interface FixtureShape {
  __meta?: unknown;
  rows: RentalStatRow[];
}

async function loadFixtureRows(): Promise<RentalStatRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return (JSON.parse(raw) as FixtureShape).rows ?? [];
}

async function fetchLiveRows(): Promise<RentalStatRow[]> {
  const { data, error } = await getSupabase()
    .schema(SCHEMA)
    .from(VIEW)
    .select(
      "county, zip_code, rental_listing_count, observed_price_min, observed_price_max, captured_date",
    );
  if (error) {
    throw new Error(`active-rentals-source: ${VIEW} fetch failed — ${error.message}`);
  }
  return (data ?? []) as RentalStatRow[];
}

/** Split the GROUPING SETS rows into the three grains by null-ness. */
export function summarize(rows: RentalStatRow[], source_url: string): ActiveRentalsSummary {
  const region = rows.find((r) => r.county == null && r.zip_code == null) ?? null;
  const by_county = rows
    .filter((r) => r.county != null && r.zip_code == null)
    .sort((a, b) => b.rental_listing_count - a.rental_listing_count);
  const by_zip = rows
    .filter((r) => r.zip_code != null)
    .sort((a, b) => b.rental_listing_count - a.rental_listing_count);
  const captured_date =
    rows
      .map((r) => r.captured_date)
      .filter((v): v is string => v != null)
      .sort()
      .at(-1) ?? null;
  return {
    kind: "active-rentals-summary",
    region,
    by_county,
    by_zip,
    captured_date,
    source_url,
  };
}

export const activeRentalsSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,
  async fetch(): Promise<RawFragment[]> {
    const rows = env.source === "fixture" ? await loadFixtureRows() : await fetchLiveRows();
    const fetched_at = isoTimestamp();
    const source_url =
      env.source === "fixture"
        ? `fixture://refinery/__fixtures__/rental-listing-stats.sample.json`
        : buildSourceCitationUrl(VIEW, {
            label: "SWFL active rental listing inventory (weekly sweep)",
            source: "realtor.com rental listings",
            brain: "active-rentals-swfl",
            date_col: "captured_date",
          });
    const summary = summarize(rows, source_url);
    const fragment: RawFragment<ActiveRentalsSummary> = {
      fragment_id: fragmentId(SOURCE_ID, "summary"),
      source_id: SOURCE_ID,
      source_trust_tier: 2,
      fetched_at,
      raw: { row_count: rows.length } as unknown as Record<string, unknown>,
      normalized: summary,
    };
    return [fragment];
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? `SWFL active rental listing inventory (fixture; ${SCHEMA}.${VIEW})`
          : `SWFL active rental listing inventory — realtor.com rental listings`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
