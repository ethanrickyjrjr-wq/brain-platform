import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * collier-parcels source connector — Collier County parcel snapshot from the
 * FDOR Statewide Cadastral (the FL tax roll in GIS form), filtered to CO_NO=21.
 *
 * Gives properties-collier-value the two things the Redfin market source cannot:
 * the Save-Our-Homes gap and a true parcel count. 364k parcels is too many to
 * pull per refinery run, so the aggregation lives in data_lake.collier_parcels_summary
 * (1 row) — this connector reads that view directly.
 *
 * Trust tier: 2 (state govt tax roll, annual snapshot).
 *
 * SOH gap = median (jv_hmstd - av_hmstd)/jv_hmstd across homesteaded parcels —
 * the homestead-portion Save-Our-Homes differential.
 */

const SOURCE_ID = "collier_parcels_fdor";
const SCHEMA = "data_lake";
const PARCELS_TABLE = "collier_parcels";
const SUMMARY_VIEW = "collier_parcels_summary";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "properties-collier-parcels.sample.json",
);

/** A parcel row (only the value fields the SOH gap needs); fixture mode only. */
interface ParcelRow {
  jv_hmstd: number | null;
  av_hmstd: number | null;
}

/** Snapshot summary fragment — total parcels + SOH gap median + homestead count. */
export interface CollierParcelsSummaryNormalized {
  kind: "collier-parcels-summary";
  total_parcels: number;
  soh_homesteaded_parcels: number;
  soh_gap_median_pct: number | null;
}

interface FixtureShape {
  _meta?: Record<string, unknown>;
  parcels: ParcelRow[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Aggregate raw parcels into the shape the live summary view returns. Fixture only. */
export function aggregateFromParcels(
  parcels: ParcelRow[],
): CollierParcelsSummaryNormalized {
  const gaps: number[] = [];
  let homesteaded = 0;
  for (const p of parcels) {
    const jvh = p.jv_hmstd ?? 0;
    const avh = p.av_hmstd ?? 0;
    if (jvh > 0) {
      homesteaded += 1;
      gaps.push(((jvh - avh) / jvh) * 100);
    }
  }
  return {
    kind: "collier-parcels-summary",
    total_parcels: parcels.length,
    soh_homesteaded_parcels: homesteaded,
    soh_gap_median_pct: median(gaps),
  };
}

async function loadFixture(): Promise<CollierParcelsSummaryNormalized> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as FixtureShape;
  return aggregateFromParcels(data.parcels);
}

async function fetchLive(): Promise<CollierParcelsSummaryNormalized> {
  const sb = getSupabase().schema(SCHEMA);
  const resp = await sb
    .from(SUMMARY_VIEW)
    .select("total_parcels,soh_homesteaded_parcels,soh_gap_median_pct")
    .single();
  if (resp.error) {
    throw new Error(
      `collier-parcels-source: ${SCHEMA}.${SUMMARY_VIEW} query failed — ${resp.error.message}. ` +
        "Confirm python -m ingest.pipelines.collier_parcels.pipeline ran and " +
        "docs/sql/collier_parcels_grant.sql was applied.",
    );
  }
  const r = resp.data as {
    total_parcels: number;
    soh_homesteaded_parcels: number;
    soh_gap_median_pct: number | string | null;
  };
  // percentile_cont can return a numeric string via PostgREST.
  const gapVal =
    typeof r.soh_gap_median_pct === "string"
      ? parseFloat(r.soh_gap_median_pct)
      : r.soh_gap_median_pct;
  return {
    kind: "collier-parcels-summary",
    total_parcels: r.total_parcels,
    soh_homesteaded_parcels: r.soh_homesteaded_parcels,
    soh_gap_median_pct: gapVal == null || Number.isNaN(gapVal) ? null : gapVal,
  };
}

export const collierParcelsSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,
  async fetch(): Promise<RawFragment[]> {
    const summary =
      env.source === "fixture" ? await loadFixture() : await fetchLive();
    const fetched_at = isoTimestamp();
    return [
      {
        fragment_id: fragmentId(SOURCE_ID, "parcels-summary"),
        source_id: SOURCE_ID,
        source_trust_tier: 2,
        fetched_at,
        raw: {
          total_parcels: summary.total_parcels,
          soh_homesteaded_parcels: summary.soh_homesteaded_parcels,
        },
        normalized: summary,
      },
    ];
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    const liveUrl =
      env.source === "live" && env.supabaseUrl
        ? `${env.supabaseUrl}/rest/v1/${SUMMARY_VIEW}?select=total_parcels,soh_homesteaded_parcels,soh_gap_median_pct`
        : `fixture://refinery/__fixtures__/properties-collier-parcels.sample.json`;
    return {
      source:
        env.source === "fixture"
          ? `FDOR Statewide Cadastral — Collier parcels (fixture; ${SCHEMA}.${PARCELS_TABLE}, CO_NO=21) — ${liveUrl}`
          : `FDOR Statewide Cadastral — Collier County parcels via ${SCHEMA}.${PARCELS_TABLE} (ArcGIS FeatureServer, CO_NO=21; Save-Our-Homes gap pre-aggregated through ${SUMMARY_VIEW}) — ${liveUrl}`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
