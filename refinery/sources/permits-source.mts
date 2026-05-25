import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

const SOURCE_ID = "lee_building_permits";
const TTL_SECONDS = 86400; // daily refresh per spec decision #15

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "__fixtures__",
  "permits-swfl.sample.json",
);

const PORTAL_URL =
  "https://aca-prod.accela.com/LEECO/Cap/CapHome.aspx?module=Permitting&TabName=Permitting";
const LIVE_CITATION =
  "Lee County Accela Citizen Access — building permit records (data_lake.lee_building_permits), scraped daily via Firecrawl.";

export interface LeePermitRow {
  permit_id: string;
  issued_date: string; // ISO YYYY-MM-DD
  permit_type_raw: string | null;
  permit_description_raw: string | null;
  bucket:
    | "commercial_new"
    | "commercial_alteration"
    | "residential"
    | "demolition"
    | "other";
  address: string | null;
  zip_code: string | null;
  lat: number | null;
  lon: number | null;
  declared_value_usd: number | null;
  status: string | null;
}

async function fetchFromSupabase(): Promise<LeePermitRow[]> {
  // Trailing 16 windows x 28 days = 448 days, covering full historical baseline.
  const sinceIso = new Date(Date.now() - 448 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await getSupabase()
    .schema("data_lake")
    .from("lee_building_permits")
    .select(
      "permit_id, issued_date, permit_type_raw, permit_description_raw, bucket, address, zip_code, lat, lon, declared_value_usd, status",
    )
    .gte("issued_date", sinceIso)
    .order("issued_date", { ascending: true });
  if (error) {
    throw new Error(`permits-source: Supabase fetch failed — ${error.message}`);
  }
  return (data ?? []) as LeePermitRow[];
}

async function fetchFromFixture(): Promise<LeePermitRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as LeePermitRow[];
}

export const permitsSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,
  async fetch(): Promise<RawFragment[]> {
    const fetched_at = isoTimestamp();
    const rows =
      env.source === "fixture"
        ? await fetchFromFixture()
        : await fetchFromSupabase();

    return rows.map(
      (r): RawFragment<LeePermitRow> => ({
        fragment_id: fragmentId(SOURCE_ID, r.permit_id),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: {
          permit_id: r.permit_id,
          issued_date: r.issued_date,
          bucket: r.bucket,
        },
        normalized: r,
      }),
    );
  },
  citationMeta(
    verifiedDate: string,
    ttlSeconds: number,
  ): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? `Lee County Accela building permits (fixture)`
          : `${LIVE_CITATION} Portal: ${PORTAL_URL}.`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
