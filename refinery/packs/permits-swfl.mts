import { readFileSync } from "node:fs";
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
import {
  permitsSource,
  type NormalizedPermitRow,
  type PermitBucket,
} from "../sources/permits-source.mts";
import {
  collierPermitsSource,
  getCollierDroppedRowCounts,
} from "../sources/collier-permits-source.mts";
import {
  assignCorridor,
  type CorridorCentroid,
} from "../lib/corridor-assignment.mts";
import { displayNameFor } from "../lib/corridor-display.mts";
import {
  generateCurrentWindow,
  generateHistoricalWindows,
  countPermitsInWindow,
  rateNormalize,
  computeZScore,
} from "../lib/permit-windows.mts";
import { isoDate } from "../lib/dates.mts";

const BRAIN_ID = "permits-swfl";
const HEADLINE_BUCKETS = ["commercial_new", "commercial_alteration"] as const;
const ALL_BUCKETS = [
  "commercial_new",
  "commercial_alteration",
  "residential",
  "demolition",
  "other",
] as const;

const MAX_CORRIDOR_RADIUS_MI = 1.5;
const LOW_N_THRESHOLD = 10;
const SATURATION_Z_THRESHOLD = 2.0;
const THIN_CORRIDOR_SHARE_THRESHOLD = 0.7;
const COLLIER_STALE_DAYS = 60; // 2× monthly cadence (cadence_registry tolerance)
const LEE_STALE_DAYS = 14; // ~2× weekly Accela publish
const COLLIER_SHORT_BASELINE_MONTHS = 6;

// Corridor centroids loaded synchronously at module init. Unified Lee + Naples
// fixture at `fixtures/corridor-centroids.json` (26 corridors as of 2026-05-27).
// Each centroid carries a `county` field so per-county rollups can attribute
// cells correctly. Path B per spec: in-memory nearest-centroid pick per permit;
// the Collier ingest pipeline runs the same algorithm at ingest time but the
// pack re-routes from lat/lon here so corridor moves don't require re-ingest.
const CORRIDOR_FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "corridor-centroids.json",
);
const CORRIDOR_CENTROIDS: CorridorCentroid[] = JSON.parse(
  readFileSync(CORRIDOR_FIXTURE_PATH, "utf-8"),
);

const CORRIDOR_COUNTY: Map<string, "lee" | "collier"> = new Map(
  CORRIDOR_CENTROIDS.map((c) => [c.corridor_id, c.county ?? "lee"]),
);
{
  // Defensive warning for any centroid missing the explicit county tag — we
  // default to "lee" for backwards compatibility, but the live fixture should
  // never trip this.
  const missing = CORRIDOR_CENTROIDS.filter((c) => !c.county).map(
    (c) => c.corridor_id,
  );
  if (missing.length > 0) {
    console.warn(
      `[permits-swfl] CorridorCentroid missing county field — defaulting to "lee" for: ${missing.join(", ")}`,
    );
  }
}

export interface CorridorBucketCell {
  corridor_id: string;
  corridor_label: string;
  county: "lee" | "collier";
  bucket: PermitBucket;
  z: number;
  n_current: number;
  current_rate: number;
  historical_mean_rate: number;
}

export interface ZipBucketCell {
  zip_code: string;
  bucket: PermitBucket;
  z: number;
  n_current: number;
  current_rate: number;
  historical_mean_rate: number;
}

export interface PermitsSnapshot {
  corridor_cells: CorridorBucketCell[];
  zip_cells: ZipBucketCell[];
  swfl_weighted_z: number;
  lee_weighted_z: number;
  collier_weighted_z: number;
  swfl_saturation_index: number;
  lee_saturation_index: number;
  collier_saturation_index: number;
  // Top corridor IDs per scope. Lee-only and SWFL versions ship as separate
  // metrics; cre-swfl reads the Lee version directly, so we never collapse
  // the two into one set.
  top_heating_lee_alt: string[];
  top_heating_lee_new: string[];
  top_cooling_lee_alt: string[];
  top_cooling_lee_new: string[];
  top_heating_swfl_alt: string[];
  top_heating_swfl_new: string[];
  top_cooling_swfl_alt: string[];
  top_cooling_swfl_new: string[];
  low_n_cell_count: number;
  total_cell_count: number;
  thin_corridor_share: number;
  backfill_days: number;
  collier_backfill_months: number;
  lee_backfill_months: number;
  lee_row_count: number;
  collier_row_count: number;
  lee_max_issued_date: string | null;
  collier_max_issued_date: string | null;
  storm_caveat_fires: boolean;
}

interface PermitWithCorridor extends NormalizedPermitRow {
  __corridor_id: string | null;
  __corridor_label: string | null;
}

function enrichWithCorridor(
  permits: NormalizedPermitRow[],
  corridors: ReadonlyArray<CorridorCentroid>,
): PermitWithCorridor[] {
  return permits.map((p) => {
    const a = assignCorridor(p.lat, p.lon, corridors, {
      maxRadiusMi: MAX_CORRIDOR_RADIUS_MI,
    });
    return {
      ...p,
      __corridor_id: a?.corridor_id ?? null,
      __corridor_label: a?.corridor_label ?? null,
    };
  });
}

