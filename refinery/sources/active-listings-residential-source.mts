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
 * Active residential listings source — region-wide SWFL inventory from the listing-lifecycle
 * state machine (data_lake.listing_state, the active subset). The feed is the daily RentCast +
 * SteadyAPI API sweep (source_name='api_feed'); realtor.com data via two named resellers — a
 * lane-3 "named web source", cited as such. Reads the AGGREGATE-AT-SOURCE view
 * data_lake.listing_active_stats (GROUPING SETS: region / county / ZIP), so this connector pulls
 * ~tens of pre-aggregated rows, not the ~10k+ live listings (operator decree). Median is computed
 * in SQL per-grain — never median-of-medians. avg_days_on_market is now REAL (RentCast supplies a
 * true days-on-market); SteadyAPI-only listings stay NULL rather than fake a 0, so the average
 * reflects only sourced DOM.
 *
 * Emits ONE summary fragment carrying the region row, the per-county rows, and the per-ZIP rows.
 */

const SOURCE_ID = "active_listings_residential";
const SCHEMA = "data_lake";
const VIEW = "listing_active_stats";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "active-listings-residential.sample.json",
);

export interface ResidentialStatRow {
  county: string | null;
  zip_code: string | null;
  listing_count: number;
  median_list_price: number | null;
  avg_days_on_market: number | null;
  avg_list_price: number | null;
  latest_scraped_at: string | null;
}

export interface ActiveListingsResidentialSummary {
  kind: "active-listings-residential-summary";
  region: ResidentialStatRow | null;
  by_county: ResidentialStatRow[];
  by_zip: ResidentialStatRow[];
  latest_scraped_at: string | null;
  source_url: string;
}

interface FixtureShape {
  __meta?: unknown;
  rows: ResidentialStatRow[];
}

async function loadFixtureRows(): Promise<ResidentialStatRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return (JSON.parse(raw) as FixtureShape).rows ?? [];
}

async function fetchLiveRows(): Promise<ResidentialStatRow[]> {
  const { data, error } = await getSupabase()
    .schema(SCHEMA)
    .from(VIEW)
    .select(
      "county, zip_code, listing_count, median_list_price, avg_days_on_market, avg_list_price, latest_scraped_at",
    );
  if (error) {
    throw new Error(`active-listings-residential-source: ${VIEW} fetch failed — ${error.message}`);
  }
  return (data ?? []) as ResidentialStatRow[];
}

/** Split the GROUPING SETS rows into the three grains by null-ness. */
function summarize(
  rows: ResidentialStatRow[],
  source_url: string,
): ActiveListingsResidentialSummary {
  const region = rows.find((r) => r.county == null && r.zip_code == null) ?? null;
  const by_county = rows
    .filter((r) => r.county != null && r.zip_code == null)
    .sort((a, b) => b.listing_count - a.listing_count);
  const by_zip = rows
    .filter((r) => r.zip_code != null)
    .sort((a, b) => b.listing_count - a.listing_count);
  const latest =
    rows
      .map((r) => r.latest_scraped_at)
      .filter((v): v is string => v != null)
      .sort()
      .at(-1) ?? null;
  return {
    kind: "active-listings-residential-summary",
    region,
    by_county,
    by_zip,
    latest_scraped_at: latest,
    source_url,
  };
}

export const activeListingsResidentialSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,
  async fetch(): Promise<RawFragment[]> {
    const rows = env.source === "fixture" ? await loadFixtureRows() : await fetchLiveRows();
    const fetched_at = isoTimestamp();
    const source_url =
      env.source === "fixture"
        ? `fixture://refinery/__fixtures__/active-listings-residential.sample.json`
        : buildSourceCitationUrl(VIEW, {
            label: "SWFL active for-sale listings (aggregated)",
            source: "realtor.com for-sale listings",
            brain: "active-listings-swfl",
            date_col: "scraped_at",
          });
    const summary = summarize(rows, source_url);
    const fragment: RawFragment<ActiveListingsResidentialSummary> = {
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
          ? `SWFL active residential listings (fixture; ${SCHEMA}.${VIEW})`
          : `SWFL active for-sale listings — realtor.com`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
