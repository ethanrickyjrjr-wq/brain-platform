import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * CRE pack source connector — Supabase `corridor_profiles` (verified, non-deleted).
 *
 * THIS IS THE ONLY FILE THAT KNOWS THE corridor_profiles SCHEMA. Column names
 * were confirmed by a live schema dump (2026-05-14).
 *
 * CRE v1 is corridor-intelligence-only. A Sanity `promptRule` source was
 * scoped originally, but the lpyl3q9w `promptRule` docs turned out to be
 * premise-engine RLAIF Phase D training proposals (mostly unapproved/inactive)
 * — synthesis-engine internals, not broker intelligence — so they were dropped
 * from v1. `sources/sanity.mts` is kept for whenever a real Sanity source lands.
 */

const CORRIDOR_SOURCE_ID = "corridor_profiles";
const CORRIDOR_FIXTURE = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "corridor-profiles.sample.json",
);

/**
 * City -> county map for SWFL. `corridor_profiles` has `city` but no `county`
 * column; county is derived here. Confirmed mapping: Naples = Collier, every
 * other city in the corpus = Lee (15 Lee / 9 Collier across the 24 corridors).
 */
const CITY_TO_COUNTY: Record<string, "Lee" | "Collier"> = {
  Naples: "Collier",
  "Fort Myers": "Lee",
  "Cape Coral": "Lee",
  Estero: "Lee",
  "Bonita Springs": "Lee",
  "Fort Myers Beach": "Lee",
};
function cityToCounty(city: string): "Lee" | "Collier" | "Unknown" {
  return CITY_TO_COUNTY[city] ?? "Unknown";
}

/** One `active_flags` entry — the de-facto "hidden truths" / ground-truth intel layer. */
export interface CorridorFlag {
  flag: string;
  type: string;
  status: string | null;
  resolution: string | null;
}

/** Normalized corridor-profile fragment. */
export interface CorridorNormalized {
  kind: "corridor";
  name: string;
  city: string;
  county: "Lee" | "Collier" | "Unknown";
  corridor_type: string;
  /** 0-1 — pass-through, do NOT scale */
  seasonal_index: number | null;
  character: string | null;
  evolution_direction: string | null;
  tenant_mix: string | null;
  flags: CorridorFlag[];
  source_url: string | null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeFlags(raw: unknown): CorridorFlag[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (f): f is Record<string, unknown> => f != null && typeof f === "object",
    )
    .map((f) => ({
      flag: str(f.flag) ?? "",
      type: str(f.type) ?? "unknown",
      status: str(f.status),
      resolution: str(f.resolution),
    }))
    .filter((f) => f.flag.length > 0);
}

/** Map a raw `corridor_profiles` row -> CorridorNormalized. Single point of schema knowledge. */
export function normalizeCorridor(
  row: Record<string, unknown>,
): CorridorNormalized {
  const city = str(row.city) ?? "";
  return {
    kind: "corridor",
    name: str(row.corridor_name) ?? "",
    city,
    county: cityToCounty(city),
    corridor_type: str(row.corridor_type) ?? "unknown",
    seasonal_index: num(row.seasonal_index),
    character: str(row.character),
    evolution_direction: str(row.evolution_direction),
    tenant_mix: str(row.tenant_mix),
    flags: normalizeFlags(row.active_flags),
    source_url: str(row.source_url),
  };
}

/** Load a fixture file, unwrapping the `{ __meta, rows }` wrapper to a plain array. */
async function loadFixtureRows(
  fixturePath: string,
): Promise<Record<string, unknown>[]> {
  const data = JSON.parse(await readFile(fixturePath, "utf-8")) as
    | { rows?: unknown[]; data?: unknown[] }
    | unknown[];
  const rows: unknown[] = Array.isArray(data)
    ? data
    : (data.rows ?? data.data ?? []);
  return rows as Record<string, unknown>[];
}

// --- corridor profiles (Supabase) ---

async function fetchCorridorRows(): Promise<Record<string, unknown>[]> {
  if (env.source === "fixture") return loadFixtureRows(CORRIDOR_FIXTURE);
  const { data, error } = await getSupabase()
    .from("corridor_profiles")
    .select("*")
    .is("deleted_at", null)
    .eq("verification_status", "verified");
  if (error) {
    throw new Error(
      `cre-source: corridor_profiles fetch failed — ${error.message}`,
    );
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    throw new Error("cre-source: corridor_profiles returned 0 verified rows.");
  }
  return rows;
}

export const corridorSource: SourceConnector = {
  source_id: CORRIDOR_SOURCE_ID,
  async fetch(): Promise<RawFragment[]> {
    const rows = await fetchCorridorRows();
    const fetched_at = isoTimestamp();
    return rows.map((row): RawFragment<CorridorNormalized> => {
      const normalized = normalizeCorridor(row);
      return {
        fragment_id: fragmentId(
          CORRIDOR_SOURCE_ID,
          normalized.name || JSON.stringify(row),
        ),
        source_id: CORRIDOR_SOURCE_ID,
        source_trust_tier: 2, // verified editorial intelligence
        fetched_at,
        raw: row,
        normalized,
      };
    });
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        "SWFL CRE corridor profiles — Supabase corridor_profiles (verified, non-deleted)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
