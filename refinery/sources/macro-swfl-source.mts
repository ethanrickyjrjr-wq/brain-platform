import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * macro-swfl source connector — FRED (Federal Reserve Economic Data) series
 * focused on the macro context an SWFL operator actually cares about:
 * funding rates (SOFR), Florida labor market (FLUR, FLLFPR), and headline
 * inflation (CPI YoY).
 *
 * Trust tier: 1 (FRED is a primary federal source).
 *
 * Live mode (REFINERY_SOURCE != "fixture") would hit the FRED API. Not
 * implemented in v1 — set REFINERY_SOURCE=fixture to use the committed sample.
 * The fixture shape mirrors the FRED REST response field for field, so the
 * swap is a single fetch() rewrite.
 *
 * Single point of schema knowledge for the macro brain.
 */

const SOURCE_ID = "fred_macro";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "macro-swfl.sample.json",
);

/** Normalized macro indicator — what Stage 2 / Stage 3 see. */
export interface MacroSwflNormalized {
  kind: "macro-indicator";
  series_id: string;
  label: string;
  value: number;
  unit: string;
  period: string;
  direction: "rising" | "falling" | "stable";
  context: string;
}

function isDirection(s: unknown): s is MacroSwflNormalized["direction"] {
  return s === "rising" || s === "falling" || s === "stable";
}

function normalize(row: Record<string, unknown>): MacroSwflNormalized {
  const direction = isDirection(row.direction) ? row.direction : "stable";
  return {
    kind: "macro-indicator",
    series_id: String(row.series_id ?? ""),
    label: String(row.label ?? ""),
    value: Number(row.value),
    unit: String(row.unit ?? ""),
    period: String(row.period ?? ""),
    direction,
    context: String(row.context ?? ""),
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

export const macroSwflSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1, // FRED = Federal Reserve, primary federal source
  async fetch(): Promise<RawFragment[]> {
    if (env.source !== "fixture") {
      throw new Error(
        "macro-swfl-source: live FRED API path is not yet implemented. " +
          "Set REFINERY_SOURCE=fixture to use the committed sample, or wire up " +
          "the FRED REST endpoint in this fetch() (the fixture mirrors the API shape).",
      );
    }
    const rows = await loadFixtureRows();
    const fetched_at = isoTimestamp();
    return rows.map((row): RawFragment<MacroSwflNormalized> => {
      const normalized = normalize(row);
      return {
        fragment_id: fragmentId(SOURCE_ID, normalized.series_id),
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
        "FRED — Federal Reserve Economic Data (SOFR, FLUR, CPIAUCSL_YOY, FLLFPR)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
