import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * tourism-tdt source connector — Lee County Tourist Development Tax collections,
 * sourced from the Florida Department of Revenue via the `fl_dor_tdt_collections`
 * table in the premise-engine Supabase. Authoritative origin: Lee County Clerk
 * Doc 328, 103 monthly rows covering FY2013 → FY2026.
 *
 * THIS IS THE ONLY FILE THAT KNOWS THE fl_dor_tdt_collections SCHEMA.
 * Columns read (verified via PostgREST OpenAPI 2026-05-16):
 *   id (uuid PK), county (text), county_fips (text), period (date),
 *   collections_usd (numeric), returns_filed (integer), source_url (text),
 *   retrieved_at (timestamptz).
 * No fiscal_year column exists; FY is derived from `period` (FL FY starts Oct 1).
 *
 * Trust tier: 1 (Florida DOR is a primary state-government source — same tier
 * weight as FRED in `macro-swfl-source.mts`).
 *
 * Fixture mode (REFINERY_SOURCE=fixture) reads the committed sample and lets
 * the pack typecheck + render with zero creds. The fixture and live mapping
 * both yield `TourismTdtNormalized` rows so the pack never branches on mode.
 *
 * Engineering note: this is the FIRST hospitality-domain source. The dlt
 * Python-sidecar option was evaluated and deferred (arsenal v3.1 changelog) —
 * TDT data already lives in our Supabase, so a thin native reader is the
 * correct shape. dlt's value appears at the first true SaaS-class source.
 */

const SOURCE_ID = "fl_dor_tdt";
const TABLE = "fl_dor_tdt_collections";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "tourism-tdt.sample.json",
);

/** Normalized TDT collection row — what Stage 2 / Stage 3 see. */
export interface TourismTdtNormalized {
  kind: "tdt-collection";
  /** County the collection covers — Lee for v1, schema supports more. */
  county: string;
  /**
   * The period the collection covers, normalized to "YYYY-MM" (month grain).
   * `period` is a Postgres date column; PostgREST returns "YYYY-MM-DD". We
   * slice to YYYY-MM since DOR collections are reported at month grain.
   */
  period_yyyymm: string;
  /** Raw value of `period` as returned by Supabase, for traceability. */
  period_raw: string;
  /**
   * Florida fiscal year derived from `period` (FL FY starts Oct 1). 2022-10
   * onwards = FY2023, 2022-01 through 2022-09 = FY2022, etc. null when the
   * period won't parse.
   */
  fiscal_year: number | null;
  /** Collections in USD. null when value is missing / unparseable. */
  gross_collections_usd: number | null;
  /**
   * True when the period falls in Lee County's post-Hurricane-Ian window
   * (FY2023 or later — Ian landfall 2022-09-28, which is the first month of
   * FY2023 for Florida's October-start fiscal year).
   */
  post_ian: boolean;
}

// ---------------------------------------------------------------------
// Defensive coercion — Supabase + PostgREST can return numeric / money as
// strings (with $ and commas), dates as date or text, fiscal_year as int or
// text. We accept all of those and normalize.
// ---------------------------------------------------------------------

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function numericOrMoney(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "");
    if (cleaned === "") return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Florida fiscal year from a normalized "YYYY-MM" period. FL FY starts Oct 1,
 * so months 10-12 of year Y belong to FY (Y+1); months 1-9 of year Y belong
 * to FY Y. Returns null when the period string doesn't parse cleanly.
 */
function fiscalYearFromPeriod(periodYyyymm: string): number | null {
  if (periodYyyymm.length < 7) return null;
  const y = parseInt(periodYyyymm.slice(0, 4), 10);
  const m = parseInt(periodYyyymm.slice(5, 7), 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return m >= 10 ? y + 1 : y;
}

/**
 * Coerce collection_month to "YYYY-MM". Accepts ISO dates (YYYY-MM-DD), partial
 * ISO (YYYY-MM), or free-text like "October 2023". Returns "" when nothing
 * parses — caller logs the raw value and the row is excluded from time-series
 * math but still appears in citation provenance.
 */
function normalizePeriod(v: unknown): string {
  const raw = str(v);
  if (raw === "") return "";
  // Fast path: YYYY-MM-DD or YYYY-MM.
  const iso = raw.match(/^(\d{4})-(\d{1,2})/);
  if (iso) {
    const yy = iso[1];
    const mm = iso[2].padStart(2, "0");
    return `${yy}-${mm}`;
  }
  // Slow path: hand off to Date for textual months like "October 2023".
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    const yy = d.getUTCFullYear().toString();
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    return `${yy}-${mm}`;
  }
  return "";
}

