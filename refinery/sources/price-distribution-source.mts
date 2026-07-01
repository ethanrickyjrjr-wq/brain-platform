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
 * Price-distribution source — SWFL active for-sale listing count per $50k price band, per county.
 *
 * Reads the latest-snapshot view data_lake.listing_price_histogram_swfl_latest (populated weekly by the
 * market_aggregates pipeline from a single /price-histogram call per county). Origin = realtor.com (the
 * access layer is never surfaced). Aggregate-at-source: the API already bins the whole county in one call,
 * so this connector pulls ~80 pre-binned rows, never the ~22k live listings.
 *
 * Emits ONE summary fragment carrying every county's band array + total.
 */

const SOURCE_ID = "price_distribution_swfl";
const SCHEMA = "data_lake";
const VIEW = "listing_price_histogram_swfl_latest";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "price-distribution.sample.json",
);

export interface PriceBandRow {
  county: string;
  band_min: number;
  band_max: number | null;
  band_range: string | null;
  listing_count: number;
  total_listings: number | null;
  captured_date: string | null;
}

export interface PriceDistributionCounty {
  county: string;
  total_listings: number;
  bands: {
    band_min: number;
    band_max: number | null;
    band_range: string | null;
    listing_count: number;
  }[];
}

export interface PriceDistributionSummary {
  kind: "price-distribution-summary";
  captured_date: string | null;
  counties: PriceDistributionCounty[];
  source_url: string;
}

interface FixtureShape {
  __meta?: unknown;
  rows: PriceBandRow[];
}

async function loadFixtureRows(): Promise<PriceBandRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return (JSON.parse(raw) as FixtureShape).rows ?? [];
}

async function fetchLiveRows(): Promise<PriceBandRow[]> {
  const { data, error } = await getSupabase()
    .schema(SCHEMA)
    .from(VIEW)
    .select("county, band_min, band_max, band_range, listing_count, total_listings, captured_date");
  if (error) {
    throw new Error(`price-distribution-source: ${VIEW} fetch failed — ${error.message}`);
  }
  return (data ?? []) as PriceBandRow[];
}

/** Group the flat band rows into per-county band arrays (sorted by band_min ascending). */
export function summarize(rows: PriceBandRow[], source_url: string): PriceDistributionSummary {
  const byCounty = new Map<string, PriceBandRow[]>();
  for (const r of rows) {
    if (!r.county) continue;
    if (!byCounty.has(r.county)) byCounty.set(r.county, []);
    byCounty.get(r.county)!.push(r);
  }
  const counties: PriceDistributionCounty[] = [...byCounty.entries()]
    .map(([county, bands]) => {
      const sorted = [...bands].sort((a, b) => a.band_min - b.band_min);
      const total =
        sorted.find((b) => b.total_listings != null)?.total_listings ??
        sorted.reduce((s, b) => s + (b.listing_count ?? 0), 0);
      return {
        county,
        total_listings: total,
        bands: sorted.map((b) => ({
          band_min: b.band_min,
          band_max: b.band_max,
          band_range: b.band_range,
          listing_count: b.listing_count ?? 0,
        })),
      };
    })
    .sort((a, b) => b.total_listings - a.total_listings);
  const captured_date =
    rows
      .map((r) => r.captured_date)
      .filter((v): v is string => v != null)
      .sort()
      .at(-1) ?? null;
  return { kind: "price-distribution-summary", captured_date, counties, source_url };
}

export const priceDistributionSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,
  async fetch(): Promise<RawFragment[]> {
    const rows = env.source === "fixture" ? await loadFixtureRows() : await fetchLiveRows();
    const fetched_at = isoTimestamp();
    const source_url =
      env.source === "fixture"
        ? `fixture://refinery/__fixtures__/price-distribution.sample.json`
        : buildSourceCitationUrl(VIEW, {
            label: "SWFL for-sale listing count by price band (aggregated)",
            source: "realtor.com",
            brain: "price-distribution-swfl",
            date_col: "captured_date",
          });
    const summary = summarize(rows, source_url);
    const fragment: RawFragment<PriceDistributionSummary> = {
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
          ? `SWFL price-band distribution (fixture; ${SCHEMA}.${VIEW})`
          : `SWFL for-sale listing distribution by price band — realtor.com`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
