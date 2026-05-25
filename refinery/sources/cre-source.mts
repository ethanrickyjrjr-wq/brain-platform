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

/**
 * Broker-narrative payload stored in `corridor_profiles.character_broker_narrative`
 * (JSONB), populated quarterly by the n8n Firecrawl flow (Part 3 of the
 * 2026-05-25 firecrawl-pipeline plan). Kept structurally distinct from the
 * hand-authored `character` TEXT column — the hand-authored field is quoted
 * verbatim and never overwritten; broker narrative is layered on top.
 */
export interface CorridorBrokerNarrative {
  /** Reporting quarter, e.g. "2026-Q3". */
  quarter: string;
  /** Broker's view of how the corridor positions in the market. Primary signal. */
  market_positioning: string | null;
  /** Optional tenant-mix observations from the broker report. */
  dominant_tenant_types: string | null;
  /** Optional development-pipeline notes (new projects, expirations, vacancies). */
  development_pipeline_notes: string | null;
}

/** Cap-rate / vacancy direction — matches BrainOutputMetric.direction exactly. */
export type CorridorMetricDirection = "rising" | "falling" | "stable";

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
  /** Per-metric source overrides. Fallback: metric_source_url ?? source_url ?? null. */
  cap_rate_source_url: string | null;
  vacancy_rate_source_url: string | null;
  absorption_sqft_source_url: string | null;
  asking_rent_psf_source_url: string | null;
  /** Cap rate %, 0-30 (DB CHECK enforces). Null = not yet sourced. */
  cap_rate_pct: number | null;
  /** Editorial direction set when the value is entered. Null = no read. */
  cap_rate_direction: CorridorMetricDirection | null;
  /** Vacancy rate %, 0-100. Null = not yet sourced. */
  vacancy_rate_pct: number | null;
  vacancy_rate_direction: CorridorMetricDirection | null;
  /** Net Absorption sqft. Null = not yet sourced. */
  absorption_sqft: number | null;
  absorption_sqft_direction: CorridorMetricDirection | null;
  /** Average Asking Rent PSF (NNN). Null = not yet sourced. */
  asking_rent_psf: number | null;
  asking_rent_psf_direction: CorridorMetricDirection | null;
  /** e.g. "2026-Q1" — the period the metrics describe. */
  metrics_period: string | null;
  /** ISO date the metrics were last sourced. */
  metrics_verified_date: string | null;
  /**
   * Quarterly broker-narrative payload from the n8n Firecrawl flow. Null when
   * the column is empty (the default state for every corridor pre-Flow-3).
   */
  character_broker_narrative: CorridorBrokerNarrative | null;
  /**
   * Derived per-corridor narrative the pack's synthesisContext instructs the
   * LLM to quote verbatim. Resolves the three cases:
   *   - both `character` and a broker positioning string present → character
   *     verbatim, then "\n\nBroker positioning ({Qn YYYY}): {positioning}".
   *   - only broker positioning present → just the broker prefix line.
   *   - only `character` present → character verbatim (no change to today).
   *   - neither → null.
   * The hand-authored `character` column is never overwritten — the broker
   * narrative is layered on top.
   */
  character_render: string | null;
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

function metricDirection(v: unknown): CorridorMetricDirection | null {
  const s = str(v);
  if (s === "rising" || s === "falling" || s === "stable") return s;
  return null;
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

/**
 * Coerce a raw JSONB value into a CorridorBrokerNarrative or null. Tolerates
 * Supabase returning either an already-parsed object or a JSON string (some
 * PostgREST configurations).
 */
export function normalizeBrokerNarrative(
  raw: unknown,
): CorridorBrokerNarrative | null {
  let obj: Record<string, unknown> | null = null;
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed != null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  } else if (typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  }
  if (obj == null) return null;
  const quarter = str(obj.quarter);
  const market_positioning = str(obj.market_positioning);
  const dominant_tenant_types = str(obj.dominant_tenant_types);
  const development_pipeline_notes = str(obj.development_pipeline_notes);
  // A broker narrative without a quarter is unanchored — drop it. Without
  // any of the textual fields it carries no information either.
  if (
    quarter == null ||
    (market_positioning == null &&
      dominant_tenant_types == null &&
      development_pipeline_notes == null)
  ) {
    return null;
  }
  return {
    quarter,
    market_positioning,
    dominant_tenant_types,
    development_pipeline_notes,
  };
}

/**
 * Format a "YYYY-Qn" stored quarter as "Qn YYYY" for display in the broker
 * positioning prefix. Returns the input unchanged if it doesn't match the
 * canonical shape — a defensive fallback so a stray format doesn't crash
 * the render.
 */
export function formatQuarterForDisplay(quarter: string): string {
  const m = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return quarter;
  return `Q${m[2]} ${m[1]}`;
}

/**
 * Compose the derived `character_render` field per the Part-6b consumer rules:
 *   - both character + broker positioning → "{character}\n\nBroker positioning ({Qn YYYY}): {positioning}"
 *   - only broker positioning            → "Broker positioning ({Qn YYYY}): {positioning}"
 *   - only character                     → character verbatim
 *   - neither                            → null
 *
 * The hand-authored `character` is NEVER mutated — broker narrative is
 * appended after it, not in place of it.
 */
export function composeCharacterRender(
  character: string | null,
  narrative: CorridorBrokerNarrative | null,
): string | null {
  const brokerLine =
    narrative != null && narrative.market_positioning != null
      ? `Broker positioning (${formatQuarterForDisplay(narrative.quarter)}): ${narrative.market_positioning}`
      : null;
  if (character != null && brokerLine != null) {
    return `${character}\n\n${brokerLine}`;
  }
  if (brokerLine != null) return brokerLine;
  return character;
}

/** Map a raw `corridor_profiles` row -> CorridorNormalized. Single point of schema knowledge. */
export function normalizeCorridor(
  row: Record<string, unknown>,
): CorridorNormalized {
  const city = str(row.city) ?? "";
  const character = str(row.character);
  const character_broker_narrative = normalizeBrokerNarrative(
    row.character_broker_narrative,
  );
  return {
    kind: "corridor",
    name: str(row.corridor_name) ?? "",
    city,
    county: cityToCounty(city),
    corridor_type: str(row.corridor_type) ?? "unknown",
    seasonal_index: num(row.seasonal_index),
    character,
    evolution_direction: str(row.evolution_direction),
    tenant_mix: str(row.tenant_mix),
    flags: normalizeFlags(row.active_flags),
    source_url: str(row.source_url),
    cap_rate_source_url: str(row.cap_rate_source_url),
    vacancy_rate_source_url: str(row.vacancy_rate_source_url),
    absorption_sqft_source_url: str(row.absorption_sqft_source_url),
    asking_rent_psf_source_url: str(row.asking_rent_psf_source_url),
    cap_rate_pct: num(row.cap_rate_pct),
    cap_rate_direction: metricDirection(row.cap_rate_direction),
    vacancy_rate_pct: num(row.vacancy_rate_pct),
    vacancy_rate_direction: metricDirection(row.vacancy_rate_direction),
    absorption_sqft: num(row.absorption_sqft),
    absorption_sqft_direction: metricDirection(row.absorption_sqft_direction),
    asking_rent_psf: num(row.asking_rent_psf),
    asking_rent_psf_direction: metricDirection(row.asking_rent_psf_direction),
    metrics_period: str(row.metrics_period),
    metrics_verified_date: str(row.metrics_verified_date),
    character_broker_narrative,
    character_render: composeCharacterRender(
      character,
      character_broker_narrative,
    ),
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
  trust_tier: 2, // verified editorial intelligence (curated corridor profiles)
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