function corridorCounty(corridor_id: string): "lee" | "collier" {
  return CORRIDOR_COUNTY.get(corridor_id) ?? "lee";
}

function weightedZForCounty(
  cells: ReadonlyArray<CorridorBucketCell>,
  county: "lee" | "collier" | "swfl",
): number {
  let weightedSum = 0;
  let weightSum = 0;
  for (const cell of cells) {
    if (cell.bucket === "other") continue;
    if (county !== "swfl" && cell.county !== county) continue;
    weightedSum += cell.z * cell.n_current;
    weightSum += cell.n_current;
  }
  return weightSum === 0 ? 0 : weightedSum / weightSum;
}

function saturationForCounty(
  cells: ReadonlyArray<CorridorBucketCell>,
  county: "lee" | "collier" | "swfl",
): number {
  const inScope = cells.filter((c) => county === "swfl" || c.county === county);
  const corridorsWithData = new Set(inScope.map((c) => c.corridor_id));
  if (corridorsWithData.size === 0) return 0;
  const saturated = new Set(
    inScope
      .filter(
        (c) =>
          (HEADLINE_BUCKETS as readonly string[]).includes(c.bucket) &&
          c.z >= SATURATION_Z_THRESHOLD,
      )
      .map((c) => c.corridor_id),
  );
  return saturated.size / corridorsWithData.size;
}

function rankCorridorIdsForScope(
  cells: ReadonlyArray<CorridorBucketCell>,
  bucket: PermitBucket,
  ascending: boolean,
  scope: "lee" | "collier" | "swfl",
): string[] {
  return cells
    .filter(
      (c) =>
        c.bucket === bucket &&
        c.n_current >= LOW_N_THRESHOLD &&
        (scope === "swfl" || c.county === scope),
    )
    .sort((a, b) => (ascending ? a.z - b.z : b.z - a.z))
    .slice(0, 5)
    .map((c) => c.corridor_id);
}

function backfillMonthsForCounty(
  permits: ReadonlyArray<NormalizedPermitRow>,
  county: "lee" | "collier",
): number {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const p of permits) {
    if (p.county !== county) continue;
    const t = Date.parse(p.issued_date);
    if (Number.isNaN(t)) continue;
    if (t < earliest) earliest = t;
    if (t > latest) latest = t;
  }
  if (earliest === Infinity || latest === -Infinity) return 0;
  const days = (latest - earliest) / 86400_000;
  return Math.round(days / 30);
}

function maxIssuedDateForCounty(
  permits: ReadonlyArray<NormalizedPermitRow>,
  county: "lee" | "collier",
): string | null {
  let latest: string | null = null;
  for (const p of permits) {
    if (p.county !== county) continue;
    if (!latest || p.issued_date > latest) latest = p.issued_date;
  }
  return latest;
}

