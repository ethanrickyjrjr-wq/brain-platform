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
 * Active CRE listings source — Crexi active listing data for SWFL submarkets
 * not covered by C&W MarketBeat (Estero, Fort Myers Beach).
 *
 * Emits one fragment per city, aggregated from data_lake.active_listings_cre.
 * Each fragment carries: city, listing_count, available_sqft_raw,
 * median_asking_rent_psf, scraped_at, source_url.
 *
 * No vacancy_rate_pct — Crexi only shows available inventory, not total
 * corridor inventory, so a true vacancy rate cannot be computed here.
 */

const SOURCE_ID = "active_listings_cre";
const SCHEMA = "data_lake";
const TABLE = "active_listings_cre";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "active-listings.sample.json",
);

// Cities that have no MarketBeat submarket coverage — the gap these listings fill.
const COVERAGE_CITIES = ["Estero", "Fort Myers Beach"] as const;

export interface ActiveListingNormalized {
  kind: "active-listing";
  city: string;
  listing_count: number;
  available_sqft_raw: number | null;
  median_asking_rent_psf: number | null;
  scraped_at: string;
  source_url: string;
}

interface RawAggRow {
  city: string;
  listing_count: number;
  available_sqft_raw: number | null;
  median_asking_rent_psf: number | null;
  scraped_at: string;
  source_url: string;
}

interface FixtureShape {
  __meta?: unknown;
  rows: RawAggRow[];
}

async function loadFixture(): Promise<RawAggRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as FixtureShape;
  return parsed.rows ?? [];
}

async function fetchLive(): Promise<RawAggRow[]> {
  // Aggregate per city: count, total available sqft, median asking rent.
  // PostgREST does not support PERCENTILE_CONT, so we fetch all rows and
  // compute the median in JS.
  const { data, error } = await getSupabase()
    .schema(SCHEMA)
    .from(TABLE)
    .select("city, sqft, asking_price_psf, status, _ingested_at, source_url")
    .in("city", COVERAGE_CITIES as unknown as string[])
    .eq("status", "available")
    .order("_ingested_at", { ascending: false });

  if (error) {
    throw new Error(`active-listings-source: ${TABLE} fetch failed — ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    city: string;
    sqft: number | null;
    asking_price_psf: number | null;
    status: string;
    _ingested_at: string;
    source_url: string | null;
  }>;

  // Group by city
  const byCity = new Map<string, typeof rows>();
  for (const r of rows) {
    const bucket = byCity.get(r.city) ?? [];
    bucket.push(r);
    byCity.set(r.city, bucket);
  }

  const result: RawAggRow[] = [];
  for (const [city, cityRows] of byCity.entries()) {
    const sqftList = cityRows.map((r) => r.sqft).filter((v): v is number => v != null);
    const rentList = cityRows
      .map((r) => r.asking_price_psf)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    const mid = Math.floor(rentList.length / 2);
    const medianRent =
      rentList.length === 0
        ? null
        : rentList.length % 2 === 1
          ? rentList[mid]
          : (rentList[mid - 1] + rentList[mid]) / 2;

    const latestScraped =
      cityRows
        .map((r) => r._ingested_at)
        .sort()
        .at(-1) ?? isoTimestamp();

    result.push({
      city,
      listing_count: cityRows.length,
      available_sqft_raw: sqftList.length > 0 ? sqftList.reduce((a, b) => a + b, 0) : null,
      median_asking_rent_psf: medianRent != null ? Math.round(medianRent * 100) / 100 : null,
      scraped_at: latestScraped,
      source_url:
        cityRows.find((r) => r.source_url)?.source_url ??
        buildSourceCitationUrl(TABLE, {
          label: "Crexi active CRE listings",
          source: "Crexi (Firecrawl agent weekly scrape)",
          brain: "cre-swfl",
          date_col: "_ingested_at",
        }),
    });
  }
  return result;
}

export const activeListingsSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,
  async fetch(): Promise<RawFragment[]> {
    const agg = env.source === "fixture" ? await loadFixture() : await fetchLive();
    const fetched_at = isoTimestamp();
    return agg.map((row): RawFragment<ActiveListingNormalized> => {
      const normalized: ActiveListingNormalized = {
        kind: "active-listing",
        city: row.city,
        listing_count: row.listing_count,
        available_sqft_raw: row.available_sqft_raw,
        median_asking_rent_psf: row.median_asking_rent_psf,
        scraped_at: row.scraped_at,
        source_url: row.source_url,
      };
      return {
        fragment_id: fragmentId(SOURCE_ID, `${row.city}_listings`),
        source_id: SOURCE_ID,
        source_trust_tier: 2,
        fetched_at,
        raw: row as unknown as Record<string, unknown>,
        normalized,
      };
    });
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? `Active CRE listings — Estero + FMB (fixture; ${SCHEMA}.${TABLE})`
          : `Active CRE listings via ${SCHEMA}.${TABLE} (Crexi Firecrawl weekly scrape; available-only filter)`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
