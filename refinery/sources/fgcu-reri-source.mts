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
 * fgcu-reri source — FGCU Regional Economic Research Institute monthly indicators.
 *
 * Table: fgcu_reri_indicators (self-ingested via ingest/pipelines/fgcu_reri_indicators,
 * cron 5th of month via fgcu-reri-monthly.yml).
 *
 * Columns read:
 *   report_month       date  -- first day of reporting month (~4th of month, ~2-month lag)
 *   indicator          text  -- airport_activity | tourist_tax_revenues | taxable_sales |
 *                              unemployment_rate | permits_single_family |
 *                              home_sales_single_family | home_prices_single_family |
 *                              active_listings_residential
 *   county             text  -- "swfl" (aggregate) | "Lee" | "Collier" | "Charlotte"
 *   pct_change         float -- YoY percentage change (or pp change for unemployment)
 *   pct_change_unit    text  -- "percent" | "percentage points"
 *   source_url         text  -- FGCU RERI homepage URL
 *
 * Window: last 3 months — enough for latest report + one prior for trend context.
 *
 * Trust tier: 1 (FGCU Lutgert College of Business — primary university source).
 */

const SOURCE_ID = "fgcu_reri_indicators";
const TABLE = "fgcu_reri_indicators";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "fgcu-reri.sample.json",
);

/** One normalized row from fgcu_reri_indicators. */
export interface ReriNormalized {
  kind: "reri-row";
  /** "YYYY-MM" — month grain sliced from the DATE column. */
  report_month: string;
  /** e.g. "airport_activity" | "unemployment_rate" | "home_prices_single_family" */
  indicator: string;
  /** "swfl" | "lee" | "collier" | "charlotte" */
  county: string;
  pct_change: number | null;
  /** "percent" | "percentage points" */
  pct_change_unit: string;
  source_url: string;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toReportMonth(v: unknown): string {
  const raw = str(v);
  const m = raw.match(/^(\d{4})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  return "";
}

function normalize(row: Record<string, unknown>): ReriNormalized | null {
  const report_month = toReportMonth(row.report_month);
  if (!report_month) return null;
  const indicator = str(row.indicator);
  if (!indicator) return null;
  const county = str(row.county).toLowerCase() || "swfl";
  return {
    kind: "reri-row",
    report_month,
    indicator,
    county,
    pct_change: toNum(row.pct_change),
    pct_change_unit: str(row.pct_change_unit) || "percent",
    source_url: str(row.source_url),
  };
}

async function loadFixtureRows(): Promise<Record<string, unknown>[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as { rows?: unknown[] } | unknown[];
  const rows: unknown[] = Array.isArray(data)
    ? data
    : ((data as { rows?: unknown[] }).rows ?? []);
  return rows as Record<string, unknown>[];
}

async function fetchRows(): Promise<Record<string, unknown>[]> {
  if (env.source === "fixture") return loadFixtureRows();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select(
      "report_month, indicator, county, pct_change, pct_change_unit, source_url",
    )
    .gte("report_month", cutoffDate)
    .order("report_month", { ascending: false });
  if (error) {
    throw new Error(
      `fgcu-reri-source: ${TABLE} query failed — ${error.message}`,
    );
  }
  return (data ?? []) as Record<string, unknown>[];
}

export const fgcuReriSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,
  async fetch(): Promise<RawFragment[]> {
    const rows = await fetchRows();
    const fetched_at = isoTimestamp();
    const receipt =
      env.source === "fixture"
        ? `fixture://refinery/__fixtures__/fgcu-reri.sample.json`
        : buildSourceCitationUrl(TABLE, {
            label:
              "FGCU RERI Monthly Economic Outlook — Lutgert College of Business",
            source: "FGCU RERI",
            brain: "fgcu-reri",
            date_col: "report_month",
          });
    return rows
      .map((row): RawFragment<ReriNormalized> | null => {
        const normalized = normalize(row);
        if (!normalized) return null;
        if (!normalized.source_url) normalized.source_url = receipt;
        return {
          fragment_id: fragmentId(
            SOURCE_ID,
            `${normalized.indicator}-${normalized.county}-${normalized.report_month}`,
          ),
          source_id: SOURCE_ID,
          source_trust_tier: 1,
          fetched_at,
          raw: row,
          normalized,
        };
      })
      .filter((f): f is RawFragment<ReriNormalized> => f !== null);
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? "FGCU RERI Monthly Economic Outlook — Lutgert College of Business (fixture; SWFL: Lee + Collier + Charlotte via fgcu_reri_indicators)"
          : "FGCU RERI Monthly Economic Outlook — Lutgert College of Business (Supabase fgcu_reri_indicators: indicator, county, pct_change, pct_change_unit, report_month; SWFL: Lee + Collier + Charlotte; ~2-month data lag)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