export function buildSnapshot(
  permits: NormalizedPermitRow[],
  corridors: ReadonlyArray<CorridorCentroid>,
  now: Date,
): PermitsSnapshot {
  const enriched = enrichWithCorridor(permits, corridors);
  const currentWin = generateCurrentWindow(now);
  const historicalWins = generateHistoricalWindows(now);

  const byCorridorBucket = new Map<string, PermitWithCorridor[]>();
  const byZipBucket = new Map<string, PermitWithCorridor[]>();
  for (const p of enriched) {
    if (p.__corridor_id) {
      const k = `${p.__corridor_id}::${p.bucket}`;
      const arr = byCorridorBucket.get(k) ?? [];
      arr.push(p);
      byCorridorBucket.set(k, arr);
    }
    if (p.zip_code) {
      const k = `${p.zip_code}::${p.bucket}`;
      const arr = byZipBucket.get(k) ?? [];
      arr.push(p);
      byZipBucket.set(k, arr);
    }
  }

  const corridor_cells: CorridorBucketCell[] = [];
  for (const [key, group] of byCorridorBucket.entries()) {
    const [corridor_id, bucket] = key.split("::") as [string, PermitBucket];
    const corridor_label = group[0].__corridor_label ?? corridor_id;
    const n_current = countPermitsInWindow(group, currentWin);
    const current_rate = rateNormalize(n_current, currentWin);
    const historical_rates = historicalWins.map((w) =>
      rateNormalize(countPermitsInWindow(group, w), w),
    );
    const historical_mean_rate =
      historical_rates.length === 0
        ? 0
        : historical_rates.reduce((a, b) => a + b, 0) / historical_rates.length;
    const z = computeZScore(current_rate, historical_rates);
    corridor_cells.push({
      corridor_id,
      corridor_label,
      county: corridorCounty(corridor_id),
      bucket,
      z,
      n_current,
      current_rate,
      historical_mean_rate,
    });
  }

  const zip_cells: ZipBucketCell[] = [];
  for (const [key, group] of byZipBucket.entries()) {
    const [zip_code, bucket] = key.split("::") as [string, PermitBucket];
    const n_current = countPermitsInWindow(group, currentWin);
    const current_rate = rateNormalize(n_current, currentWin);
    const historical_rates = historicalWins.map((w) =>
      rateNormalize(countPermitsInWindow(group, w), w),
    );
    const historical_mean_rate =
      historical_rates.length === 0
        ? 0
        : historical_rates.reduce((a, b) => a + b, 0) / historical_rates.length;
    const z = computeZScore(current_rate, historical_rates);
    zip_cells.push({
      zip_code,
      bucket,
      z,
      n_current,
      current_rate,
      historical_mean_rate,
    });
  }

  const swfl_weighted_z = weightedZForCounty(corridor_cells, "swfl");
  const collier_weighted_z = weightedZForCounty(corridor_cells, "collier");

  // Lee permits arrive with null lat/lon (geocoding is a v1 deferred item), so
  // assignCorridor returns null for every Lee row and no Lee permit goes into
  // corridor_cells. Fall back to a county-level z-score (all non-"other" Lee permits
  // treated as one group) until geocoding is wired.
  const hasLeeCorridorPermits = enriched.some(
    (p) => p.county === "lee" && p.__corridor_id !== null,
  );
  const lee_weighted_z = hasLeeCorridorPermits
    ? weightedZForCounty(corridor_cells, "lee")
    : (() => {
        const group = permits.filter(
          (p) => p.county === "lee" && p.bucket !== "other",
        );
        if (group.length === 0) return 0;
        const n = countPermitsInWindow(group, currentWin);
        const rate = rateNormalize(n, currentWin);
        const hRates = historicalWins.map((w) =>
          rateNormalize(countPermitsInWindow(group, w), w),
        );
        return computeZScore(rate, hRates);
      })();

  const swfl_saturation_index = saturationForCounty(corridor_cells, "swfl");
  const lee_saturation_index = saturationForCounty(corridor_cells, "lee");
  const collier_saturation_index = saturationForCounty(
    corridor_cells,
    "collier",
  );

  const top_heating_lee_alt = rankCorridorIdsForScope(
    corridor_cells,
    "commercial_alteration",
    false,
    "lee",
  );
  const top_heating_lee_new = rankCorridorIdsForScope(
    corridor_cells,
    "commercial_new",
    false,
    "lee",
  );
  const top_cooling_lee_alt = rankCorridorIdsForScope(
    corridor_cells,
    "commercial_alteration",
    true,
    "lee",
  );
  const top_cooling_lee_new = rankCorridorIdsForScope(
    corridor_cells,
    "commercial_new",
    true,
    "lee",
  );
  const top_heating_swfl_alt = rankCorridorIdsForScope(
    corridor_cells,
    "commercial_alteration",
    false,
    "swfl",
  );
  const top_heating_swfl_new = rankCorridorIdsForScope(
    corridor_cells,
    "commercial_new",
    false,
    "swfl",
  );
  const top_cooling_swfl_alt = rankCorridorIdsForScope(
    corridor_cells,
    "commercial_alteration",
    true,
    "swfl",
  );
  const top_cooling_swfl_new = rankCorridorIdsForScope(
    corridor_cells,
    "commercial_new",
    true,
    "swfl",
  );

  const total_cell_count = corridor_cells.length;
  const low_n_cell_count = corridor_cells.filter(
    (c) => c.n_current < LOW_N_THRESHOLD,
  ).length;
  const corridorsWithAnyDenseCell = new Set(
    corridor_cells
      .filter((c) => c.n_current >= LOW_N_THRESHOLD)
      .map((c) => c.corridor_id),
  );
  const corridorsWithDataAll = new Set(
    corridor_cells.map((c) => c.corridor_id),
  );
  const thin_corridor_share =
    corridorsWithDataAll.size === 0
      ? 0
      : 1 - corridorsWithAnyDenseCell.size / corridorsWithDataAll.size;

  let earliest = Infinity;
  for (const p of permits) {
    const t = Date.parse(p.issued_date);
    if (!Number.isNaN(t) && t < earliest) earliest = t;
  }
  const backfill_days =
    earliest === Infinity
      ? 0
      : Math.floor((now.getTime() - earliest) / 86400_000);

  const lee_row_count = permits.filter((p) => p.county === "lee").length;
  const collier_row_count = permits.filter(
    (p) => p.county === "collier",
  ).length;

  return {
    corridor_cells,
    zip_cells,
    swfl_weighted_z,
    lee_weighted_z,
    collier_weighted_z,
    swfl_saturation_index,
    lee_saturation_index,
    collier_saturation_index,
    top_heating_lee_alt,
    top_heating_lee_new,
    top_cooling_lee_alt,
    top_cooling_lee_new,
    top_heating_swfl_alt,
    top_heating_swfl_new,
    top_cooling_swfl_alt,
    top_cooling_swfl_new,
    low_n_cell_count,
    total_cell_count,
    thin_corridor_share,
    backfill_days,
    collier_backfill_months: backfillMonthsForCounty(permits, "collier"),
    lee_backfill_months: backfillMonthsForCounty(permits, "lee"),
    lee_row_count,
    collier_row_count,
    lee_max_issued_date: maxIssuedDateForCounty(permits, "lee"),
    collier_max_issued_date: maxIssuedDateForCounty(permits, "collier"),
    storm_caveat_fires: false,
  };
}

