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
  type LeePermitRow,
} from "../sources/permits-source.mts";
import {
  assignCorridor,
  type CorridorCentroid,
} from "../lib/corridor-assignment.mts";
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
type Bucket = (typeof ALL_BUCKETS)[number];

const MAX_CORRIDOR_RADIUS_MI = 1.5;
const LOW_N_THRESHOLD = 10;
const SATURATION_Z_THRESHOLD = 2.0;
const THIN_CORRIDOR_SHARE_THRESHOLD = 0.7;

// Corridor centroids loaded synchronously at module init (small fixture, Path B).
// Backlog: pull from Sanity via cre-source pattern once stable.
const CORRIDOR_FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "__fixtures__",
  "lee-corridor-centroids.sample.json",
);
const CORRIDOR_CENTROIDS: CorridorCentroid[] = JSON.parse(
  readFileSync(CORRIDOR_FIXTURE_PATH, "utf-8"),
);

export interface CorridorBucketCell {
  corridor_id: string;
  corridor_label: string;
  bucket: Bucket;
  z: number;
  n_current: number;
  current_rate: number;
  historical_mean_rate: number;
}

export interface ZipBucketCell {
  zip_code: string;
  bucket: Bucket;
  z: number;
  n_current: number;
  current_rate: number;
  historical_mean_rate: number;
}

export interface PermitsSnapshot {
  corridor_cells: CorridorBucketCell[];
  zip_cells: ZipBucketCell[];
  county_weighted_z: number;
  saturation_index: number;
  top_heating_ci_alt: string[];
  top_heating_ci_new: string[];
  top_cooling_ci_alt: string[];
  top_cooling_ci_new: string[];
  low_n_cell_count: number;
  total_cell_count: number;
  thin_corridor_share: number;
  backfill_days: number;
  storm_caveat_fires: boolean;
}

interface PermitWithCorridor extends LeePermitRow {
  __corridor_id: string | null;
  __corridor_label: string | null;
}

function enrichWithCorridor(
  permits: LeePermitRow[],
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

export function buildSnapshot(
  permits: LeePermitRow[],
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
    const [corridor_id, bucket] = key.split("::") as [string, Bucket];
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
      bucket,
      z,
      n_current,
      current_rate,
      historical_mean_rate,
    });
  }

  const zip_cells: ZipBucketCell[] = [];
  for (const [key, group] of byZipBucket.entries()) {
    const [zip_code, bucket] = key.split("::") as [string, Bucket];
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

  let weightedSum = 0;
  let weightSum = 0;
  for (const cell of corridor_cells) {
    if (cell.bucket === "other") continue;
    weightedSum += cell.z * cell.n_current;
    weightSum += cell.n_current;
  }
  const county_weighted_z = weightSum === 0 ? 0 : weightedSum / weightSum;

  const corridorsWithData = new Set(corridor_cells.map((c) => c.corridor_id));
  const saturatedCorridors = new Set(
    corridor_cells
      .filter(
        (c) =>
          (HEADLINE_BUCKETS as readonly string[]).includes(c.bucket) &&
          c.z >= SATURATION_Z_THRESHOLD,
      )
      .map((c) => c.corridor_id),
  );
  const saturation_index =
    corridorsWithData.size === 0
      ? 0
      : saturatedCorridors.size / corridorsWithData.size;

  function rankCorridorIds(bucket: Bucket, ascending: boolean): string[] {
    return corridor_cells
      .filter((c) => c.bucket === bucket && c.n_current >= LOW_N_THRESHOLD)
      .sort((a, b) => (ascending ? a.z - b.z : b.z - a.z))
      .slice(0, 5)
      .map((c) => c.corridor_id);
  }
  const top_heating_ci_alt = rankCorridorIds("commercial_alteration", false);
  const top_heating_ci_new = rankCorridorIds("commercial_new", false);
  const top_cooling_ci_alt = rankCorridorIds("commercial_alteration", true);
  const top_cooling_ci_new = rankCorridorIds("commercial_new", true);

  const total_cell_count = corridor_cells.length;
  const low_n_cell_count = corridor_cells.filter(
    (c) => c.n_current < LOW_N_THRESHOLD,
  ).length;
  const corridorsWithAnyDenseCell = new Set(
    corridor_cells
      .filter((c) => c.n_current >= LOW_N_THRESHOLD)
      .map((c) => c.corridor_id),
  );
  const thin_corridor_share =
    corridorsWithData.size === 0
      ? 0
      : 1 - corridorsWithAnyDenseCell.size / corridorsWithData.size;

  let earliest = Infinity;
  for (const p of permits) {
    const t = Date.parse(p.issued_date);
    if (!Number.isNaN(t) && t < earliest) earliest = t;
  }
  const backfill_days =
    earliest === Infinity
      ? 0
      : Math.floor((now.getTime() - earliest) / 86400_000);

  return {
    corridor_cells,
    zip_cells,
    county_weighted_z,
    saturation_index,
    top_heating_ci_alt,
    top_heating_ci_new,
    top_cooling_ci_alt,
    top_cooling_ci_new,
    low_n_cell_count,
    total_cell_count,
    thin_corridor_share,
    backfill_days,
    storm_caveat_fires: false,
  };
}

