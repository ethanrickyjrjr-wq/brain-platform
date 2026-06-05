import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * NOAA GHCN-Daily rainfall source connector.
 *
 * Live mode: queries data_lake.noaa_ghcn_rainfall (one row per station per
 * year; written by the noaa_ghcn_rainfall ingest pipeline from the AWS Open
 * Data noaa-ghcn-pds S3 mirror). Returns empty in fixture mode — env-swfl
 * degrades gracefully when the fragment is absent.
 *
 * Emits one summary fragment (kind: "ghcn-rainfall-aggregate") consumed by
 * env-swfl for the env_rainfall_swfl_annual_in key_metric.
 *
 * Source: NOAA GHCN-Daily via AWS Open Data (s3://noaa-ghcn-pds, no auth).
 * Anchor stations: USW00012835 (Fort Myers Page Field), USW00012894 (RSW),
 * USW00012897 (Naples Muni), USC00086078 (Naples COOP).
 */

const SOURCE_ID = "noaa_ghcn_rainfall";
const SCHEMA = "data_lake";
const TABLE = "noaa_ghcn_rainfall";

// A station-year with fewer than 300 recorded days is not a "complete year"
// for the annual average. Mirrors the ~90% completeness threshold from the
// plan doc connector spec.
const MIN_DAY_COUNT = 300;

export interface GhcnRainfallAggregate {
  kind: "ghcn-rainfall-aggregate";
  rainfall_swfl_annual_in: number | null;
  rainfall_year: number | null;
  station_count: number;
}

interface GhcnRow {
  station_id: string;
  station_name: string | null;
  county: string | null;
  year: number;
  annual_in: number;
  day_count: number;
}

function computeAggregate(rows: GhcnRow[]): GhcnRainfallAggregate {
  const complete = rows.filter((r) => r.day_count >= MIN_DAY_COUNT);
  if (complete.length === 0) {
    return {
      kind: "ghcn-rainfall-aggregate",
      rainfall_swfl_annual_in: null,
      rainfall_year: null,
      station_count: 0,
    };
  }

  // Use the latest year that has at least one Lee and one Collier station.
  // Fall back to latest year with any data if the bi-county requirement
  // cannot be met (e.g. first load only has one county's data).
  const years = [...new Set(complete.map((r) => r.year))].sort((a, b) => b - a);
  let bestYear = years[0];
  for (const y of years) {
    const yr = complete.filter((r) => r.year === y);
    const hasLee = yr.some((r) => r.county === "Lee");
    const hasCollier = yr.some((r) => r.county === "Collier");
    if (hasLee && hasCollier) {
      bestYear = y;
      break;
    }
  }

  const yearRows = complete.filter((r) => r.year === bestYear);
  const avg = yearRows.reduce((s, r) => s + r.annual_in, 0) / yearRows.length;
  return {
    kind: "ghcn-rainfall-aggregate",
    rainfall_swfl_annual_in: Math.round(avg * 100) / 100,
    rainfall_year: bestYear,
    station_count: yearRows.length,
  };
}

export const noaaGhcnRainfallSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,

  async fetch(): Promise<RawFragment[]> {
    if (env.source === "fixture") {
      return [];
    }
    const fetched_at = isoTimestamp();
    const sb = getSupabase().schema(SCHEMA);
    const { data, error } = await sb
      .from(TABLE)
      .select("station_id,station_name,county,year,annual_in,day_count");
    if (error) throw error;
    const rows = (data ?? []) as GhcnRow[];
    const aggregate = computeAggregate(rows);
    return [
      {
        fragment_id: fragmentId(SOURCE_ID, "ghcn-rainfall-aggregate"),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: { row_count: rows.length },
        normalized: aggregate,
      },
    ];
  },

  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        "NOAA GHCN-Daily via AWS Open Data (s3://noaa-ghcn-pds/csv/by_year/, no auth). " +
        "Anchor stations: USW00012835 Fort Myers Page Field (Lee), USW00012894 RSW (Lee), " +
        "USW00012897 Naples Muni (Collier), USC00086078 Naples COOP (Collier). " +
        "Annual totals: sum of daily PRCP ÷ 254 (tenths-mm → in) for days passing QC; " +
        "SWFL value = average of station totals for the latest complete year (≥300 day-coverage).",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
