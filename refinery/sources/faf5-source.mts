import path from "node:path";
import { makeDuckDBSource } from "./duckdb-source.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { fragmentId } from "../lib/ids.mts";
import { expiresDate } from "../lib/dates.mts";

/**
 * faf5 source connector — Cold Lane edition.
 *
 * FAF5.7.1 freight flows live in lake-tier1 S3 as Parquet (uploaded by
 * ingest/scripts/faf5_to_parquet.py). DuckDB reads three Parquet views,
 * joins them in-process, and returns normalized flow fragments.
 *
 * Bumping vintages: update FAF5_VINTAGE to the new upload date when ORNL
 * publishes the next release, re-run faf5_to_parquet.py, then re-render.
 *
 * Trust tier: 1 (ORNL/FHWA — federal authoritative source).
 * Filter: dms_dest=129 (Remainder of Florida) AND trade_type=1 (domestic inbound).
 */

// ── Cold Lane coordinates ─────────────────────────────────────────────────
const FAF5_VINTAGE = "2026-05-19"; // legacy; zone/sctg lookup Parquets still live here
const FAF5_BUCKET = "lake-tier1";
const FAF5_LEGACY_S3_BASE = `s3://${FAF5_BUCKET}/faf5/${FAF5_VINTAGE}`;
export const FAF5_ORNL_URL = "https://faf.ornl.gov/faf5/";

const SOURCE_ID = "faf5_flows_swfl";
const SWFL_DEST_ZONE = 129;
const DOMESTIC_TRADE_TYPE = 1;
/** Latest historical year in FAF5.7.1 — bump when ORNL publishes the next vintage. */
export const LATEST_HISTORICAL_FAF_YEAR = 2024;
const HISTORICAL_YEARS = [2020, 2021, 2022, 2023, 2024] as const;

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "logistics-swfl.sample.json",
);

// ── Public types ──────────────────────────────────────────────────────────

export interface FafFlowNormalized {
  kind: "faf5-flow";
  origin_zone_id: number;
  origin_zone_name: string;
  origin_state_abbr: string;
  sctg_code: number;
  commodity_name: string;
  /** Tons in thousand-tons for LATEST_HISTORICAL_FAF_YEAR. */
  tons_thousand: number;
  /** Value in millions of USD for LATEST_HISTORICAL_FAF_YEAR. */
  value_musd: number;
  year: number;
}

// ── DuckDB row shape (after rowShape coercion) ────────────────────────────

interface FafDuckRow {
  dms_orig: number;
  zone_name: string;
  state_abbr: string;
  sctg2: number;
  commodity_name: string;
  tons: number;
  value_m: number;
  year: number;
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ── Connector ─────────────────────────────────────────────────────────────

const _yearViews = HISTORICAL_YEARS.map((y) => ({
  name: `faf_flows_${y}` as const,
  s3_url: `s3://${FAF5_BUCKET}/faf5/year=${y}/faf_flows.parquet`,
}));

const _yearUnion = HISTORICAL_YEARS.map(
  (y) => `
    SELECT f.dms_orig, z.zone_name, z.state_abbr, f.sctg2, s.commodity_name,
           f.tons, f.value_musd AS value_m, ${y} AS year
    FROM faf_flows_${y} f
    JOIN faf_zone_lookup z ON f.dms_orig = z.zone_id
    JOIN faf_sctg_lookup s ON f.sctg2 = s.sctg_code
    WHERE f.dms_dest = ${SWFL_DEST_ZONE}
      AND f.trade_type = ${DOMESTIC_TRADE_TYPE}
      AND f.tons > 0`,
).join("\n    UNION ALL");

export const faf5Source: SourceConnector = makeDuckDBSource<FafDuckRow>({
  source_id: SOURCE_ID,
  trust_tier: 1,
  parquetViews: [
    ..._yearViews,
    {
      name: "faf_zone_lookup",
      s3_url: `${FAF5_LEGACY_S3_BASE}/faf_zone_lookup.parquet`,
    },
    {
      name: "faf_sctg_lookup",
      s3_url: `${FAF5_LEGACY_S3_BASE}/faf_sctg_lookup.parquet`,
    },
  ],
  query: _yearUnion,
  rowShape: (r) => ({
    dms_orig: toNum(r["dms_orig"]),
    zone_name: String(r["zone_name"] ?? ""),
    state_abbr: String(r["state_abbr"] ?? ""),
    sctg2: toNum(r["sctg2"]),
    commodity_name: String(r["commodity_name"] ?? ""),
    tons: toNum(r["tons"]),
    value_m: toNum(r["value_m"]),
    year: toNum(r["year"]),
  }),
  normalize: (rows, { fetched_at }): RawFragment[] =>
    rows.map(
      (r): RawFragment<FafFlowNormalized> => ({
        fragment_id: fragmentId(
          SOURCE_ID,
          `${r.dms_orig}-${r.sctg2}-${r.year}`,
        ),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: r,
        normalized: {
          kind: "faf5-flow",
          origin_zone_id: r.dms_orig,
          origin_zone_name: r.zone_name,
          origin_state_abbr: r.state_abbr,
          sctg_code: r.sctg2,
          commodity_name: r.commodity_name,
          tons_thousand: r.tons,
          value_musd: r.value_m,
          year: r.year,
        },
      }),
    ),
  citation: (verifiedDate, ttlSeconds): Omit<CitationRow, "id"> => ({
    source: `FAF5.7.1 freight flows (ORNL/FHWA Cold Lane Parquet; single model vintage downloaded ${FAF5_VINTAGE}; years ${HISTORICAL_YEARS.join(",")} are FAF modeled estimates — not independent annual surveys; dms_dest=${SWFL_DEST_ZONE} trade_type=${DOMESTIC_TRADE_TYPE}) — ${FAF5_ORNL_URL}`,
    verified: verifiedDate,
    expires: expiresDate(verifiedDate, ttlSeconds),
  }),
  fixturePath: FIXTURE_PATH,
});
