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
 * rsw-airport source — Lee County Port Authority monthly aviation statistics.
 *
 * Table: rsw_airport_monthly (self-ingested via ingest/pipelines/rsw_airport_monthly,
 * cron 8th of month via rsw-airport-monthly.yml).
 *
 * Columns read:
 *   report_month      date   -- first day of reporting month
 *   airport_code      text   -- "RSW" | "PGD"
 *   metric            text   -- "enplanements" | "total_passengers" | "aircraft_operations"
 *   value             bigint -- monthly count
 *   yoy_pct_change    numeric -- YoY % change (null = prior-year row absent)
 *   period_label      text   -- "March 2026"
 *   source_url        text   -- LCPA statistics page URL
 *
 * Window: last 15 months — covers trailing 12-month sum + 3 months context.
 *
 * Trust tier: 1 (Lee County Port Authority — primary airport operator source).
 */

const SOURCE_ID = "rsw_airport_monthly";
const TABLE = "rsw_airport_monthly";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "rsw-airport.sample.json",
);

/** One normalized row from rsw_airport_monthly. */
export interface RswAirportNormalized {
  kind: "rsw-airport-row";
  /** "YYYY-MM" — month grain. */
  report_month: string;
  /** "RSW" | "PGD" */
  airport_code: string;
  /** "enplanements" | "total_passengers" | "aircraft_operations" | "cargo_lbs" */
  metric: string;
  value: number | null;
  /** YoY percentage change; null when prior-year row was absent. */
  yoy_pct_change: number | null;
  period_label: string;
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

function normalize(row: Record<string, unknown>): RswAirportNormalized | null {
  const report_month = toReportMonth(row.report_month);
  if (!report_month) return null;
  const airport_code = str(row.airport_code).toUpperCase();
  if (!airport_code) return null;
  const metric = str(row.metric) || "enplanements";
  return {
    kind: "rsw-airport-row",
    report_month,
    airport_code,
    metric,
    value: toNum(row.value),
    yoy_pct_change: toNum(row.yoy_pct_change),
    period_label: str(row.period_label),
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
  cutoff.setMonth(cutoff.getMonth() - 15);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select(
      "report_month, airport_code, metric, value, yoy_pct_change, period_label, source_url",
    )
    .gte("report_month", cutoffDate)
    .order("report_month", { ascending: false });
  if (error) {
    throw new Error(
      `rsw-airport-source: ${TABLE} query failed — ${error.message}`,
    );
  }
  return (data ?? []) as Record<string, unknown>[];
}

export const rswAirportSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,
  async fetch(): Promise<RawFragment[]> {
    const rows = await fetchRows();
    const fetched_at = isoTimestamp();
    const receipt =
      env.source === "fixture"
        ? `fixture://refinery/__fixtures__/rsw-airport.sample.json`
        : buildSourceCitationUrl(TABLE, {
            label:
              "Lee County Port Authority Aviation Statistics — RSW + PGD monthly enplanements",
            source: "LCPA",
            brain: "rsw-airport",
            date_col: "report_month",
          });
    return rows
      .map((row): RawFragment<RswAirportNormalized> | null => {
        const normalized = normalize(row);
        if (!normalized) return null;
        if (!normalized.source_url) normalized.source_url = receipt;
        return {
          fragment_id: fragmentId(
            SOURCE_ID,
            `${normalized.airport_code}-${normalized.metric}-${normalized.report_month}`,
          ),
          source_id: SOURCE_ID,
          source_trust_tier: 1,
          fetched_at,
          raw: row,
          normalized,
        };
      })
      .filter((f): f is RawFragment<RswAirportNormalized> => f !== null);
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? "Lee County Port Authority Aviation Statistics — RSW + PGD monthly enplanements (fixture; rsw_airport_monthly)"
          : "Lee County Port Authority Aviation Statistics — RSW (Southwest Florida International) + PGD (Punta Gorda) monthly enplanements (Supabase rsw_airport_monthly: airport_code, metric, value, yoy_pct_change, report_month; scrape cadence monthly via flylcpa.com/about/statistics)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
