import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputDirection,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import { makeDuckDBSource } from "../sources/duckdb-source.mts";
import { env } from "../config/env.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoDate, expiresDate } from "../lib/dates.mts";

/**
 * hurricane-tracks-fl — NOAA HURDAT2 best-track joined against OpenFEMA NFIP
 * claims, scoped to the SWFL 6-county footprint. First brain to use the
 * generic makeDuckDBSource cross-tier connector: HURDAT2 Parquet lives in
 * Tier 1 Storage, NFIP claims live in Tier 2 Postgres, and the pre-join
 * runs in DuckDB SQL (NOT TypeScript memory) — establishing the pattern for
 * future cross-tier brains per the Tool Placement policy.
 *
 * Trust tier: 1 (NOAA NHC + OpenFEMA, both federal primary). The storage
 * tier of the bytes is irrelevant — trust is a property of upstream origin.
 *
 * Leaf brain (no upstream brains). Pure deterministic — no synthesis agent.
 * Direction: "neutral" (history-record brains never flip bullish; bearish read
 * lives in env-swfl which knows ongoing exposure).
 */

const SOURCE_ID = "hurdat2_fl_x_fema_nfip";
const HURDAT2_BUCKET = "lake-tier1";
const HURDAT2_PARQUET_PATH = "environmental/hurdat2_fl.parquet";
const HURDAT2_S3_URL = `s3://${HURDAT2_BUCKET}/${HURDAT2_PARQUET_PATH}`;
const HURDAT2_DASHBOARD_URL = `https://supabase.com/dashboard/project/_/storage/buckets/${HURDAT2_BUCKET}?path=${HURDAT2_PARQUET_PATH}`;

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "__fixtures__",
  "hurricane-tracks-fl.sample.json",
);

/** SWFL 6-county footprint with county centroids (used in the SQL CROSS JOIN). */
const SWFL_COUNTIES: ReadonlyArray<{
  fips: string;
  name: string;
  lat: number;
  lon: number;
}> = [
  { fips: "12015", name: "Charlotte", lat: 26.93, lon: -82.05 },
  { fips: "12021", name: "Collier", lat: 26.11, lon: -81.41 },
  { fips: "12043", name: "Glades", lat: 26.97, lon: -81.18 },
  { fips: "12051", name: "Hendry", lat: 26.55, lon: -81.18 },
  { fips: "12071", name: "Lee", lat: 26.55, lon: -81.92 },
  { fips: "12115", name: "Sarasota", lat: 27.18, lon: -82.36 },
];
const SWFL_FIPS = SWFL_COUNTIES.map((c) => c.fips);
const SWFL_FIPS_SQL = SWFL_FIPS.map((f) => `'${f}'`).join(",");
const COUNTY_CENTROIDS_VALUES = SWFL_COUNTIES.map(
  (c) => `('${c.fips}', '${c.name}', ${c.lat}, ${c.lon})`,
).join(", ");

/** Distance thresholds (miles). */
const NEAR_MILES = 50; // "passed within 50mi" = significant outer-band influence
const LANDFALL_PROXIMITY_MILES = 30; // record_id='L' obs within 30mi of centroid -> attributed to that county
const RECENT_WINDOW_YEARS_LANDFALL = 30;
const RECENT_WINDOW_YEARS_PASS = 30;
const RECENT_WINDOW_YEARS_CLOSEST = 5;

/**
 * Cross-tier pre-join. Runs entirely in DuckDB:
 *   - `tracks` view = read_parquet('s3://lake-tier1/environmental/hurdat2_fl.parquet')
 *   - `pg.data_lake.fema_nfip_claims` = ATTACHed Tier 2 Postgres
 *
 * CTE chain:
 *   1. county_centroids — inline VALUES table (6 SWFL counties + lat/lon)
 *   2. track_county — full HURDAT2 obs CROSS JOIN centroids + haversine distance_mi
 *   3. track_county_within — WHERE distance_mi <= 50 (drops far-pass obs)
 *   4. storm_county_summary — GROUP BY (storm_id, county_fips):
 *        closest_pass_mi, min_pressure_mb, max_wind_kt, max_category_saffir,
 *        landfall_in_county (BOOL_OR of record_id='L' AND distance_mi <= 30),
 *        obs_count_within_50mi, first/last_pass_date, storm_name, storm_year
 *   5. nfip_county_year — pg.data_lake.fema_nfip_claims GROUP BY (county_code, year_of_loss)
 *        SUM(building + contents + ico), COUNT(*)
 *   6. Final SELECT — LEFT JOIN summary ↔ nfip on (county_fips, storm_year)
 *        COALESCE nfip totals to 0 (storm with no claims is meaningful, not missing)
 *
 * Output: one row per (storm × county) where the storm passed within 50mi.
 */
