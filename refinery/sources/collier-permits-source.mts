import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";
import {
  isPermitBucket,
  type NormalizedPermitRow,
  type PermitBucket,
} from "./permits-source.mts";

const SOURCE_ID = "collier_building_permits";
// Collier publishes the building-permit XLSX monthly. The pack-level TTL stays
// daily (driven by Lee), but the source-level citation expiry tracks the
// actual publication cadence.
const TTL_SECONDS = 2592000; // 30 days

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "__fixtures__",
  "permits-collier.sample.json",
);

const PORTAL_URL =
  "https://www.colliercountyfl.gov/Business-Resources/Building-Permits-Construction/Meetings-Advisory-Boards-Reports/Monthly-Building-Permit-Reports";
const LIVE_CITATION =
  "Collier County Building Permits — monthly XLSX reports (data_lake.collier_building_permits), scraped via Firecrawl stealth proxy + geocoded via Census batch API.";

/**
 * Raw row shape returned by the Supabase SELECT against
 * `data_lake.collier_building_permits`. Only the columns the pack and the
 * normalizer need are pulled — owner_* and contractor_* fields stay in the
 * lake but never reach the brain.
 *
 * Nullability matches the DDL (`docs/sql/20260527_collier_building_permits.sql`):
 *  - `bucket` is nullable (Lee's is NOT NULL; pack drops NULL-bucket rows + caveats).
 *  - `date_issued` is nullable (Lee's `issued_date` is NOT NULL; same drop + caveat).
 *  - `lat`/`lon` are nullable (Census batch geocoder no-matches).
 *  - `corridor` is nullable (geocoder stamps it at ingest, but the pack
 *    re-routes via lat/lon using the unified centroids fixture — this column
 *    is informational only as far as the brain is concerned).
 */
interface CollierDbRow {
  permit_number: string;
  declared_value: number | null;
  permit_type_desc: string | null;
  permit_status: string | null;
  site_address: string | null;
  date_issued: string | null;
  lat: number | null;
  lon: number | null;
  bucket: PermitBucket | null;
  building_type: string | null;
  permit_class: string | null;
  const_type: string | null;
}

/**
 * Dropped-row counters. Reset at the top of each `fetch()` and exported as a
 * snapshot via `getDroppedRowCounts()` so the pack can include them in
 * caveats during `outputProducer()`. Module-level state mirrors the
 * `lastSnapshot` / `lastFetchedAt` pattern in `permits-swfl.mts`.
 */
let droppedNullBucket = 0;
let droppedNullDate = 0;

export function getCollierDroppedRowCounts(): {
  nullBucket: number;
  nullDate: number;
} {
  return { nullBucket: droppedNullBucket, nullDate: droppedNullDate };
}

async function fetchFromSupabase(): Promise<CollierDbRow[]> {
  // Same 448-day window as Lee — z-score baseline depends on the window math,
  // not the publication cadence. Collier will simply yield fewer rows.
  const sinceIso = new Date(Date.now() - 448 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await getSupabase()
    .schema("data_lake")
    .from("collier_building_permits")
    .select(
      "permit_number, declared_value, permit_type_desc, permit_status, site_address, date_issued, lat, lon, bucket, building_type, permit_class, const_type",
    )
    .gte("date_issued", sinceIso)
    .order("date_issued", { ascending: true });
  if (error) {
    throw new Error(
      `collier-permits-source: Supabase fetch failed — ${error.message}`,
    );
  }
  return (data ?? []) as CollierDbRow[];
}

async function fetchFromFixture(): Promise<CollierDbRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as CollierDbRow[];
}

function mapCollierRow(row: CollierDbRow): NormalizedPermitRow | null {
  if (!row.date_issued) {
    droppedNullDate += 1;
    return null;
  }
  if (!isPermitBucket(row.bucket)) {
    droppedNullBucket += 1;
    return null;
  }
  const descParts = [row.building_type, row.permit_class, row.const_type];
  const permit_description_raw =
    descParts.filter((s): s is string => Boolean(s)).join(" ") || null;
  return {
    permit_uid: `collier:${row.permit_number}`,
    county: "collier",
    issued_date: row.date_issued,
    bucket: row.bucket,
    address: row.site_address,
    zip_code: null, // Collier table has no zip_code column.
    lat: row.lat,
    lon: row.lon,
    declared_value_usd: row.declared_value,
    status: row.permit_status,
    permit_type_raw: row.permit_type_desc,
    permit_description_raw,
  };
}

export const collierPermitsSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,
  async fetch(): Promise<RawFragment[]> {
    droppedNullBucket = 0;
    droppedNullDate = 0;
    const fetched_at = isoTimestamp();
    const rows =
      env.source === "fixture"
        ? await fetchFromFixture()
        : await fetchFromSupabase();

    const fragments: RawFragment<NormalizedPermitRow>[] = [];
    for (const r of rows) {
      const n = mapCollierRow(r);
      if (!n) continue;
      fragments.push({
        fragment_id: fragmentId(SOURCE_ID, r.permit_number),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: {
          permit_number: r.permit_number,
          date_issued: r.date_issued,
          bucket: r.bucket,
        },
        normalized: n,
      });
    }
    return fragments;
  },
  citationMeta(
    verifiedDate: string,
    ttlSeconds: number,
  ): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? `Collier County building permits (fixture)`
          : `${LIVE_CITATION} Portal: ${PORTAL_URL}.`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};

export {
  TTL_SECONDS as COLLIER_PERMITS_TTL_SECONDS,
  PORTAL_URL as COLLIER_PORTAL_URL,
};