// Module-level state for corpusSummary -> outputProducer handoff.
let lastSnapshot: PermitsSnapshot | null = null;
let lastFetchedAt: string | null = null;
let lastLeeFetchedAt: string | null = null;
let lastCollierFetchedAt: string | null = null;
let lastCollierDroppedNullBucket = 0;
let lastCollierDroppedNullDate = 0;

function rowsFromFragments(fragments: RawFragment[]): NormalizedPermitRow[] {
  return fragments
    .map((f) => f.normalized as unknown as NormalizedPermitRow)
    .filter((r): r is NormalizedPermitRow => !!r && typeof r === "object");
}

function permitsCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  // Reset singletons so each build gets a fresh snapshot.
  lastSnapshot = null;
  lastFetchedAt = null;
  lastLeeFetchedAt = null;
  lastCollierFetchedAt = null;

  // Per-source fetched_at (newest fragment timestamp from each county).
  for (const f of allFragments) {
    if (f.source_id === "lee_building_permits") {
      if (!lastLeeFetchedAt || f.fetched_at > lastLeeFetchedAt) {
        lastLeeFetchedAt = f.fetched_at;
      }
    } else if (f.source_id === "collier_building_permits") {
      if (!lastCollierFetchedAt || f.fetched_at > lastCollierFetchedAt) {
        lastCollierFetchedAt = f.fetched_at;
      }
    }
  }

  // Pull dropped-row counters from the Collier source (set during its fetch()).
  const dropped = getCollierDroppedRowCounts();
  lastCollierDroppedNullBucket = dropped.nullBucket;
  lastCollierDroppedNullDate = dropped.nullDate;

  const rows = rowsFromFragments(allFragments);
  if (rows.length === 0) {
    return [];
  }
  const now = new Date();
  const snap = buildSnapshot(rows, CORRIDOR_CENTROIDS, now);
  lastSnapshot = snap;
  lastFetchedAt = now.toISOString();

  return [
    {
      topic: "corpus_overview",
      fact: "SWFL building-permits corpus (Lee + Collier)",
      value: `${rows.length.toLocaleString()} permits (Lee ${snap.lee_row_count.toLocaleString()}, Collier ${snap.collier_row_count.toLocaleString()}) in trailing ${snap.backfill_days}d window across ${snap.total_cell_count} (corridor x bucket) cells. SWFL-weighted z = ${snap.swfl_weighted_z.toFixed(2)}, SWFL saturation = ${snap.swfl_saturation_index.toFixed(2)}.`,
      source_fragment_ids: [],
    },
  ];
}

function buildSourceMeta(
  scope: "lee" | "collier" | "swfl",
): BrainOutputMetricSource {
  const leeFetched =
    lastLeeFetchedAt ?? lastFetchedAt ?? new Date().toISOString();
  const collierFetched =
    lastCollierFetchedAt ?? lastFetchedAt ?? new Date().toISOString();
  if (scope === "lee") {
    return {
      url: "https://aca-prod.accela.com/LEECO/Cap/CapHome.aspx?module=Permitting&TabName=Permitting",
      fetched_at: leeFetched,
      tier: 1,
      citation:
        "Lee County Accela Citizen Access — building permit records, daily scrape via Firecrawl + dlt; corridor assignment via nearest-centroid.",
    };
  }
  if (scope === "collier") {
    return {
      url: "https://www.colliercountyfl.gov/Business-Resources/Building-Permits-Construction/Meetings-Advisory-Boards-Reports/Monthly-Building-Permit-Reports",
      fetched_at: collierFetched,
      tier: 1,
      citation:
        "Collier County Building Permits — monthly XLSX, Firecrawl stealth proxy + Census batch geocode; corridor assignment via nearest-centroid.",
    };
  }
  // SWFL rollup — single URL anchor (Lee Accela), multi-source citation text.
  return {
    url: "https://aca-prod.accela.com/LEECO/Cap/CapHome.aspx?module=Permitting&TabName=Permitting",
    fetched_at: leeFetched,
    tier: 1,
    citation:
      "Lee + Collier County Building Permits (SWFL rollup) — Lee: Accela; Collier: colliercountyfl.gov monthly XLSX.",
  };
}