const HURRICANE_TRACKS_QUERY = `
WITH county_centroids(fips, name, lat, lon) AS (
  VALUES ${COUNTY_CENTROIDS_VALUES}
),
track_county AS (
  SELECT
    t.storm_id,
    t.storm_name,
    t.storm_year,
    t.obs_date,
    t.record_id,
    t.lat,
    t.lon,
    t.max_wind_kt,
    t.min_pressure_mb,
    t.category_saffir,
    c.fips AS county_fips,
    c.name AS county_name,
    -- Haversine, statute miles. R = 3958.7613 mi.
    3958.7613 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(c.lat - t.lat) / 2), 2)
      + COS(RADIANS(t.lat)) * COS(RADIANS(c.lat))
      * POWER(SIN(RADIANS(c.lon - t.lon) / 2), 2)
    )) AS distance_mi
  FROM tracks t
  CROSS JOIN county_centroids c
),
track_county_within AS (
  SELECT * FROM track_county WHERE distance_mi <= ${NEAR_MILES}
),
storm_county_summary AS (
  SELECT
    storm_id,
    ANY_VALUE(storm_name)  AS storm_name,
    ANY_VALUE(storm_year)  AS storm_year,
    county_fips,
    ANY_VALUE(county_name) AS county_name,
    MIN(distance_mi)       AS closest_pass_mi,
    MIN(min_pressure_mb)   AS min_pressure_mb,
    MAX(max_wind_kt)       AS max_wind_kt,
    MAX(category_saffir)   AS max_category_saffir,
    BOOL_OR(record_id = 'L' AND distance_mi <= ${LANDFALL_PROXIMITY_MILES}) AS landfall_in_county,
    COUNT(*)               AS obs_count_within_50mi,
    MIN(obs_date)          AS first_pass_date,
    MAX(obs_date)          AS last_pass_date
  FROM track_county_within
  GROUP BY storm_id, county_fips
),
nfip_county_year AS (
  SELECT
    county_code AS county_fips,
    year_of_loss AS storm_year,
    SUM(
      COALESCE(amount_paid_on_building_claim, 0)
      + COALESCE(amount_paid_on_contents_claim, 0)
      + COALESCE(amount_paid_on_ico_claim, 0)
    ) AS nfip_paid_usd_storm_year,
    COUNT(*) AS nfip_claim_count_storm_year
  FROM pg.data_lake.fema_nfip_claims
  WHERE state = 'FL'
    AND county_code IN (${SWFL_FIPS_SQL})
  GROUP BY county_code, year_of_loss
)
SELECT
  s.storm_id,
  s.storm_name,
  s.storm_year,
  s.county_fips,
  s.county_name,
  s.closest_pass_mi,
  s.min_pressure_mb,
  s.max_wind_kt,
  s.max_category_saffir,
  s.landfall_in_county,
  s.obs_count_within_50mi,
  s.first_pass_date,
  s.last_pass_date,
  COALESCE(n.nfip_paid_usd_storm_year, 0)   AS nfip_paid_usd_storm_year,
  COALESCE(n.nfip_claim_count_storm_year, 0) AS nfip_claim_count_storm_year
FROM storm_county_summary s
LEFT JOIN nfip_county_year n
  ON s.county_fips = n.county_fips AND s.storm_year = n.storm_year
ORDER BY s.storm_year DESC, s.storm_id, s.county_fips
`;

