import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * Franchise Outcomes source connector.
 *
 * THIS IS THE ONLY FILE THAT KNOWS THE sba_loans_franchise_outcomes SCHEMA.
 * Live data comes from a Supabase RPC that aggregates the view per franchise
 * brand. The fixture mirrors the RPC's column shape. normalize() is the single
 * point of schema knowledge — it is the only thing to change if either shape
 * changes.
 */

const SOURCE_ID = "sba_loans_franchise_outcomes";

/**
 * Server-side aggregation RPC (lives in the Supabase database). It groups
 * sba_loans_franchise_outcomes per franchise brand and computes survival_rate /
 * chargeoff_rate on the RESOLVED-loan denominator — paid_in_full / (paid_in_full
 * + chargeoffs) — returning null when a brand has no resolved loans. Output
 * columns: franchise_code, franchise_name, n_loans, total_approved,
 * n_chargeoffs, n_paid_in_full, survival_rate, chargeoff_rate.
 */
const RPC_NAME = "get_franchise_outcomes_aggregated";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "franchise-outcomes.sample.json",
);

/** Deterministic projection of a view/RPC row — the shape Stage 2's fitScore() reads. */
export interface FranchiseNormalized {
  franchise_code: string;
  franchise_name: string;
  /** TOTAL loans for the brand, including still-active ones */
  n_loans: number;
  n_paid_in_full: number;
  n_charged_off: number;
  /** % over RESOLVED loans (paid_in_full + charged_off); null = no resolved loans */
  survival_rate: number | null;
  chargeoff_rate: number | null;
  total_gross_approval: number;
}

/** Coerce a count/amount to a finite number; null/garbage -> 0. */
function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Coerce a rate to a 0-100 number, or null when there is no data.
 * Normalizes both representations: a 0-1 ratio (fixture) and a 0-100
 * percentage (the live RPC) both land at 0-100.
 */
function toRate(v: unknown): number | null {
  if (v == null) return null;
  const raw = typeof v === "string" ? parseFloat(v) : Number(v);
  if (!Number.isFinite(raw)) return null;
  return raw <= 1 ? raw * 100 : raw;
}

/**
 * Map one raw view/RPC row to the normalized shape. The live RPC produces
 * `n_chargeoffs` / `total_approved`; the synthetic fixture uses
 * `n_charged_off` / `total_gross_approval` — both are handled.
 */
export function normalize(row: Record<string, unknown>): FranchiseNormalized {
  const chargedOff =
    "n_charged_off" in row ? row.n_charged_off : row.n_chargeoffs;
  const grossApproval =
    "total_gross_approval" in row
      ? row.total_gross_approval
      : row.total_approved;
  return {
    franchise_code: String(row.franchise_code ?? ""),
    franchise_name: String(row.franchise_name ?? ""),
    n_loans: toNum(row.n_loans),
    n_paid_in_full: toNum(row.n_paid_in_full),
    n_charged_off: toNum(chargedOff),
    survival_rate: toRate(row.survival_rate),
    chargeoff_rate: toRate(row.chargeoff_rate),
    total_gross_approval: toNum(grossApproval),
  };
}

/** Load the fixture file and unwrap the `{ __meta, rows }` wrapper to a plain array. */
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

/** Wrap raw view/RPC rows into RawFragments — shared by the fixture and live paths. */
function rowsToFragments(rows: Record<string, unknown>[]): RawFragment[] {
  const fetched_at = isoTimestamp();
  return rows.map((row) => {
    const normalized = normalize(row);
    const key =
      normalized.franchise_code ||
      normalized.franchise_name ||
      JSON.stringify(row);
    return {
      fragment_id: fragmentId(SOURCE_ID, key),
      source_id: SOURCE_ID,
      source_trust_tier: 1, // SBA = federal agency
      fetched_at,
      raw: row,
      normalized,
    } satisfies RawFragment<FranchiseNormalized>;
  });
}

/**
 * Fetch raw fragments. Fixture mode reads the committed sample; live mode calls
 * the server-side aggregation RPC. Both paths go through rowsToFragments() — the
 * RPC output and the fixture share the column shape normalize() expects.
 */
export async function fetch(): Promise<RawFragment[]> {
  if (env.source === "fixture") {
    return rowsToFragments(await loadFixtureRows());
  }

  const { data, error } = await getSupabase().rpc(RPC_NAME);
  if (error) {
    throw new Error(
      `franchise-source: RPC ${RPC_NAME} failed — ${error.message}`,
    );
  }
  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  if (rows.length === 0) {
    throw new Error(
      `franchise-source: RPC ${RPC_NAME} returned 0 rows. If the materialized ` +
        "view is stale, run: REFRESH MATERIALIZED VIEW sba_loans_franchise_outcomes;",
    );
  }
  return rowsToFragments(rows);
}

/** Citation metadata for this source. Stage 4 assigns the citation `id` (s01...). */
export function citationMeta(
  verifiedDate: string,
  ttlSeconds: number,
): Omit<CitationRow, "id"> {
  return {
    source:
      "SBA 7(a)/504 franchise loan outcomes — Lee & Collier counties, FL (sba_loans_franchise_outcomes)",
    verified: verifiedDate,
    expires: expiresDate(verifiedDate, ttlSeconds),
  };
}

/**
 * The connector. Satisfies SourceConnector (source_id / fetch / citationMeta —
 * what the pipeline consumes) and also carries `id` + `normalize`.
 */
export const franchiseSource: SourceConnector & {
  id: string;
  normalize: typeof normalize;
} = {
  id: "franchise-outcomes",
  source_id: SOURCE_ID,
  fetch,
  normalize,
  citationMeta,
};
