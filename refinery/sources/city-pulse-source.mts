import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * city-pulse source connector — reads non-expired rows from data_lake.city_pulse
 * (Tier 2, written daily by ingest/pipelines/city_pulse). Each row is one
 * citation-backed current-events fact; the pack turns them into key_metrics
 * with per-metric source receipts.
 *
 * Live mode: getSupabase().schema("data_lake").from("city_pulse"), filtered to
 * expires_at > now(). Fixture mode (env.source === "fixture"): loads the JSON
 * fixture at refinery/__fixtures__/city-pulse.sample.json. Returns [] on 0
 * live rows (table is legitimately empty on bootstrap and between cron runs);
 * the pack's empty-guard emits a neutral "no current signals" brain, which
 * prevents a hollow brain without crashing the master rebuild cascade. A real
 * DB failure still throws.
 *
 * THIS IS THE ONLY FILE THAT KNOWS THE data_lake.city_pulse SCHEMA.
 * Columns read (verified against 2026-05-30 migration):
 *   id (bigint PK), city (text), topic (text), fact (text),
 *   source_url (text), source_title (text), cited_text (text),
 *   captured_at (timestamptz), expires_at (timestamptz),
 *   dedup_key (text), run_at (timestamptz).
 *
 * Trust tier: 2 — verified editorial (web_search citations, LLM-distilled,
 * citation-enforced at write time by distill.py's rows_from_extraction).
 */

const SOURCE_ID = "city-pulse";
const SCHEMA = "data_lake";
const TABLE = "city_pulse";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "city-pulse.sample.json",
);

/** Normalized city-pulse row — what Stage 2 / Stage 3 see. */
export interface CityPulseNormalized {
  kind: "city-pulse";
  /** One of the 7 pipeline CITIES (e.g. "Naples", "Cape Coral"). */
  city: string;
  /** Volatility class: breaking | transactions | development | business | structural */
  topic: string;
  /** Distilled claim, numbers verbatim. */
  fact: string;
  /** Backing citation URL — drives the key_metrics source receipt. */
  source_url: string;
  /** Human-readable source title, null when absent. */
  source_title: string | null;
  /** <=150-char span from the web_search citation, null when absent. */
  cited_text: string | null;
  /** ISO timestamp when the capture was taken. */
  captured_at: string;
  /** ISO timestamp when this fact expires (captured_at + TTL(topic)). */
  expires_at: string;
}

// ── Defensive coercion ──────────────────────────────────────────────────────
// Supabase / PostgREST can return text columns as string or null; we accept
// both and normalize to trimmed string or null.

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

// ── Row normalizer ──────────────────────────────────────────────────────────

export function normalizeRow(
  row: Record<string, unknown>,
): CityPulseNormalized {
  return {
    kind: "city-pulse",
    city: str(row.city) || "Unknown",
    topic: str(row.topic) || "structural",
    fact: str(row.fact),
    source_url: str(row.source_url),
    source_title: strOrNull(row.source_title),
    cited_text: strOrNull(row.cited_text),
    captured_at: str(row.captured_at),
    expires_at: str(row.expires_at),
  };
}

// ── Fixture loader ──────────────────────────────────────────────────────────

async function loadFixtureRows(): Promise<Record<string, unknown>[]> {
  const data = JSON.parse(await readFile(FIXTURE_PATH, "utf-8")) as
    | unknown[]
    | { rows?: unknown[]; data?: unknown[] };
  const rows: unknown[] = Array.isArray(data)
    ? data
    : (data.rows ?? data.data ?? []);
  return rows as Record<string, unknown>[];
}

// ── Live fetch ──────────────────────────────────────────────────────────────

async function fetchRows(): Promise<Record<string, unknown>[]> {
  if (env.source === "fixture") return loadFixtureRows();

  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabase()
    .schema(SCHEMA)
    .from(TABLE)
    .select(
      "id, city, topic, fact, source_url, source_title, cited_text, captured_at, expires_at, run_at",
    )
    .gt("expires_at", nowIso);

  if (error) {
    throw new Error(
      `city-pulse-source: ${SCHEMA}.${TABLE} fetch failed — ${error.message}`,
    );
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    // Table is legitimately empty on bootstrap (day 1) and between cron runs.
    // The pack's empty-guard emits a neutral "no current signals" brain —
    // returning [] here lets that guard do its job without crashing the master
    // rebuild cascade. A real DB failure is caught above and still throws.
    return [];
  }
  return rows;
}

// ── Connector export ────────────────────────────────────────────────────────

export const cityPulseSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,

  async fetch(): Promise<RawFragment[]> {
    const rows = await fetchRows();
    const fetched_at = isoTimestamp();
    return rows.map((row): RawFragment<CityPulseNormalized> => {
      const normalized = normalizeRow(row);
      // Prefer the row's numeric id; fall back to a city:topic:fact prefix combo
      // for fixture rows that may not carry a stable id.
      const rowId = str(row.id);
      const idKey =
        rowId.length > 0
          ? rowId
          : `${normalized.city}:${normalized.topic}:${normalized.fact.slice(0, 32)}`;
      return {
        fragment_id: fragmentId(SOURCE_ID, idKey),
        source_id: SOURCE_ID,
        source_trust_tier: 2,
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
          ? "SWFL city pulse (fixture; daily web_search current-events facts via Supabase data_lake.city_pulse)"
          : "SWFL city pulse — daily Anthropic web_search_20250305 current-events facts, LLM-distilled with citation enforcement, via Supabase data_lake.city_pulse (id, city, topic, fact, source_url, source_title, cited_text, captured_at, expires_at, run_at); 7 cities; topic-TTL'd",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
