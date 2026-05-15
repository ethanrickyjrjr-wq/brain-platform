import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * sector-credit-swfl source — `sba_loans_by_naics_county` materialized view.
 *
 * Live shape (from premise-engine's 20260509190000_sba_loans_schema.sql):
 *   project_county   text    -- "Lee" | "Collier" | ...
 *   project_state    text
 *   naics_code       text
 *   naics_description text
 *   approval_fy      int
 *   n_loans          int     (TOTAL loans incl. still-active)
 *   total_approved   numeric
 *   n_chargeoffs     int
 *   n_paid_in_full   int
 *   chargeoff_pct    numeric (charge-offs / TOTAL — includes still-active loans)
 *   total_chargeoff_amount numeric
 *
 * We DO NOT use `chargeoff_pct` directly — it is computed against ALL loans,
 * including still-active ones, which UNDERSTATES the actual sector risk.
 * Instead we recompute on the resolved-loan denominator the same way the
 * franchise-outcomes brain does: `n_chargeoffs / (n_chargeoffs + n_paid_in_full)`.
 * Same convention across the lake, so two finance brains can be read together.
 *
 * SWFL filter: `project_county IN ('Lee', 'Collier')`. The MV is already
 * scoped to is_swfl = TRUE upstream, but we keep this explicit so the source
 * still works against the raw `sba_loans` table if the MV is dropped.
 *
 * Trust tier: 1 (SBA = federal agency, primary source).
 */

const SOURCE_ID = "sba_loans_by_naics_county";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "sector-credit-swfl.sample.json",
);

/** Display-cased SWFL county names — what surfaces to the brain consumer. */
const SWFL_COUNTIES = ["Lee", "Collier"] as const;
type SwflCounty = (typeof SWFL_COUNTIES)[number];

/**
 * The live MV stores `project_county` in UPPER CASE ("LEE", "COLLIER"); the
 * franchise-outcomes RPC normalizes to title case before returning, but this
 * MV does not. We query in UPPER and title-case on the way in so the rest of
 * the lake sees the consistent "Lee" / "Collier" form.
 */
const SWFL_COUNTIES_LIVE = ["LEE", "COLLIER"] as const;
const TITLE_CASE_BY_UPPER: Record<string, SwflCounty> = {
  LEE: "Lee",
  COLLIER: "Collier",
};

/** One detail-level MV row → one normalized fragment. */
export interface SectorCreditNormalized {
  kind: "sector-credit-row";
  project_county: SwflCounty;
  naics_code: string;
  /** 2-digit NAICS prefix — the major-sector grouping the brain rolls up to */
  naics_2digit: string;
  naics_description: string;
  approval_fy: number;
  n_loans: number;
  n_chargeoffs: number;
  n_paid_in_full: number;
  total_approved: number;
  /** Charge-offs / (charge-offs + paid-in-full). null when nothing resolved yet. */
  chargeoff_rate_resolved: number | null;
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isSwflCounty(s: string): s is SwflCounty {
  return s === "Lee" || s === "Collier";
}

function normalize(
  row: Record<string, unknown>,
): SectorCreditNormalized | null {
  const countyRawUpper = String(row.project_county ?? "")
    .trim()
    .toUpperCase();
  const countyRaw = TITLE_CASE_BY_UPPER[countyRawUpper] ?? countyRawUpper;
  if (!isSwflCounty(countyRaw)) return null;
  const naicsCode = String(row.naics_code ?? "").trim();
  if (!naicsCode) return null;
  const n_chargeoffs = toNum(row.n_chargeoffs);
  const n_paid_in_full = toNum(row.n_paid_in_full);
  const resolved = n_chargeoffs + n_paid_in_full;
  return {
    kind: "sector-credit-row",
    project_county: countyRaw,
    naics_code: naicsCode,
    naics_2digit: naicsCode.slice(0, 2),
    naics_description: String(row.naics_description ?? "").trim(),
    approval_fy: toNum(row.approval_fy),
    n_loans: toNum(row.n_loans),
    n_chargeoffs,
    n_paid_in_full,
    total_approved: toNum(row.total_approved),
    chargeoff_rate_resolved:
      resolved === 0 ? null : (n_chargeoffs / resolved) * 100,
  };
}

async function loadFixtureRows(): Promise<Record<string, unknown>[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as
    | { rows?: unknown[]; data?: unknown[] }
    | unknown[];
  const rows: unknown[] = Array.isArray(data)
    ? data
    : (data.rows ?? data.data ?? []);
  return rows as Record<string, unknown>[];
}

async function fetchRows(): Promise<Record<string, unknown>[]> {
  if (env.source === "fixture") return loadFixtureRows();

  // Live: query the MV directly. Recent 6 fiscal years keeps the corpus to
  // the post-COVID window where loan-status data is mature enough to compute
  // resolved-rate denominators.
  const currentFy = new Date().getUTCFullYear();
  const sinceFy = currentFy - 6;
  const { data, error } = await getSupabase()
    .from(SOURCE_ID)
    .select("*")
    .in("project_county", [...SWFL_COUNTIES_LIVE])
    .gte("approval_fy", sinceFy);
  if (error) {
    throw new Error(
      `sector-credit-source: ${SOURCE_ID} query failed — ${error.message}`,
    );
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    throw new Error(
      `sector-credit-source: ${SOURCE_ID} returned 0 rows for Lee/Collier since FY ${sinceFy}. ` +
        "If the MV is empty, run REFRESH MATERIALIZED VIEW sba_loans_by_naics_county;",
    );
  }
  return rows;
}

export const sectorCreditSwflSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1, // SBA federal — primary source
  async fetch(): Promise<RawFragment[]> {
    const rows = await fetchRows();
    const fetched_at = isoTimestamp();
    return rows
      .map((row): RawFragment<SectorCreditNormalized> | null => {
        const normalized = normalize(row);
        if (!normalized) return null;
        return {
          fragment_id: fragmentId(
            SOURCE_ID,
            `${normalized.project_county}-${normalized.naics_code}-${normalized.approval_fy}`,
          ),
          source_id: SOURCE_ID,
          source_trust_tier: 1,
          fetched_at,
          raw: row,
          normalized,
        };
      })
      .filter((f): f is RawFragment<SectorCreditNormalized> => f !== null);
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        "SBA 7(a)/504 loan outcomes by NAICS × county × fiscal year — Lee & Collier counties, FL (sba_loans_by_naics_county materialized view)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
