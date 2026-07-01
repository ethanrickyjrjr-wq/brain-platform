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
 * Market-temperature source — per-ZIP market snapshot from realtor.com's monthly ZIP aggregates
 * (data_lake.market_details_swfl_latest, one /housing-market-details call per ZIP, monthly).
 *
 * The genuinely NET-NEW field is sold_to_rent_ratio (sold price ÷ annual rent — a gross-yield read no free
 * source publishes). median sold/list/rent/DOM/ppsqft/hotness/list-to-sold DUPLICATE data we already hold
 * free (housing-swfl Redfin sold, market-heat realtor DOM/hotness), so they ride as cited CONTEXT in the
 * per-ZIP detail table, never as the headline vote.
 *
 * Emits ONE summary fragment: the per-ZIP rows + the region-median sold-to-rent.
 */

const SOURCE_ID = "market_temperature_swfl";
const SCHEMA = "data_lake";
const VIEW = "market_details_swfl_latest";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "market-temperature.sample.json",
);

export interface MarketDetailRow {
  zip_code: string;
  county: string | null;
  median_sold_price: number | null;
  median_listing_price: number | null;
  median_rent_price: number | null;
  median_days_on_market: number | null;
  median_price_per_sqft: number | null;
  local_hotness_score: number | null;
  list_to_sold_ratio_pct: number | null;
  sold_to_rent_ratio: number | null;
  market_strength: string | null;
  is_competitive: boolean | null;
  captured_date: string | null;
}

export interface MarketTemperatureSummary {
  kind: "market-temperature-summary";
  captured_date: string | null;
  rows: MarketDetailRow[];
  region_sold_to_rent: number | null;
  source_url: string;
}

interface FixtureShape {
  __meta?: unknown;
  rows: MarketDetailRow[];
}

async function loadFixtureRows(): Promise<MarketDetailRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return (JSON.parse(raw) as FixtureShape).rows ?? [];
}

async function fetchLiveRows(): Promise<MarketDetailRow[]> {
  const { data, error } = await getSupabase()
    .schema(SCHEMA)
    .from(VIEW)
    .select(
      "zip_code, county, median_sold_price, median_listing_price, median_rent_price, median_days_on_market, median_price_per_sqft, local_hotness_score, list_to_sold_ratio_pct, sold_to_rent_ratio, market_strength, is_competitive, captured_date",
    );
  if (error) {
    throw new Error(`market-temperature-source: ${VIEW} fetch failed — ${error.message}`);
  }
  return (data ?? []) as MarketDetailRow[];
}

/** Median of the non-null values (even-length → mean of the two middles). */
export function median(values: readonly (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function summarize(rows: MarketDetailRow[], source_url: string): MarketTemperatureSummary {
  const clean = rows.filter((r) => r.zip_code);
  const captured_date =
    clean
      .map((r) => r.captured_date)
      .filter((v): v is string => v != null)
      .sort()
      .at(-1) ?? null;
  return {
    kind: "market-temperature-summary",
    captured_date,
    rows: clean,
    region_sold_to_rent: median(clean.map((r) => r.sold_to_rent_ratio)),
    source_url,
  };
}

export const marketTemperatureSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,
  async fetch(): Promise<RawFragment[]> {
    const rows = env.source === "fixture" ? await loadFixtureRows() : await fetchLiveRows();
    const fetched_at = isoTimestamp();
    const source_url =
      env.source === "fixture"
        ? `fixture://refinery/__fixtures__/market-temperature.sample.json`
        : buildSourceCitationUrl(VIEW, {
            label: "SWFL per-ZIP market snapshot (sold-to-rent yield + medians)",
            source: "realtor.com",
            brain: "market-temperature-swfl",
            date_col: "captured_date",
          });
    const summary = summarize(rows, source_url);
    const fragment: RawFragment<MarketTemperatureSummary> = {
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
          ? `SWFL per-ZIP market snapshot (fixture; ${SCHEMA}.${VIEW})`
          : `SWFL per-ZIP market snapshot — realtor.com`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
