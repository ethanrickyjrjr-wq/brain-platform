import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * FHFA House Price Index source connector.
 *
 * Live mode: queries data_lake.fhfa_hpi (Tier 2, populated by
 * ingest/pipelines/fhfa/pipeline.py). Filters at the DB level:
 *   - MSA rows for 4 SWFL metros (Cape Coral, Naples, North Port, Punta Gorda)
 *   - FL state rows
 *   Filtered to traditional / purchase-only / quarterly only.
 *
 * Fixture mode: reads refinery/__fixtures__/fhfa-hpi.sample.json (master field only).
 *
 * County-level xlsx data (hpi_at_county.xlsx) is intentionally excluded — FHFA
 * marks it "developmental" and it updates annually. Add a separate connector +
 * dlt pipeline if county-FIPS-level granularity becomes necessary.
 */

const SOURCE_ID = "fhfa_hpi";
const SCHEMA = "data_lake";
const TABLE = "fhfa_hpi";
const MASTER_JSON_URL = "https://www.fhfa.gov/hpi/download/monthly/hpi_master.json";

const FIXTURE_PATH = path.join(process.cwd(), "refinery", "__fixtures__", "fhfa-hpi.sample.json");

// ── SWFL scope ────────────────────────────────────────────────────────────────

const SWFL_MSA_NAMES = new Set([
  "Cape Coral-Fort Myers, FL",
  "Naples-Marco Island, FL",
  "North Port-Bradenton-Sarasota, FL",
  "Punta Gorda, FL",
]);

// ── Types ─────────────────────────────────────────────────────────────────────

/** One quarterly MSA/State HPI record as stored in data_lake.fhfa_hpi. */
export interface HpiMasterRecord {
  kind: "hpi-master";
  hpi_type: string;
  hpi_flavor: string;
  frequency: "quarterly";
  level: "MSA" | "State" | "USA or Census Division";
  place_name: string;
  place_id: string;
  yr: number;
  period: number;
  index_nsa: number | null;
  index_sa: number | null;
}

/**
 * Pre-computed SWFL summary: Cape Coral MSA (Lee County proxy) + FL state baseline.
 * This is the "thin-pipe" fragment consuming packs read from this connector.
 */
export interface HpiSwflSummary {
  kind: "hpi-swfl-summary";
  /** Cape Coral-Fort Myers MSA — quarterly, Lee County price-level proxy. */
  cape_coral_msa: {
    latest_period: string;
    index_nsa: number | null;
    qoq_change_pct: number | null;
    yoy_change_pct: number | null;
  } | null;
  /** Naples-Marco Island MSA — quarterly, Collier County price-level proxy. */
  naples_msa: {
    latest_period: string;
    index_nsa: number | null;
    qoq_change_pct: number | null;
    yoy_change_pct: number | null;
  } | null;
  /** FL state baseline — latest quarterly index. */
  fl_state: {
    latest_period: string;
    index_nsa: number | null;
    yoy_change_pct: number | null;
  } | null;
}

// Raw DB row shape (same columns the dlt pipeline writes)
interface DbRow {
  hpi_type: string;
  hpi_flavor: string;
  frequency: string;
  level: string;
  place_name: string;
  place_id: string;
  yr: number;
  period: number;
  index_nsa: number | null;
  index_sa: number | null;
}

// ── Computation helpers ───────────────────────────────────────────────────────

function toQuarterString(yr: number, period: number): string {
  return `${yr}-Q${period}`;
}

function computeMsaSummary(rows: DbRow[], placeName: string): HpiSwflSummary["cape_coral_msa"] {
  const sorted = rows
    .filter((r) => r.place_name === placeName)
    .sort((a, b) => a.yr - b.yr || a.period - b.period);
  if (sorted.length === 0) return null;

  const latest = sorted[sorted.length - 1];
  const prevQtr = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const prevYear = sorted.length >= 5 ? sorted[sorted.length - 5] : null;

  const idx = latest.index_nsa;
  const qoqChange =
    idx != null && prevQtr?.index_nsa != null && prevQtr.index_nsa > 0
      ? ((idx - prevQtr.index_nsa) / prevQtr.index_nsa) * 100
      : null;
  const yoyChange =
    idx != null && prevYear?.index_nsa != null && prevYear.index_nsa > 0
      ? ((idx - prevYear.index_nsa) / prevYear.index_nsa) * 100
      : null;

  return {
    latest_period: toQuarterString(latest.yr, latest.period),
    index_nsa: idx ?? null,
    qoq_change_pct: qoqChange !== null ? Math.round(qoqChange * 100) / 100 : null,
    yoy_change_pct: yoyChange !== null ? Math.round(yoyChange * 100) / 100 : null,
  };
}