/**
 * Lee County's post-Hurricane-Ian window. Ian made landfall 2022-09-28; the
 * first hospitality reporting period to fully capture impact is FY2023 (which
 * for Florida's Oct-start fiscal year begins October 2022). We use fiscal_year
 * when available and fall back to the parsed period.
 */
function isPostIan(fiscalYear: number | null, periodYyyymm: string): boolean {
  if (fiscalYear !== null) return fiscalYear >= 2023;
  if (periodYyyymm.length >= 7) {
    const [yy, mm] = periodYyyymm.split("-");
    const y = parseInt(yy, 10);
    const m = parseInt(mm, 10);
    if (Number.isFinite(y) && Number.isFinite(m)) {
      // FY2023 begins October 2022.
      return y > 2022 || (y === 2022 && m >= 10);
    }
  }
  return false;
}

export function normalizeTdtRow(
  row: Record<string, unknown>,
): TourismTdtNormalized {
  const period_yyyymm = normalizePeriod(row.period);
  const fiscal_year = fiscalYearFromPeriod(period_yyyymm);
  return {
    kind: "tdt-collection",
    county: str(row.county) || "Unknown",
    period_yyyymm,
    period_raw: str(row.period),
    fiscal_year,
    gross_collections_usd: numericOrMoney(row.collections_usd),
    post_ian: isPostIan(fiscal_year, period_yyyymm),
  };
}

async function loadFixtureRows(): Promise<Record<string, unknown>[]> {
  const data = JSON.parse(await readFile(FIXTURE_PATH, "utf-8")) as
    | { rows?: unknown[]; data?: unknown[] }
    | unknown[];
  const rows: unknown[] = Array.isArray(data)
    ? data
    : (data.rows ?? data.data ?? []);
  return rows as Record<string, unknown>[];
}

async function fetchTdtRows(): Promise<Record<string, unknown>[]> {
  if (env.source === "fixture") return loadFixtureRows();
  // Explicit column list (no select(*)): the brain-platform readonly role has
  // column-level grants on this table. Named columns must match the live
  // schema exactly — see the header comment for the verified set.
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("id, county, period, collections_usd");
  if (error) {
    throw new Error(
      `tourism-tdt-source: ${TABLE} fetch failed — ${error.message}`,
    );
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    throw new Error(`tourism-tdt-source: ${TABLE} returned 0 rows.`);
  }
  return rows;
}

export const tourismTdtSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1, // FL DOR — primary state-government source
  async fetch(): Promise<RawFragment[]> {
    const rows = await fetchTdtRows();
    const fetched_at = isoTimestamp();
    return rows.map((row): RawFragment<TourismTdtNormalized> => {
      const normalized = normalizeTdtRow(row);
      // Fragment id must be stable. Prefer the row's UUID `id` when present
      // (live mode always has it; fixture rows may omit it, in which case
      // county+period is the next-best stable key).
      const rowId = str(row.id);
      const idKey =
        rowId.length > 0
          ? rowId
          : normalized.period_yyyymm.length > 0
            ? `${normalized.county}:${normalized.period_yyyymm}`
            : `${normalized.county}:${normalized.period_raw}`;
      return {
        fragment_id: fragmentId(SOURCE_ID, idKey),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: row,
        normalized,
      };
    });
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? "Florida DOR — Tourist Development Tax collections (fixture; Lee County, Doc 328)"
          : "Florida DOR — Tourist Development Tax collections (Supabase fl_dor_tdt_collections: id, county, period, collections_usd; Lee County, Doc 328)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