/** One row of the pre-joined cross-tier result. */
export interface HurricaneCountyRow {
  storm_id: string;
  storm_name: string;
  storm_year: number;
  county_fips: string;
  county_name: string;
  closest_pass_mi: number;
  min_pressure_mb: number | null;
  max_wind_kt: number | null;
  max_category_saffir: number | null;
  landfall_in_county: boolean;
  obs_count_within_50mi: number;
  first_pass_date: string;
  last_pass_date: string;
  nfip_paid_usd_storm_year: number;
  nfip_claim_count_storm_year: number;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function toNumOrZero(v: unknown): number {
  return toNum(v) ?? 0;
}
function toStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}
function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "bigint") return v !== 0n;
  if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
  return false;
}

function rowShape(r: Record<string, unknown>): HurricaneCountyRow {
  return {
    storm_id: toStr(r["storm_id"]),
    storm_name: toStr(r["storm_name"]),
    storm_year: toNumOrZero(r["storm_year"]),
    county_fips: toStr(r["county_fips"]),
    county_name: toStr(r["county_name"]),
    closest_pass_mi: toNumOrZero(r["closest_pass_mi"]),
    min_pressure_mb: toNum(r["min_pressure_mb"]),
    max_wind_kt: toNum(r["max_wind_kt"]),
    max_category_saffir: toNum(r["max_category_saffir"]),
    landfall_in_county: toBool(r["landfall_in_county"]),
    obs_count_within_50mi: toNumOrZero(r["obs_count_within_50mi"]),
    first_pass_date: toStr(r["first_pass_date"]),
    last_pass_date: toStr(r["last_pass_date"]),
    nfip_paid_usd_storm_year: toNumOrZero(r["nfip_paid_usd_storm_year"]),
    nfip_claim_count_storm_year: toNumOrZero(r["nfip_claim_count_storm_year"]),
  };
}

function normalize(
  rows: HurricaneCountyRow[],
  ctx: { fetched_at: string },
): RawFragment[] {
  return rows.map((r) => ({
    fragment_id: fragmentId(SOURCE_ID, `${r.storm_id}-${r.county_fips}`),
    source_id: SOURCE_ID,
    source_trust_tier: 1,
    fetched_at: ctx.fetched_at,
    raw: {
      storm_id: r.storm_id,
      storm_name: r.storm_name,
      storm_year: r.storm_year,
      county_fips: r.county_fips,
    },
    normalized: r,
  }));
}

const HURRICANE_TRACKS_CITATION = `NOAA HURDAT2 (Atlantic best-track, ${HURDAT2_S3_URL}) × OpenFEMA NFIP (data_lake.fema_nfip_claims) — pre-joined in DuckDB via makeDuckDBSource. HURDAT2 file: latest from ${"https://www.nhc.noaa.gov/data/hurdat/"} via ingest/duckdb_pipelines/hurdat2_fl/pipeline.py.`;

export const hurricaneTracksFlSource = makeDuckDBSource<HurricaneCountyRow>({
  source_id: SOURCE_ID,
  trust_tier: 1,
  parquetViews: [{ name: "tracks", s3_url: HURDAT2_S3_URL }],
  pgAttachments: [{ alias: "pg" }],
  query: HURRICANE_TRACKS_QUERY,
  rowShape,
  normalize,
  citation: (verifiedDate, ttlSeconds) => ({
    source:
      env.source === "fixture"
        ? `NOAA HURDAT2 × OpenFEMA NFIP (fixture; 10 rows incl. Ian × Lee 2022) — fixture://refinery/__fixtures__/hurricane-tracks-fl.sample.json`
        : `${HURRICANE_TRACKS_CITATION} Live read browseable at ${HURDAT2_DASHBOARD_URL}.`,
    verified: verifiedDate,
    expires: expiresDate(verifiedDate, ttlSeconds),
  }),
  fixturePath: FIXTURE_PATH,
});

// -----------------------------------------------------------------------------
// Deterministic corpus aggregation -> 6 SKOS metrics.
// -----------------------------------------------------------------------------

