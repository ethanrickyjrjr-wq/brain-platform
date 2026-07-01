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
 * Listing-momentum source — the weekly LEADING list-side signal, from our OWN active inventory.
 *
 * Reads data_lake.listing_momentum_stats (GROUPING SETS: region / county / ZIP) — point-in-time SHARES
 * off the SteadyAPI /search sweep's flag columns (source_name='api_feed', state='active'):
 *   price_reduced_share = flag_price_reduced / active   (softening pressure — the fastest sentiment read)
 *   new_listing_share   = flag_new_listing / active     (fresh supply coming on)
 * No metered calls — this rides on the inventory sweep we already run. Works on week one (a point-in-time
 * share needs no history). Empty-tolerant until the sweep runs live (source_name='api_feed').
 *
 * Emits ONE summary fragment carrying the region row + per-county + per-ZIP rows.
 */

const SOURCE_ID = "listing_momentum_swfl";
const SCHEMA = "data_lake";
const VIEW = "listing_momentum_stats";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "listing-momentum.sample.json",
);

export interface MomentumRow {
  county: string | null;
  zip_code: string | null;
  active_listing_count: number;
  price_reduced_share: number | null;
  new_listing_share: number | null;
  latest_scraped_at: string | null;
}

export interface ListingMomentumSummary {
  kind: "listing-momentum-summary";
  region: MomentumRow | null;
  by_county: MomentumRow[];
  by_zip: MomentumRow[];
  latest_scraped_at: string | null;
  source_url: string;
}

interface FixtureShape {
  __meta?: unknown;
  rows: MomentumRow[];
}

async function loadFixtureRows(): Promise<MomentumRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return (JSON.parse(raw) as FixtureShape).rows ?? [];
}

async function fetchLiveRows(): Promise<MomentumRow[]> {
  const { data, error } = await getSupabase()
    .schema(SCHEMA)
    .from(VIEW)
    .select(
      "county, zip_code, active_listing_count, price_reduced_share, new_listing_share, latest_scraped_at",
    );
  if (error) {
    throw new Error(`listing-momentum-source: ${VIEW} fetch failed — ${error.message}`);
  }
  return (data ?? []) as MomentumRow[];
}

/** Split the GROUPING SETS rows into the three grains by null-ness. */
export function summarize(rows: MomentumRow[], source_url: string): ListingMomentumSummary {
  const region = rows.find((r) => r.county == null && r.zip_code == null) ?? null;
  const by_county = rows
    .filter((r) => r.county != null && r.zip_code == null)
    .sort((a, b) => b.active_listing_count - a.active_listing_count);
  const by_zip = rows
    .filter((r) => r.zip_code != null)
    .sort((a, b) => b.active_listing_count - a.active_listing_count);
  const latest =
    rows
      .map((r) => r.latest_scraped_at)
      .filter((v): v is string => v != null)
      .sort()
      .at(-1) ?? null;
  return {
    kind: "listing-momentum-summary",
    region,
    by_county,
    by_zip,
    latest_scraped_at: latest,
    source_url,
  };
}

export const listingMomentumSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,
  async fetch(): Promise<RawFragment[]> {
    const rows = env.source === "fixture" ? await loadFixtureRows() : await fetchLiveRows();
    const fetched_at = isoTimestamp();
    const source_url =
      env.source === "fixture"
        ? `fixture://refinery/__fixtures__/listing-momentum.sample.json`
        : buildSourceCitationUrl(VIEW, {
            label: "SWFL for-sale listing momentum (price-cut / new-listing shares)",
            source: "realtor.com for-sale listings",
            brain: "listing-momentum-swfl",
            date_col: "scraped_at",
          });
    const summary = summarize(rows, source_url);
    const fragment: RawFragment<ListingMomentumSummary> = {
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
          ? `SWFL listing momentum (fixture; ${SCHEMA}.${VIEW})`
          : `SWFL for-sale listing momentum — realtor.com for-sale listings`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