// Module-level state for corpusSummary -> outputProducer handoff.
let lastSnapshot: PermitsSnapshot | null = null;
let lastFetchedAt: string | null = null;

function rowsFromFragments(fragments: RawFragment[]): LeePermitRow[] {
  return fragments
    .map((f) => f.normalized as unknown as LeePermitRow)
    .filter((r): r is LeePermitRow => !!r && typeof r === "object");
}

function permitsCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  // Reset singleton so each build gets a fresh snapshot.
  lastSnapshot = null;
  lastFetchedAt = null;

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
      fact: "Lee County building-permits corpus",
      value: `${rows.length.toLocaleString()} permits in trailing ${snap.backfill_days}d window across ${snap.total_cell_count} (corridor x bucket) cells. County-weighted z = ${snap.county_weighted_z.toFixed(2)}, saturation index = ${snap.saturation_index.toFixed(2)}.`,
      source_fragment_ids: [],
    },
  ];
}

function buildSourceMeta(fetched_at: string): BrainOutputMetricSource {
  return {
    url: "https://accela.leegov.com/CitizenAccess/Cap/CapHome.aspx?module=Building",
    fetched_at,
    tier: 1,
    citation:
      "Lee County Accela Citizen Access — building permit records, daily scrape via Firecrawl + dlt; corridor assignment via nearest-centroid.",
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

  if (snap.county_weighted_z > 1.0) return "bullish";
  if (snap.county_weighted_z < -1.0) return "bearish";
  return "neutral";
}

function buildConclusionProse(snap: PermitsSnapshot): string {
  const direction = classifyDirection(snap);
  const cwz = snap.county_weighted_z.toFixed(2);
  const sat = (snap.saturation_index * 100).toFixed(0);
  const heatList = snap.top_heating_ci_alt.slice(0, 3).join(", ") || "none";
  const coolList = snap.top_cooling_ci_alt.slice(0, 3).join(", ") || "none";

  const parts: string[] = [];
  parts.push(
    `Lee County permit flow reads ${direction} (county-weighted z = ${cwz}, ${sat}% of corridors saturated at z >= +2 in commercial buckets).`,
  );
  parts.push(
    `Highest commercial-alteration heat: ${heatList}. Coolest: ${coolList}.`,
  );
  if (snap.saturation_index >= 0.4) {
    parts.push(
      `Contrarian read: top corridors are running well above baseline - late mover risk. Similar-demographic corridors with lower z may offer cleaner entry.`,
    );
  }
  return parts.join(" ");
}

function permitsOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snap = lastSnapshot;
  const fetched_at = lastFetchedAt ?? isoDate() + "T00:00:00Z";

  if (!snap) {
    return {
      conclusion:
        "permits-swfl could not load any Lee County Accela permit rows this build.",
      key_metrics: [],
      caveats: [
        "Zero rows from Accela ingest. Verify Firecrawl job completed + data_lake.lee_building_permits has recent rows.",
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
  const direction = classifyDirection(snap);
  const magnitude = Math.min(1, Math.abs(snap.county_weighted_z) / 3);

  const key_metrics: BrainOutputMetric[] = [];

  key_metrics.push({
    metric: "permits_lee_county_weighted_avg_corridor_z",
    value: Number(snap.county_weighted_z.toFixed(3)),
    direction:
      snap.county_weighted_z > 0.1
        ? "rising"
        : snap.county_weighted_z < -0.1
          ? "falling"
          : "stable",
    label:
      "Lee County permits - corridor-weighted z-score, current 90d vs trailing-365d (rate-normalized)",
    variable_type: "intensive",
    units: "z-score",
    display_format: "ratio",
    source,
  });

  key_metrics.push({
    metric: "permits_lee_saturation_index",
    value: Number(snap.saturation_index.toFixed(3)),
    direction:
      snap.saturation_index > 0.4
        ? "rising"
        : snap.saturation_index < 0.2
          ? "falling"
          : "stable",
    label:
      "Lee County permits - share of corridors with z >= +2 in commercial buckets (saturation / contrarian signal)",
    variable_type: "intensive",
    units: "share",
    display_format: "percent",
    source,
  });

  for (const cell of snap.corridor_cells) {
    key_metrics.push({
      metric: `permits_lee_corridor_${cell.corridor_id}_${cell.bucket}_z`,
      value: Number(cell.z.toFixed(3)),
      direction: cell.z > 0.5 ? "rising" : cell.z < -0.5 ? "falling" : "stable",
      label: `Lee permits - ${cell.corridor_label}, ${cell.bucket} - 90d vs trailing-365d z (n_current=${cell.n_current})`,
      variable_type: "intensive",
      units: "z-score",
      display_format: "ratio",
      source,
    });
  }

  for (const cell of snap.zip_cells) {
    key_metrics.push({
      metric: `permits_lee_zip_${cell.zip_code}_${cell.bucket}_z`,
      value: Number(cell.z.toFixed(3)),
      direction: cell.z > 0.5 ? "rising" : cell.z < -0.5 ? "falling" : "stable",
      label: `Lee permits - ZIP ${cell.zip_code}, ${cell.bucket} - 90d vs trailing-365d z (n_current=${cell.n_current})`,
      variable_type: "intensive",
      units: "z-score",
      display_format: "ratio",
      source,
    });
  }

  if (snap.top_heating_ci_alt.length > 0) {
    key_metrics.push({
      metric: "permits_lee_top_heating_commercial_alteration",
      value: snap.top_heating_ci_alt.join(","),
      direction: "stable",
      label:
        "Lee permits - corridors with highest commercial_alteration z, current 90d (rank-ordered)",
      variable_type: "categorical",
      source,
    });
  }
  if (snap.top_heating_ci_new.length > 0) {
    key_metrics.push({
      metric: "permits_lee_top_heating_commercial_new",
      value: snap.top_heating_ci_new.join(","),
      direction: "stable",
      label: "Lee permits - corridors with highest commercial_new z, current 90d",
      variable_type: "categorical",
      source,
    });
  }
  if (snap.top_cooling_ci_alt.length > 0) {
    key_metrics.push({
      metric: "permits_lee_top_cooling_commercial_alteration",
      value: snap.top_cooling_ci_alt.join(","),
      direction: "stable",
      label:
        "Lee permits - corridors with lowest commercial_alteration z, current 90d",
      variable_type: "categorical",
      source,
    });
  }
  if (snap.top_cooling_ci_new.length > 0) {
    key_metrics.push({
      metric: "permits_lee_top_cooling_commercial_new",
      value: snap.top_cooling_ci_new.join(","),
      direction: "stable",
      label:
        "Lee permits - corridors with lowest commercial_new z, current 90d",
      variable_type: "categorical",
      source,
    });
  }

  const caveats: string[] = [];
  if (snap.backfill_days < 365) {
    caveats.push(
      `Accela backfill window is ${snap.backfill_days}d (< 365d) - historical baseline is incomplete; z-scores are indicative, not robust.`,
    );
  }
  if (snap.low_n_cell_count > 0) {
    caveats.push(
      `${snap.low_n_cell_count} of ${snap.total_cell_count} (corridor x bucket) cells have n < 10 in the current 90d window - those z-scores carry low confidence.`,
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

  return {
    conclusion: buildConclusionProse(snap),
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

export const permitsSwfl: PackDefinition = {
  id: BRAIN_ID,
  brain_id: BRAIN_ID,
  domain: "real-estate",
  scope:
    "Lee County building-permit issuance flow - corridor-level z-scores, saturation index, and trend reads against a trailing 13-window (28d each) historical baseline.",
  ttl_seconds: 86400,
  sources: [permitsSource],
  input_brains: [{ id: "storm-history-swfl", edge_type: "modifier" }],
  fitScore: () => 10,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: permitsCorpusSummary,
  outputProducer: permitsOutputProducer,
  preferences: [
    "The user reads permit flow as a leading indicator of tenant demand and capital commitment in commercial corridors.",
    "Rate-normalized z-scores are the headline signal; raw counts are secondary context.",
    "When saturation_index is high, the user wants the contrarian read surfaced first - not the directional read.",
  ],
  activeProject:
    "permits-swfl: track Lee County commercial permit velocity as a leading CRE demand signal.",
  prompts: {
    triageContext:
      "A Lee County building permit is decision-relevant when it falls in the commercial_new or commercial_alteration bucket and can be assigned to a tracked corridor. Residential and demolition permits are informational context only.",
    synthesisContext:
      "Produce a corridor-level rate-of-change read using z-scores against the trailing historical baseline. Quote the saturation index when >= 0.4. Surface the contrarian read explicitly when saturation is high. Never infer absorption or leasing outcomes from permit counts alone.",
  },
};