interface HurricaneSnapshot {
  rows: HurricaneCountyRow[];
  current_year: number;
  landfalls_30yr_storms: number;
  cat3plus_passes_50mi_30yr_storms: number;
  nfip_paid_per_landfall_storm_avg_usd: number;
  worst_storm_county_year_nfip_paid_usd: number;
  most_recent_landfall_label: string | null;
  closest_pass_5yr_min_mi: number | null;
  landfall_row_count: number;
  unique_storm_count: number;
}

let lastSnapshot: HurricaneSnapshot | null = null;
let lastFetchedAt: string | null = null;

function rowsFromFragments(fragments: RawFragment[]): HurricaneCountyRow[] {
  return fragments
    .map((f) => f.normalized as unknown as HurricaneCountyRow)
    .filter((r): r is HurricaneCountyRow => !!r && typeof r === "object");
}

export function buildSnapshot(
  rows: HurricaneCountyRow[],
  now: Date = new Date(),
): HurricaneSnapshot {
  const current_year = now.getUTCFullYear();
  const landfall_rows = rows.filter((r) => r.landfall_in_county);

  // Metric 1: distinct landfall storms in last 30yr (across any SWFL county).
  const landfall_storms_30yr = new Set(
    landfall_rows
      .filter(
        (r) => current_year - r.storm_year <= RECENT_WINDOW_YEARS_LANDFALL,
      )
      .map((r) => r.storm_id),
  );

  // Metric 2: distinct cat3+ storms passing within 50mi in last 30yr.
  // (All rows in the corpus are already within 50mi by SQL filter.)
  const cat3plus_storms_30yr = new Set(
    rows
      .filter(
        (r) =>
          (r.max_category_saffir ?? 0) >= 3 &&
          current_year - r.storm_year <= RECENT_WINDOW_YEARS_PASS,
      )
      .map((r) => r.storm_id),
  );

  // Metric 3: avg NFIP paid per (landfall storm × county) where landfall occurred.
  // Per-row mean — each county-storm is its own loss observation.
  const landfall_nfip_values = landfall_rows.map(
    (r) => r.nfip_paid_usd_storm_year,
  );
  const nfip_avg =
    landfall_nfip_values.length === 0
      ? 0
      : landfall_nfip_values.reduce((a, b) => a + b, 0) /
        landfall_nfip_values.length;

  // Metric 4: max NFIP paid across landfall (storm × county) rows.
  const nfip_max = landfall_rows.reduce(
    (m, r) => (r.nfip_paid_usd_storm_year > m ? r.nfip_paid_usd_storm_year : m),
    0,
  );

  // Metric 5: most recent landfall — most recent first_pass_date among landfall rows.
  const landfall_sorted = [...landfall_rows].sort((a, b) =>
    a.first_pass_date < b.first_pass_date ? 1 : -1,
  );
  const most_recent = landfall_sorted[0];
  const most_recent_label = most_recent
    ? `${most_recent.storm_name} ${most_recent.first_pass_date}`
    : null;

  // Metric 6: min closest_pass_mi over trailing 5yr window (any storm, any county).
  const recent_passes = rows.filter(
    (r) => current_year - r.storm_year <= RECENT_WINDOW_YEARS_CLOSEST,
  );
  const closest_5yr =
    recent_passes.length === 0
      ? null
      : Math.round(
          Math.min(...recent_passes.map((r) => r.closest_pass_mi)) * 10,
        ) / 10;

  return {
    rows,
    current_year,
    landfalls_30yr_storms: landfall_storms_30yr.size,
    cat3plus_passes_50mi_30yr_storms: cat3plus_storms_30yr.size,
    nfip_paid_per_landfall_storm_avg_usd: Math.round(nfip_avg * 100) / 100,
    worst_storm_county_year_nfip_paid_usd: nfip_max,
    most_recent_landfall_label: most_recent_label,
    closest_pass_5yr_min_mi: closest_5yr,
    landfall_row_count: landfall_rows.length,
    unique_storm_count: new Set(rows.map((r) => r.storm_id)).size,
  };
}

function buildSourceMeta(fetched_at: string): BrainOutputMetricSource {
  return {
    url:
      env.source === "fixture" ? `fixture://${FIXTURE_PATH}` : HURDAT2_S3_URL,
    fetched_at,
    tier: 1,
    citation: HURRICANE_TRACKS_CITATION,
  };
}

function hurricaneCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const rows = rowsFromFragments(allFragments);
  lastFetchedAt = allFragments[0]?.fetched_at ?? null;

  if (rows.length === 0) {
    lastSnapshot = null;
    return [];
  }
  const snap = buildSnapshot(rows);
  lastSnapshot = snap;

  const facts: SynthesisFact[] = [];

  facts.push({
    topic: "corpus_overview",
    fact: `HURDAT2 × NFIP cross-tier corpus — SWFL 6-county footprint`,
    value:
      `${snap.unique_storm_count.toLocaleString()} distinct named storms in the SWFL near-pass corpus ` +
      `(within ${NEAR_MILES}mi of any SWFL county centroid), ` +
      `${snap.landfall_row_count.toLocaleString()} (storm × county) landfall rows. ` +
      `Cross-tier pre-join: HURDAT2 Parquet (Tier 1 Storage) joined to NFIP claims (Tier 2 Postgres) in DuckDB SQL — no TypeScript memory join.`,
    source_fragment_ids: [],
  });

  facts.push({
    topic: "metric:hurricane_landfalls_30yr",
    fact: "SWFL hurricane landfalls in the trailing 30-year window",
    value: `${snap.landfalls_30yr_storms.toLocaleString()} distinct named storms made landfall inside any of the 6 SWFL counties (FIPS ${SWFL_FIPS.join("/")}) in the trailing 30-year window.`,
    source_fragment_ids: [],
  });

  facts.push({
    topic: "metric:hurricane_cat3plus_passes_within_50mi_30yr",
    fact: "SWFL Cat-3+ hurricane passes within 50mi in the trailing 30-year window",
    value: `${snap.cat3plus_passes_50mi_30yr_storms.toLocaleString()} distinct Saffir-Simpson Cat 3+ storms passed within ${NEAR_MILES} statute miles of any SWFL county centroid in the trailing 30-year window.`,
    source_fragment_ids: [],
  });

  facts.push({
    topic: "metric:hurricane_nfip_paid_per_landfall_storm_avg_usd",
    fact: "SWFL average NFIP paid per (landfall storm × county) bucket",
    value: `$${snap.nfip_paid_per_landfall_storm_avg_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })} mean NFIP paid (building + contents + ICO) per (county × landfall-storm-year) bucket across the SWFL footprint.`,
    source_fragment_ids: [],
  });

  facts.push({
    topic: "metric:hurricane_worst_storm_county_year_nfip_paid_usd",
    fact: "SWFL worst single (storm × county) NFIP paid on record",
    value: `$${snap.worst_storm_county_year_nfip_paid_usd.toLocaleString()} — the single worst (storm × county) NFIP paid value in the joined corpus.`,
    source_fragment_ids: [],
  });

  if (snap.most_recent_landfall_label) {
    facts.push({
      topic: "metric:hurricane_most_recent_landfall",
      fact: "Most recent named-storm landfall in the SWFL footprint",
      value: `Most recent SWFL landfall: ${snap.most_recent_landfall_label}.`,
      source_fragment_ids: [],
    });
  }
  if (snap.closest_pass_5yr_min_mi != null) {
    facts.push({
      topic: "metric:hurricane_closest_pass_5yr_min_mi",
      fact: "Minimum closest-pass distance to any SWFL county centroid in the trailing 5-year window",
      value: `${snap.closest_pass_5yr_min_mi.toLocaleString()} statute miles — the closest any named storm passed to a SWFL county centroid in the trailing 5-year window.`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

function hurricaneOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snap = lastSnapshot;
  const fetched_at = lastFetchedAt ?? isoDate() + "T00:00:00Z";

  if (!snap) {
    return {
      conclusion:
        "hurricane-tracks-fl could not load any HURDAT2 × NFIP rows this build — the cross-tier join returned an empty result set.",
      key_metrics: [],
      caveats: [
        `Zero rows from the HURDAT2 × NFIP cross-tier join. Verify s3://${HURDAT2_BUCKET}/${HURDAT2_PARQUET_PATH} exists (run python -m ingest.duckdb_pipelines.hurdat2_fl.pipeline) and that data_lake.fema_nfip_claims has SWFL rows (env-swfl ingest must have completed).`,
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const source = buildSourceMeta(fetched_at);
  const direction: BrainOutputDirection = "neutral";
  const magnitude = 0.2;

  const key_metrics: BrainOutputMetric[] = [];

  key_metrics.push({
    metric: "hurricane_landfalls_30yr",
    value: snap.landfalls_30yr_storms,
    direction: "stable",
    label:
      "SWFL hurricane landfalls — distinct named storms landfalling in any of the 6 SWFL counties, trailing 30yr window",
    variable_type: "extensive",
    units: "storms",
    display_format: "count",
    source,
  });

  key_metrics.push({
    metric: "hurricane_cat3plus_passes_within_50mi_30yr",
    value: snap.cat3plus_passes_50mi_30yr_storms,
    direction: "stable",
    label:
      "SWFL Cat-3+ hurricane passes within 50mi of any SWFL county centroid, trailing 30yr window",
    variable_type: "extensive",
    units: "storms",
    display_format: "count",
    source,
  });

  key_metrics.push({
    metric: "hurricane_nfip_paid_per_landfall_storm_avg_usd",
    value: snap.nfip_paid_per_landfall_storm_avg_usd,
    direction: "stable",
    label:
      "SWFL average NFIP paid per (landfall storm × county) — building + contents + ICO",
    variable_type: "intensive",
    units: "USD",
    display_format: "currency",
    source,
  });

  key_metrics.push({
    metric: "hurricane_worst_storm_county_year_nfip_paid_usd",
    value: snap.worst_storm_county_year_nfip_paid_usd,
    direction: "stable",
    label:
      "SWFL worst single (storm × county) NFIP paid value on record (building + contents + ICO)",
    variable_type: "extensive",
    units: "USD",
    display_format: "currency",
    source,
  });

  if (snap.most_recent_landfall_label) {
    key_metrics.push({
      metric: "hurricane_most_recent_landfall_date",
      value: snap.most_recent_landfall_label,
      direction: "stable",
      label:
        "Most recent named-storm landfall in the SWFL footprint (storm + ISO date)",
      variable_type: "categorical",
      source,
    });
  }

  if (snap.closest_pass_5yr_min_mi != null) {
    key_metrics.push({
      metric: "hurricane_closest_pass_5yr_min_mi",
      value: snap.closest_pass_5yr_min_mi,
      direction: "stable",
      label:
        "Minimum closest-pass distance (statute miles) to any SWFL county centroid, trailing 5yr window",
      variable_type: "intensive",
      units: "statute miles",
      display_format: "raw",
      source,
    });
  }

  const conclusion_parts: string[] = [];
  conclusion_parts.push(
    `Southwest Florida hurricane impact history (HURDAT2 × NFIP cross-tier join, 6 counties: ${SWFL_COUNTIES.map((c) => c.name).join(" + ")}) — ` +
      `${snap.landfalls_30yr_storms.toLocaleString()} distinct named storms made landfall in a SWFL county over the trailing 30-year window, ` +
      `${snap.cat3plus_passes_50mi_30yr_storms.toLocaleString()} of those were Cat-3+ on Saffir-Simpson at any point in their lifetime.`,
  );
  conclusion_parts.push(
    `Realized NFIP exposure per (storm × county) landfall row averages $${snap.nfip_paid_per_landfall_storm_avg_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
      `with the worst single (storm × county) on record at $${snap.worst_storm_county_year_nfip_paid_usd.toLocaleString()}.`,
  );
  if (snap.most_recent_landfall_label) {
    conclusion_parts.push(
      `Most recent landfall in scope: ${snap.most_recent_landfall_label}.`,
    );
  }
  if (snap.closest_pass_5yr_min_mi != null) {
    conclusion_parts.push(
      `Closest pass in the trailing 5-year window: ${snap.closest_pass_5yr_min_mi.toLocaleString()} statute miles from a SWFL county centroid.`,
    );
  }

  const caveats: string[] = [];
  caveats.push(
    `NFIP coverage is policyholder-only — uninsured and non-NFIP losses (private flood policies, structural damage outside flood coverage) are NOT in this archive. True SWFL hurricane loss is larger than the joined nfip_paid_usd values show.`,
  );
  caveats.push(
    `"Landfall in county" uses HURDAT2 record_id='L' obs within ${LANDFALL_PROXIMITY_MILES}mi of the county centroid as a proxy — actual county-level landfall attribution would require obs ∩ county polygon (deferred until a downstream brain needs sub-county precision).`,
  );
  caveats.push(
    `Storm-county join is on (county_fips, storm_year) — NFIP claims dated in the same calendar year as a HURDAT2 landfall are attributed to that storm. Multiple storms in one year share the same NFIP year (e.g. Helene + Milton both 2024 SWFL).`,
  );
  caveats.push(
    `Saffir-Simpson category is derived from MAX(max_wind_kt) over the storm's lifetime, not the wind speed at SWFL passage. A storm can be "Cat 5 at peak" but Cat 1 by the time it reached SWFL.`,
  );
  if (env.source === "fixture") {
    caveats.unshift(
      `Cross-tier aggregates in this build are derived from the 10-row fixture (Ian/Irma/Charley/Ivan/Helene/Milton sampling) — unset REFINERY_SOURCE or set it to "live" to read the full HURDAT2 × NFIP join from Tier 1 Storage + Tier 2 Postgres.`,
    );
  }

  return {
    conclusion: conclusion_parts.join(" "),
    key_metrics,
    caveats,
    direction,
    magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

export const hurricaneTracksFl: PackDefinition = {
  id: "hurricane-tracks-fl",
  brain_id: "hurricane-tracks-fl",
  public_label: "Hurricane Tracks",
  domain: "environmental",
  scope:
    "NOAA HURDAT2 best-track joined against OpenFEMA NFIP claims for the SWFL 6-county footprint (LEE+COLLIER+CHARLOTTE+GLADES+HENDRY+SARASOTA). Cross-tier brain: HURDAT2 Parquet in Tier 1 Storage + NFIP claims in Tier 2 Postgres, pre-joined in DuckDB SQL (NOT TypeScript memory). Surfaces landfall counts, Cat-3+ near-passes, per-storm NFIP exposure, most-recent landfall, and closest-pass distance. Pairs with storm-history-swfl (NOAA Storm Events catalog — different upstream, different framing).",
  ttl_seconds: 31536000, // 1 year — NHC publishes HURDAT2 annually
  sources: [hurricaneTracksFlSource],
  input_brains: [],
  fitScore: (): number => 8,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: hurricaneCorpusSummary,
  outputProducer: hurricaneOutputProducer,
  synthesisStrategy: "deterministic",
  preferences: [
    "The user reads hurricane-tracks-fl as a backward-looking impact-record paired with realized insured losses — landfall counts and per-storm NFIP paid are the load-bearing fields, not narrative speculation about future seasons.",
    "The user expects this brain to be honest about NFIP's policyholder-only scope — uninsured losses are NOT in the archive, and the brain says so on every render.",
    "The user pairs hurricane-tracks-fl (named-storm impact + insured loss) with storm-history-swfl (NOAA severe weather catalog) and env-swfl (modeled flood exposure) — three brains, three framings, none substitutes for another.",
  ],
  activeProject:
    "hurricane-tracks-fl: first cross-tier brain — HURDAT2 (Tier 1 Storage) × NFIP (Tier 2 Postgres) pre-joined via the generic makeDuckDBSource connector, establishing the SQL-pushdown precedent for future cross-tier brains.",
  prompts: {
    triageContext:
      "These fragments are per-(storm × county) rows pre-joined in DuckDB SQL across HURDAT2 best-tracks (Tier 1 Storage) and OpenFEMA NFIP claims (Tier 2 Postgres). All rows are decision-relevant by construction; the pack is pure deterministic aggregation over the joined source rows.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by hurricaneCorpusSummary; the BrainOutput is built by hurricaneOutputProducer from a single in-memory snapshot.",
  },
};
