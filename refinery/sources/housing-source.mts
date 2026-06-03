import { makeDuckDBSource } from "./duckdb-source.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { fragmentId } from "../lib/ids.mts";
import { expiresDate } from "../lib/dates.mts";

// ── Row shape ─────────────────────────────────────────────────────────────────
// Parquet columns are ALL_CAPS as written by DuckDB COPY, except REGION which
// the pipeline renames to zip_code (lowercase). The SQL query aliases all
// remaining columns to lowercase so rowShape can reference plain property names.
//
// YoY fields follow Redfin's MIXED convention — verify the field, don't assume:
//   MEDIAN_SALE_PRICE_YOY, INVENTORY_YOY, AVG_SALE_TO_LIST_YOY are decimal
//   fractions (0.043 = +4.3%, -0.12 = -12%).
//   MEDIAN_DOM_YOY is an ABSOLUTE DAY DIFFERENCE, NOT a fraction (e.g. -11 =
//   median DOM fell 11 days YoY; +148.5 = rose 148.5 days). MEDIAN_DOM is days.
//   (Empirically verified 2026-06-03 against the live redfin_swfl Tier-1 view —
//    treating it as a fraction shipped a nonsense "650.0% YoY" to users.)
//
// AVG_SALE_TO_LIST is a ratio (0.997 = 99.7% of list, 1.012 = 1.2% above).
// SOLD_ABOVE_LIST and OFF_MARKET_IN_TWO_WEEKS are fractions 0–1.
//
// REGION_TYPE stores 'zip code' (two words) — not 'zip'.
// PERIOD_DURATION = 90 (BIGINT) for all rows in this Parquet — Redfin's
// ZIP tracker uses rolling 90-day windows labeled by end month.

export interface HousingZipRow {
  zip_code: string;
  period_begin: string; // ISO date string
  period_end: string;
  parent_metro_region: string;
  median_sale_price: number | null;
  median_list_price: number | null;
  median_ppsf: number | null;
  median_dom: number | null; // days
  avg_sale_to_list: number | null; // ratio around 1.0
  sold_above_list: number | null; // fraction 0–1
  price_drops: number | null; // fraction 0–1
  off_market_in_two_weeks: number | null; // fraction 0–1
  homes_sold: number | null;
  inventory: number | null;
  months_of_supply: number | null;
  pending_sales: number | null;
  median_sale_price_yoy: number | null; // decimal fraction
  median_sale_price_mom: number | null; // decimal fraction
  median_dom_yoy: number | null; // ABSOLUTE day difference YoY (NOT a fraction)
  inventory_yoy: number | null; // decimal fraction
  avg_sale_to_list_yoy: number | null; // decimal fraction
}

const SOURCE_ID = "redfin_swfl";

// Redfin Parquet stores missing numerics as the string "NA" (not SQL NULL).
// read_csv_auto infers columns as VARCHAR when "NA" appears alongside decimals.
function toNum(v: unknown): number | null {
  if (v == null || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const housingSource: SourceConnector = makeDuckDBSource<HousingZipRow>({
  source_id: SOURCE_ID,
  trust_tier: 3,
  parquetViews: [
    {
      name: "redfin_swfl",
      s3_url: "s3://lake-tier1/market/redfin_swfl.parquet",
    },
  ],
  query: `
    SELECT
      zip_code,
      PERIOD_BEGIN::TEXT          AS period_begin,
      PERIOD_END::TEXT            AS period_end,
      PARENT_METRO_REGION         AS parent_metro_region,
      MEDIAN_SALE_PRICE           AS median_sale_price,
      MEDIAN_LIST_PRICE           AS median_list_price,
      MEDIAN_PPSF                 AS median_ppsf,
      MEDIAN_DOM                  AS median_dom,
      AVG_SALE_TO_LIST            AS avg_sale_to_list,
      SOLD_ABOVE_LIST             AS sold_above_list,
      PRICE_DROPS                 AS price_drops,
      OFF_MARKET_IN_TWO_WEEKS     AS off_market_in_two_weeks,
      HOMES_SOLD                  AS homes_sold,
      INVENTORY                   AS inventory,
      MONTHS_OF_SUPPLY            AS months_of_supply,
      PENDING_SALES               AS pending_sales,
      MEDIAN_SALE_PRICE_YOY       AS median_sale_price_yoy,
      MEDIAN_SALE_PRICE_MOM       AS median_sale_price_mom,
      MEDIAN_DOM_YOY              AS median_dom_yoy,
      INVENTORY_YOY               AS inventory_yoy,
      AVG_SALE_TO_LIST_YOY        AS avg_sale_to_list_yoy
    FROM redfin_swfl
    WHERE REGION_TYPE   = 'zip code'
      AND PROPERTY_TYPE = 'All Residential'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY zip_code ORDER BY PERIOD_BEGIN DESC) = 1
    ORDER BY zip_code
  `,
  rowShape: (raw) => ({
    // Strip Redfin's "Zip Code: XXXXX" label down to just the 5-digit ZIP.
    zip_code: String(raw.zip_code ?? "").replace(/^Zip Code:\s*/i, ""),
    period_begin: String(raw.period_begin ?? ""),
    period_end: String(raw.period_end ?? ""),
    parent_metro_region: String(raw.parent_metro_region ?? ""),
    median_sale_price: toNum(raw.median_sale_price),
    median_list_price: toNum(raw.median_list_price),
    median_ppsf: toNum(raw.median_ppsf),
    median_dom: toNum(raw.median_dom),
    avg_sale_to_list: toNum(raw.avg_sale_to_list),
    sold_above_list: toNum(raw.sold_above_list),
    price_drops: toNum(raw.price_drops),
    off_market_in_two_weeks: toNum(raw.off_market_in_two_weeks),
    homes_sold: toNum(raw.homes_sold),
    inventory: toNum(raw.inventory),
    months_of_supply: toNum(raw.months_of_supply),
    pending_sales: toNum(raw.pending_sales),
    median_sale_price_yoy: toNum(raw.median_sale_price_yoy),
    median_sale_price_mom: toNum(raw.median_sale_price_mom),
    median_dom_yoy: toNum(raw.median_dom_yoy),
    inventory_yoy: toNum(raw.inventory_yoy),
    avg_sale_to_list_yoy: toNum(raw.avg_sale_to_list_yoy),
  }),
  normalize: (rows, { fetched_at }): RawFragment[] =>
    rows.map((r) => ({
      fragment_id: fragmentId(SOURCE_ID, r.zip_code),
      source_id: SOURCE_ID,
      source_trust_tier: 3,
      fetched_at,
      raw: r,
      normalized: r,
    })),
  citation: (verifiedDate, ttlSeconds): Omit<CitationRow, "id"> => ({
    source:
      "Redfin Data Center — ZIP-level monthly housing metrics for SWFL MSAs (All Residential). Updated ~3rd Friday each month. https://www.redfin.com/news/data-center/",
    verified: verifiedDate,
    expires: expiresDate(verifiedDate, ttlSeconds),
  }),
  fixturePath: "refinery/__fixtures__/housing-swfl.sample.json",
});
