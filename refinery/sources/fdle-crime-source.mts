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
 * fdle-crime source — FDLE UCR property crime counts for Lee + Collier counties.
 *
 * Table: public.fdle_crime_swfl (self-ingested via ingest/pipelines/fdle_crime_swfl,
 * GHA cron quarterly via fdle-crime-quarterly.yml).
 *
 * Columns read:
 *   county                TEXT         -- 'Lee' | 'Collier'
 *   period                DATE         -- first day of calendar year (e.g. 2024-01-01)
 *   data_year             INTEGER      -- 4-digit year
 *   burglary              INTEGER
 *   larceny_theft         INTEGER
 *   motor_vehicle_theft   INTEGER
 *   arson                 INTEGER
 *   total_property_crimes INTEGER      -- sum of above 4 Part I property offenses
 *   population            INTEGER
 *   property_crime_per_1k NUMERIC(8,2) -- total_property_crimes / population * 1000
 *   source_url            TEXT
 *
 * Window: last 3 years — enough for 2 YoY comparisons.
 *
 * Trust tier: 1 (FDLE is a Florida state law enforcement agency — primary source).
 */

const SOURCE_ID = "fdle_crime_swfl";
const TABLE = "fdle_crime_swfl";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "safety-swfl.sample.json",
);

/** One normalized row from fdle_crime_swfl. */
export interface FdleCrimeNormalized {
  kind: "fdle-crime";
  county: string;
  data_year: number;
  period_raw: string;
  burglary: number | null;
  larceny_theft: number | null;
  motor_vehicle_theft: number | null;
  arson: number | null;
  total_property_crimes: number | null;
  population: number | null;
  property_crime_per_1k: number | null;
  source_url: string;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n =
    typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toYear(v: unknown): number {
  const s = str(v);
  const m = s.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : 0;
}

function normalize(row: Record<string, unknown>): FdleCrimeNormalized | null {
  const county = str(row.county);
  if (!county) return null;
  const period_raw = str(row.period);
  const data_year =
    toYear(period_raw) || (toNum(row.data_year) as number) || 0;
  if (!data_year) return null;
  return {
    kind: "fdle-crime",
    county,
    data_year,
    period_raw,
    burglary: toNum(row.burglary),
    larceny_theft: toNum(row.larceny_theft),
    motor_vehicle_theft: toNum(row.motor_vehicle_theft),
    arson: toNum(row.arson),
    total_property_crimes: toNum(row.total_property_crimes),
    population: toNum(row.population),
    property_crime_per_1k: toNum(row.property_crime_per_1k),
    source_url:
      str(row.source_url) ||
      "https://www.fdle.state.fl.us/FSAC/Crime-Data/UCR-Data-Archive.aspx",
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
  cutoff.setFullYear(cutoff.getFullYear() - 3);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select(
      "county, period, data_year, burglary, larceny_theft, motor_vehicle_theft, " +
        "arson, total_property_crimes, population, property_crime_per_1k, source_url",
    )
    .gte("period", cutoffDate)
    .order("period", { ascending: false });
  if (error) {
    throw new Error(
      `fdle-crime-source: ${TABLE} query failed — ${error.message}`,
    );
  }
  return (data ?? []) as Record<string, unknown>[];
}

export const fdleCrimeSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,
  async fetch(): Promise<RawFragment[]> {
    const rows = await fetchRows();
    const fetched_at = isoTimestamp();
    const receipt =
      env.source === "fixture"
        ? `fixture://refinery/__fixtures__/safety-swfl.sample.json`
        : buildSourceCitationUrl(TABLE, {
            label: "FDLE UCR Property Crime — Lee + Collier Counties",
            source: "FDLE FSAC",
            brain: "safety-swfl",
            date_col: "period",
          });
    return rows
      .map((row): RawFragment<FdleCrimeNormalized> | null => {
        const normalized = normalize(row);
        if (!normalized) return null;
        if (!normalized.source_url) normalized.source_url = receipt;
        return {
          fragment_id: fragmentId(
            SOURCE_ID,
            `${normalized.county}-${normalized.data_year}`,
          ),
          source_id: SOURCE_ID,
          source_trust_tier: 1,
          fetched_at,
          raw: row,
          normalized,
        };
      })
      .filter((f): f is RawFragment<FdleCrimeNormalized> => f !== null);
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? "FDLE UCR Property Crime — Lee + Collier Counties (fixture; fdle_crime_swfl)"
          : "FDLE Uniform Crime Report — Property Crime by County (Supabase fdle_crime_swfl: " +
            "Lee + Collier; annual UCR data; quarterly ingest cadence; ~6–9 month publication lag)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