function classifyDirection(snap: PermitsSnapshot): BrainOutputDirection {
  if (snap.thin_corridor_share > THIN_CORRIDOR_SHARE_THRESHOLD)
    return "neutral";

  const headlinedCorridors = new Set(
    snap.corridor_cells
      .filter((c) => (HEADLINE_BUCKETS as readonly string[]).includes(c.bucket))
      .map((c) => c.corridor_id),
  );
  if (headlinedCorridors.size === 0) return "neutral";

  const anyStrongPos = snap.corridor_cells.some(
    (c) =>
      (HEADLINE_BUCKETS as readonly string[]).includes(c.bucket) && c.z >= 1.0,
  );
  const anyStrongNeg = snap.corridor_cells.some(
    (c) =>
      (HEADLINE_BUCKETS as readonly string[]).includes(c.bucket) && c.z <= -1.0,
  );
  if (anyStrongPos && anyStrongNeg) return "mixed";

  if (snap.swfl_weighted_z > 1.0) return "bullish";
  if (snap.swfl_weighted_z < -1.0) return "bearish";
  return "neutral";
}

function directionWord(z: number): string {
  if (z > 1.0) return "bullish";
  if (z < -1.0) return "bearish";
  if (z > 0.1) return "modestly heating";
  if (z < -0.1) return "modestly cooling";
  return "neutral";
}

function isCollierStale(snap: PermitsSnapshot, now: Date): boolean {
  if (!snap.collier_max_issued_date) return true;
  const t = Date.parse(snap.collier_max_issued_date);
  if (Number.isNaN(t)) return true;
  return (now.getTime() - t) / 86400_000 > COLLIER_STALE_DAYS;
}

function buildConclusionProse(snap: PermitsSnapshot, now: Date): string {
  const swflZ = snap.swfl_weighted_z.toFixed(2);
  const leeZ = snap.lee_weighted_z.toFixed(2);
  const collierZ = snap.collier_weighted_z.toFixed(2);
  const swflSat = (snap.swfl_saturation_index * 100).toFixed(0);
  const heatList = snap.top_heating_swfl_alt.slice(0, 3).join(", ") || "none";
  const coolList = snap.top_cooling_swfl_alt.slice(0, 3).join(", ") || "none";

  const collierEmpty = snap.collier_row_count === 0;
  const collierStale = isCollierStale(snap, now);

  const parts: string[] = [];

  if (collierEmpty) {
    parts.push(
      `Lee permit flow reads ${directionWord(snap.lee_weighted_z)} (county-weighted z = ${leeZ}, ${swflSat}% of corridors saturated at z >= +2 in commercial buckets).`,
    );
    parts.push(
      `Naples (Collier) feed returned zero rows this build — SWFL rollup excludes Collier.`,
    );
  } else if (collierStale) {
    parts.push(
      `Lee permit flow reads ${directionWord(snap.lee_weighted_z)} (county-weighted z = ${leeZ}).`,
    );
    const lastDate = snap.collier_max_issued_date ?? "unknown";
    parts.push(
      `Naples feed last refreshed ${lastDate}; current build excludes Collier from the SWFL rollup.`,
    );
  } else {
    const leeDir = directionWord(snap.lee_weighted_z);
    const collierDir = directionWord(snap.collier_weighted_z);
    const directionsDiverge =
      (snap.lee_weighted_z > 0.1 && snap.collier_weighted_z < -0.1) ||
      (snap.lee_weighted_z < -0.1 && snap.collier_weighted_z > 0.1);
    if (directionsDiverge) {
      parts.push(
        `SWFL permit flow splits: Lee ${leeDir} (z = ${leeZ}) while Naples ${collierDir} (z = ${collierZ}). SWFL-weighted z = ${swflZ}.`,
      );
    } else {
      parts.push(
        `SWFL permit flow reads ${directionWord(snap.swfl_weighted_z)} (SWFL-weighted z = ${swflZ}, ${swflSat}% of corridors saturated at z >= +2 in commercial buckets). Lee z = ${leeZ}, Naples z = ${collierZ}.`,
      );
    }
  }

  parts.push(
    `Highest commercial-alteration heat: ${heatList}. Coolest: ${coolList}.`,
  );

  if (snap.swfl_saturation_index >= 0.4) {
    parts.push(
      `Contrarian read: top corridors are running well above baseline - late mover risk. Similar-demographic corridors with lower z may offer cleaner entry.`,
    );
  }
  return parts.join(" ");
}

function emitTopList(
  metricName: string,
  values: string[],
  label: string,
  source: BrainOutputMetricSource,
  out: BrainOutputMetric[],
): void {
  if (values.length === 0) return;
  out.push({
    metric: metricName,
    value: values.join(","),
    direction: "stable",
    label,
    variable_type: "categorical",
    source,
  });
}

function permitsOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snap = lastSnapshot;
  const fetched_at = lastFetchedAt ?? isoDate() + "T00:00:00Z";

  if (!snap) {
    return {
      conclusion:
        "permits-swfl could not load any SWFL building-permit rows this build (Lee Accela + Collier monthly XLSX).",
      key_metrics: [],
      caveats: [
        "Zero rows from both Lee Accela and Collier XLSX ingest. Verify Firecrawl jobs completed + data_lake.lee_building_permits / data_lake.collier_building_permits have recent rows.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const now = new Date(fetched_at);
  const leeSource = buildSourceMeta("lee");
  const collierSource = buildSourceMeta("collier");
  const swflSource = buildSourceMeta("swfl");
  const direction = classifyDirection(snap);
  const magnitude = Math.min(1, Math.abs(snap.swfl_weighted_z) / 3);

  const key_metrics: BrainOutputMetric[] = [];

  // County-weighted z — SWFL rollup + Lee split + Collier split.
  key_metrics.push({
    metric: "permits_swfl_county_weighted_avg_corridor_z",
    value: Number(snap.swfl_weighted_z.toFixed(3)),
    direction:
      snap.swfl_weighted_z > 0.1
        ? "rising"
        : snap.swfl_weighted_z < -0.1
          ? "falling"
          : "stable",
    label:
      "SWFL permits - corridor-weighted z-score across Lee + Collier, current 90d vs trailing-365d (rate-normalized)",
    variable_type: "intensive",
    units: "z-score",
    display_format: "ratio",
    source: swflSource,
  });
  key_metrics.push({
    metric: "permits_lee_county_weighted_avg_corridor_z",
    value: Number(snap.lee_weighted_z.toFixed(3)),
    direction:
      snap.lee_weighted_z > 0.1
        ? "rising"
        : snap.lee_weighted_z < -0.1
          ? "falling"
          : "stable",
    label:
      "Lee County permits - corridor-weighted z-score, current 90d vs trailing-365d (rate-normalized)",
    variable_type: "intensive",
    units: "z-score",
    display_format: "ratio",
    source: leeSource,
  });
  if (snap.collier_row_count > 0) {
    key_metrics.push({
      metric: "permits_collier_county_weighted_avg_corridor_z",
      value: Number(snap.collier_weighted_z.toFixed(3)),
      direction:
        snap.collier_weighted_z > 0.1
          ? "rising"
          : snap.collier_weighted_z < -0.1
            ? "falling"
            : "stable",
      label:
        "Collier County permits - corridor-weighted z-score, current 90d vs trailing-365d (rate-normalized)",
      variable_type: "intensive",
      units: "z-score",
      display_format: "ratio",
      source: collierSource,
    });
  }

  // Saturation index — same three-tier emission.
  key_metrics.push({
    metric: "permits_swfl_saturation_index",
    value: Number(snap.swfl_saturation_index.toFixed(3)),
    direction:
      snap.swfl_saturation_index > 0.4
        ? "rising"
        : snap.swfl_saturation_index < 0.2
          ? "falling"
          : "stable",
    label:
      "SWFL permits - share of corridors with z >= +2 in commercial buckets (saturation / contrarian signal)",
    variable_type: "intensive",
    units: "share",
    display_format: "percent",
    source: swflSource,
  });
  key_metrics.push({
    metric: "permits_lee_saturation_index",
    value: Number(snap.lee_saturation_index.toFixed(3)),
    direction:
      snap.lee_saturation_index > 0.4
        ? "rising"
        : snap.lee_saturation_index < 0.2
          ? "falling"
          : "stable",
    label:
      "Lee County permits - share of corridors with z >= +2 in commercial buckets (saturation / contrarian signal)",
    variable_type: "intensive",
    units: "share",
    display_format: "percent",
    source: leeSource,
  });
  if (snap.collier_row_count > 0) {
    key_metrics.push({
      metric: "permits_collier_saturation_index",
      value: Number(snap.collier_saturation_index.toFixed(3)),
      direction:
        snap.collier_saturation_index > 0.4
          ? "rising"
          : snap.collier_saturation_index < 0.2
            ? "falling"
            : "stable",
      label:
        "Collier County permits - share of corridors with z >= +2 in commercial buckets (saturation / contrarian signal)",
      variable_type: "intensive",
      units: "share",
      display_format: "percent",
      source: collierSource,
    });
  }

  // Per-corridor cell metrics — keep `permits_lee_corridor_*` (unchanged) +
  // add `permits_collier_corridor_*` (new). Slug uniqueness already
  // disambiguates Naples corridors from Lee.
  for (const cell of snap.corridor_cells) {
    const prefix = cell.county === "lee" ? "permits_lee" : "permits_collier";
    const source = cell.county === "lee" ? leeSource : collierSource;
    key_metrics.push({
      metric: `${prefix}_corridor_${cell.corridor_id}_${cell.bucket}_z`,
      value: Number(cell.z.toFixed(3)),
      direction: cell.z > 0.5 ? "rising" : cell.z < -0.5 ? "falling" : "stable",
      label: `${cell.county === "lee" ? "Lee" : "Collier"} permits - ${displayNameFor(cell.corridor_id)}, ${cell.bucket} - 90d vs trailing-365d z (n_current=${cell.n_current})`,
      variable_type: "intensive",
      units: "z-score",
      display_format: "ratio",
      source,
    });
  }

  // ZIP cells — Lee-only (Collier table has no zip_code column).
  for (const cell of snap.zip_cells) {
    key_metrics.push({
      metric: `permits_lee_zip_${cell.zip_code}_${cell.bucket}_z`,
      value: Number(cell.z.toFixed(3)),
      direction: cell.z > 0.5 ? "rising" : cell.z < -0.5 ? "falling" : "stable",
      label: `Lee permits - ZIP ${cell.zip_code}, ${cell.bucket} - 90d vs trailing-365d z (n_current=${cell.n_current})`,
      variable_type: "intensive",
      units: "z-score",
      display_format: "ratio",
      source: leeSource,
    });
  }

  // Top heating/cooling — additive emission per 4g pre-condition: cre-swfl
  // reads `permits_lee_top_heating_commercial_alteration` directly, so we
  // keep all four Lee-scoped metrics intact AND ship parallel SWFL versions.
  emitTopList(
    "permits_lee_top_heating_commercial_alteration",
    snap.top_heating_lee_alt,
    "Lee permits - corridors with highest commercial_alteration z, current 90d (rank-ordered)",
    leeSource,
    key_metrics,
  );
  emitTopList(
    "permits_lee_top_heating_commercial_new",
    snap.top_heating_lee_new,
    "Lee permits - corridors with highest commercial_new z, current 90d",
    leeSource,
    key_metrics,
  );
  emitTopList(
    "permits_lee_top_cooling_commercial_alteration",
    snap.top_cooling_lee_alt,
    "Lee permits - corridors with lowest commercial_alteration z, current 90d",
    leeSource,
    key_metrics,
  );
  emitTopList(
    "permits_lee_top_cooling_commercial_new",
    snap.top_cooling_lee_new,
    "Lee permits - corridors with lowest commercial_new z, current 90d",
    leeSource,
    key_metrics,
  );
  emitTopList(
    "permits_swfl_top_heating_commercial_alteration",
    snap.top_heating_swfl_alt,
    "SWFL permits - corridors with highest commercial_alteration z across Lee + Collier, current 90d (rank-ordered)",
    swflSource,
    key_metrics,
  );
  emitTopList(
    "permits_swfl_top_heating_commercial_new",
    snap.top_heating_swfl_new,
    "SWFL permits - corridors with highest commercial_new z across Lee + Collier, current 90d",
    swflSource,
    key_metrics,
  );
  emitTopList(
    "permits_swfl_top_cooling_commercial_alteration",
    snap.top_cooling_swfl_alt,
    "SWFL permits - corridors with lowest commercial_alteration z across Lee + Collier, current 90d",
    swflSource,
    key_metrics,
  );
  emitTopList(
    "permits_swfl_top_cooling_commercial_new",
    snap.top_cooling_swfl_new,
    "SWFL permits - corridors with lowest commercial_new z across Lee + Collier, current 90d",
    swflSource,
    key_metrics,
  );

  const caveats: string[] = [];
  if (snap.backfill_days < 365) {
    caveats.push(
      `Accela backfill window is ${snap.backfill_days}d (< 365d) - historical baseline is incomplete; z-scores are indicative, not robust.`,
    );
  }
  if (snap.low_n_cell_count > 0) {
    caveats.push(
      `${snap.low_n_cell_count} of ${snap.total_cell_count} (corridor x bucket) cells have n < 10 in the current 90d window — z-scores on those cells are computed against small samples.`,
    );
  }
  if (snap.storm_caveat_fires) {
    caveats.push(
      `storm-history-swfl reports a major event in the current 90d window; corridor z-scores may understate normal activity.`,
    );
  }
  if (snap.thin_corridor_share > THIN_CORRIDOR_SHARE_THRESHOLD) {
    caveats.push(
      `${Math.round(snap.thin_corridor_share * 100)}% of corridors have no cell with n >= 10 in the current window - county direction reads as neutral by construction.`,
    );
  }
  if (lastCollierDroppedNullBucket > 0) {
    caveats.push(
      `${lastCollierDroppedNullBucket} Collier row${lastCollierDroppedNullBucket === 1 ? "" : "s"} skipped (NULL bucket — ingest classifier gap).`,
    );
  }
  if (lastCollierDroppedNullDate > 0) {
    caveats.push(
      `${lastCollierDroppedNullDate} Collier row${lastCollierDroppedNullDate === 1 ? "" : "s"} skipped (NULL date_issued).`,
    );
  }
  if (snap.collier_row_count === 0) {
    caveats.push(
      `Naples permits feed returned zero rows this build — likely Collier WAF re-fired. SWFL rollup uses Lee only.`,
    );
  } else if (snap.collier_max_issued_date) {
    const t = Date.parse(snap.collier_max_issued_date);
    if (!Number.isNaN(t)) {
      const ageDays = Math.floor((now.getTime() - t) / 86400_000);
      if (ageDays > COLLIER_STALE_DAYS) {
        caveats.push(
          `Most recent Naples permit issued ${snap.collier_max_issued_date}; monthly XLSX has not refreshed for ${ageDays} days (cadence 30d). Collier signal in this build is stale.`,
        );
      }
    }
  }
  if (snap.lee_max_issued_date) {
    const t = Date.parse(snap.lee_max_issued_date);
    if (!Number.isNaN(t)) {
      const ageDays = Math.floor((now.getTime() - t) / 86400_000);
      if (ageDays > LEE_STALE_DAYS) {
        caveats.push(
          `Most recent Lee permit issued ${snap.lee_max_issued_date}; daily Accela scrape may be stalled (${ageDays} days since last issue).`,
        );
      }
    }
  }
  if (
    snap.collier_row_count > 0 &&
    snap.collier_backfill_months < COLLIER_SHORT_BASELINE_MONTHS
  ) {
    caveats.push(
      `Collier z-scores are based on ${snap.collier_backfill_months} month${snap.collier_backfill_months === 1 ? "" : "s"} of data; signal stabilizes after 6+ months. Treat Collier values as directional only.`,
    );
  }

  return {
    conclusion: buildConclusionProse(snap, now),
    key_metrics,
    caveats,
    direction,
    magnitude,
    drivers: snap.storm_caveat_fires ? ["storm-history-swfl"] : [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

/**
 * Stage 4 sidecar: publish per-corridor permit z-scores as a named JSON
 * artifact (`fixtures/corridor-permits.json`). Naples corridors land in the
 * same sidecar as Lee — cre-swfl reads by corridor_id only, so the shape is
 * unchanged.
 *
 * Per-corridor `headline_z` formula: weighted average of all non-`"other"`
 * bucket cells with `n_current >= LOW_N_THRESHOLD`, weighted by `n_current`.
 * Corridors with zero qualifying cells are omitted from the output entirely.
 */
async function permitsSidecarProducer(
  _output: PackOutput,
  _rawFragments: ReadonlyArray<RawFragment>,
): Promise<Array<{ name: string; data: unknown }>> {
  const snap = lastSnapshot;
  const fetched_at = lastFetchedAt ?? new Date().toISOString();
  if (!snap || snap.corridor_cells.length === 0) {
    return [];
  }

  const byCorridor = new Map<
    string,
    { weightedSum: number; weightSum: number }
  >();
  for (const cell of snap.corridor_cells) {
    if (cell.bucket === "other") continue;
    if (cell.n_current < LOW_N_THRESHOLD) continue;
    const acc = byCorridor.get(cell.corridor_id) ?? {
      weightedSum: 0,
      weightSum: 0,
    };
    acc.weightedSum += cell.z * cell.n_current;
    acc.weightSum += cell.n_current;
    byCorridor.set(cell.corridor_id, acc);
  }

  const rows = Array.from(byCorridor.entries())
    .map(([corridor_id, { weightedSum, weightSum }]) => ({
      corridor_id,
      headline_z: Number((weightedSum / weightSum).toFixed(3)),
      n_current: weightSum,
      last_refined_at: fetched_at,
    }))
    .sort((a, b) => a.corridor_id.localeCompare(b.corridor_id));

  return [{ name: "corridor-permits", data: rows }];
}

export const permitsSwfl: PackDefinition = {
  id: BRAIN_ID,
  brain_id: BRAIN_ID,
  public_label: "Building Permits",
  domain: "real-estate",
  scope:
    "SWFL building-permit issuance flow (Lee + Collier) - corridor-level z-scores, saturation index, per-county splits, and trend reads against a trailing 13-window (28d each) historical baseline.",
  ttl_seconds: 604800, // 7 days — Lee permits ingest weekly (cadence_registry lee_permits=7), Collier monthly
  sources: [permitsSource, collierPermitsSource],
  input_brains: [{ id: "storm-history-swfl", edge_type: "modifier" }],
  fitScore: () => 10,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: permitsCorpusSummary,
  outputProducer: permitsOutputProducer,
  sidecarProducer: permitsSidecarProducer,
  preferences: [
    "The user reads permit flow as a leading indicator of tenant demand and capital commitment in commercial corridors.",
    "Rate-normalized z-scores are the headline signal; raw counts are secondary context.",
    "When SWFL saturation_index is high, the user wants the contrarian read surfaced first - not the directional read.",
    "Lee + Collier divergence is information, not noise — surface it explicitly when county-weighted z-scores point opposite directions.",
  ],
  activeProject:
    "permits-swfl: track Lee + Collier commercial permit velocity as a leading CRE demand signal across SWFL.",
  prompts: {
    triageContext:
      "A SWFL (Lee or Collier) building permit is decision-relevant when it falls in the commercial_new or commercial_alteration bucket and can be assigned to a tracked corridor. Residential and demolition permits are informational context only.",
    synthesisContext:
      "Produce a corridor-level rate-of-change read using z-scores against the trailing historical baseline. Quote the SWFL saturation index when >= 0.4. Surface Lee + Collier divergence when their county-weighted z-scores point opposite directions. Surface the contrarian read explicitly when saturation is high. Never infer absorption or leasing outcomes from permit counts alone.",
  },
};

export { ALL_BUCKETS };