function computeStateSummary(rows: DbRow[]): HpiSwflSummary["fl_state"] {
  const sorted = rows
    .filter((r) => r.level === "State" && r.place_id === "FL")
    .sort((a, b) => a.yr - b.yr || a.period - b.period);
  if (sorted.length === 0) return null;

  const latest = sorted[sorted.length - 1];
  const prevYear = sorted.length >= 5 ? sorted[sorted.length - 5] : null;

  const idx = latest.index_nsa;
  const yoyChange =
    idx != null && prevYear?.index_nsa != null && prevYear.index_nsa > 0
      ? ((idx - prevYear.index_nsa) / prevYear.index_nsa) * 100
      : null;

  return {
    latest_period: toQuarterString(latest.yr, latest.period),
    index_nsa: idx ?? null,
    yoy_change_pct: yoyChange !== null ? Math.round(yoyChange * 100) / 100 : null,
  };
}

function buildSwflSummary(rows: DbRow[]): HpiSwflSummary {
  return {
    kind: "hpi-swfl-summary",
    cape_coral_msa: computeMsaSummary(rows, "Cape Coral-Fort Myers, FL"),
    naples_msa: computeMsaSummary(rows, "Naples-Marco Island, FL"),
    fl_state: computeStateSummary(rows),
  };
}

// ── Live fetch from data_lake.fhfa_hpi ────────────────────────────────────────

const COLS = "hpi_type,hpi_flavor,frequency,level,place_name,place_id,yr,period,index_nsa,index_sa";

async function fetchLive(): Promise<DbRow[]> {
  const sb = getSupabase().schema(SCHEMA);

  const [msaResp, stateResp] = await Promise.all([
    sb
      .from(TABLE)
      .select(COLS)
      .eq("hpi_type", "traditional")
      .eq("hpi_flavor", "purchase-only")
      .eq("frequency", "quarterly")
      .eq("level", "MSA")
      .in("place_name", [...SWFL_MSA_NAMES])
      .order("yr")
      .order("period"),

    sb
      .from(TABLE)
      .select(COLS)
      .eq("hpi_type", "traditional")
      .eq("hpi_flavor", "purchase-only")
      .eq("frequency", "quarterly")
      .eq("level", "State")
      .eq("place_id", "FL")
      .order("yr")
      .order("period"),
  ]);

  if (msaResp.error) {
    throw new Error(`fhfa-hpi-source: SWFL MSA query failed — ${msaResp.error.message}`);
  }
  if (stateResp.error) {
    throw new Error(`fhfa-hpi-source: FL State query failed — ${stateResp.error.message}`);
  }

  return [...((msaResp.data ?? []) as DbRow[]), ...((stateResp.data ?? []) as DbRow[])];
}

// ── Fixture ───────────────────────────────────────────────────────────────────

interface FixtureShape {
  master: DbRow[];
  county?: unknown[];
}

async function loadFixture(): Promise<DbRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as FixtureShape;
  // Mirror the live WHERE clause so fixture and live behave identically
  return data.master.filter(
    (r) =>
      r.hpi_type === "traditional" &&
      r.hpi_flavor === "purchase-only" &&
      r.frequency === "quarterly" &&
      ((r.level === "MSA" && SWFL_MSA_NAMES.has(r.place_name)) ||
        (r.level === "State" && r.place_id === "FL")),
  );
}

// ── Connector ─────────────────────────────────────────────────────────────────

export const fhfaHpiSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,

  async fetch(): Promise<RawFragment[]> {
    const rows = env.source === "fixture" ? await loadFixture() : await fetchLive();

    const fetched_at = isoTimestamp();
    const fragments: RawFragment[] = [];

    // Individual quarterly record fragments
    for (const r of rows) {
      const norm: HpiMasterRecord = {
        kind: "hpi-master",
        hpi_type: r.hpi_type,
        hpi_flavor: r.hpi_flavor,
        frequency: "quarterly",
        level: r.level as HpiMasterRecord["level"],
        place_name: r.place_name,
        place_id: r.place_id,
        yr: r.yr,
        period: r.period,
        index_nsa: r.index_nsa,
        index_sa: r.index_sa,
      };
      fragments.push({
        fragment_id: fragmentId(SOURCE_ID, `master-${r.place_id}-${r.yr}-${r.period}`),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: { place_id: r.place_id, yr: r.yr, period: r.period },
        normalized: norm,
      });
    }

    // SWFL rollup summary — the thin-pipe fragment consuming packs read
    const summary = buildSwflSummary(rows);
    fragments.push({
      fragment_id: fragmentId(SOURCE_ID, "swfl-summary"),
      source_id: SOURCE_ID,
      source_trust_tier: 1,
      fetched_at,
      raw: {
        cape_coral_msa_period: summary.cape_coral_msa?.latest_period ?? null,
        naples_msa_period: summary.naples_msa?.latest_period ?? null,
        fl_state_period: summary.fl_state?.latest_period ?? null,
      },
      normalized: summary,
    });

    return fragments;
  },

  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    const isLive = env.source !== "fixture";
    return {
      source: isLive
        ? `FHFA House Price Index via data_lake.fhfa_hpi (loaded from ${MASTER_JSON_URL}; SWFL MSAs + FL state, quarterly purchase-only traditional)`
        : `FHFA House Price Index (fixture; fhfa-hpi.sample.json master field)`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
