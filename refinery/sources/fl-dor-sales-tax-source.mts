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
 * fl-dor-sales-tax source — FL DOR Form 10 Taxable Sales by Business Type.
 *
 * Table: fl_dor_sales_tax (self-ingested via ingest/pipelines/fl_dor_sales_tax,
 * cron 15th of month via fl-dor-sales-tax-monthly.yml).
 *
 * Columns read:
 *   county           text  -- "Lee" | "Collier"
 *   kind_code        int   -- FL DOR business-type code (1=Grocery, 8=Restaurants, ...)
 *   business_type    text  -- human label for kind_code
 *   period           date  -- first day of reported month
 *   taxable_sales_usd numeric -- monthly taxable sales in USD
 *   source_url       text  -- FL DOR Form 10 XLSX URL for this year-pair
 *
 * Window: last 26 months — enough for trailing-12 + YoY comparison of the latest month.
 * Null taxable_sales_usd rows excluded at fetch time (not yet published).
 *
 * Trust tier: 1 (Florida DOR — primary state-government source).
 */

const SOURCE_ID = "fl_dor_sales_tax";
const TABLE = "fl_dor_sales_tax";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "fl-dor-sales-tax.sample.json",
);

/** One normalized row from fl_dor_sales_tax. */
export interface SalesTaxNormalized {
  kind: "sales-tax-row";
  county: string;
  kind_code: number;
  business_type: string;
  /** "YYYY-MM" — month grain, sliced from the DATE column. */
  period_yyyymm: string;
  taxable_sales_usd: number | null;
  source_url: string;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n =
    typeof v === "string" ? parseFloat(v.replace(/[$,\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizePeriod(v: unknown): string {
  const raw = str(v);
  const iso = raw.match(/^(\d{4})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}`;
  return "";
}

function normalize(row: Record<string, unknown>): SalesTaxNormalized | null {
  const county = str(row.county);
  if (county !== "Lee" && county !== "Collier") return null;
  const period_yyyymm = normalizePeriod(row.period);
  if (!period_yyyymm) return null;
  const kind_code = Number(row.kind_code);
  if (!Number.isFinite(kind_code)) return null;
  return {
    kind: "sales-tax-row",
    county,
    kind_code,
    business_type: str(row.business_type),
    period_yyyymm,
    taxable_sales_usd: toNum(row.taxable_sales_usd),
    source_url: str(row.source_url),
  };
}

async function loadFixtureRows(): Promise<Record<string, unknown>[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as { rows?: unknown[] } | unknown[];
  const rows: unknown[] = Array.isArray(data) ? data : ((data as { rows?: unknown[] }).rows ?? []);
  return rows as Record<string, unknown>[];
}

async function fetchRows(): Promise<Record<string, unknown>[]> {
  if (env.source === "fixture") return loadFixtureRows();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 26);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select(
      "county, kind_code, business_type, period, taxable_sales_usd, source_url",
    )
    .in("county", ["Lee", "Collier"])
    .gte("period", cutoffDate)
    .not("taxable_sales_usd", "is", null);
  if (error) {
    throw new Error(
      `fl-dor-sales-tax-source: ${TABLE} query failed — ${error.message}`,
    );
  }
  return (data ?? []) as Record<string, unknown>[];
}

export const flDorSalesTaxSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,
  async fetch(): Promise<RawFragment[]> {
    const rows = await fetchRows();
    const fetched_at = isoTimestamp();
    const receipt =
      env.source === "fixture"
        ? `fixture://refinery/__fixtures__/fl-dor-sales-tax.sample.json`
        : buildSourceCitationUrl(TABLE, {
            label: "Florida DOR — Form 10 Taxable Sales by Business Type",
            source: "Florida DOR",
            brain: "sector-credit-swfl",
            date_col: "period",
          });
    return rows
      .map((row): RawFragment<SalesTaxNormalized> | null => {
        const normalized = normalize(row);
        if (!normalized) return null;
        if (!normalized.source_url) normalized.source_url = receipt;
        return {
          fragment_id: fragmentId(
            SOURCE_ID,
            `${normalized.county}-${normalized.kind_code}-${normalized.period_yyyymm}`,
          ),
          source_id: SOURCE_ID,
          source_trust_tier: 1,
          fetched_at,
          raw: row,
          normalized,
        };
      })
      .filter((f): f is RawFragment<SalesTaxNormalized> => f !== null);
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? "Florida DOR Form 10 — Taxable Sales by Business Type (fixture; SWFL: Lee + Collier via fl_dor_sales_tax)"
          : "Florida DOR Form 10 — Taxable Sales by Business Type (Supabase fl_dor_sales_tax: county, kind_code, business_type, period, taxable_sales_usd; SWFL: Lee + Collier; biennial XLSX cy2425)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
