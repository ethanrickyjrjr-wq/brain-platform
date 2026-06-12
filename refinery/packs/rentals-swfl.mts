import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputDirection,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import type { ZoriZipRow } from "../sources/zori-source.mts";
import { zoriZipLatestSource, type ZoriZipLatestRow } from "../sources/zori-zip-latest-source.mts";
import { env } from "../config/env.mts";

const BRAIN_ID = "rentals-swfl";

// ── Polarity bands (locked — see plan §5) ────────────────────────────────────
// All deterministic, pure code; the LLM never sees these numbers. The polarity
// frame is investor/operator — a downstream "rent affordability" consumer
// inverts the sign at consumption, not here.

const POLARITY_CAVEAT_NEUTRAL_SUB_INFLATION = "Sub-inflation rent growth — real-terms decline.";
const POLARITY_CAVEAT_BULLISH_DURABILITY = "Rent growth above wage trend — watch durability.";
const POLARITY_CAVEAT_NEUTRAL_SURGE =
  "Rent growth exceeds wage growth materially; 2021-22 SWFL surge reverted within ~18 months in most ZIPs.";

const TOP_N = 3;

// ── Domain types ─────────────────────────────────────────────────────────────

interface ZipSeries {
  zip_code: string;
  metro: string | null;
  county_name: string | null;
  city: string | null;
  /** Sorted ascending by period_end. */
  observations: Array<{ period_end: string; rent_index: number }>;
}

interface ZipSnapshot {
  zip_code: string;
  metro: string | null;
  county_name: string | null;
  city: string | null;
  /** Latest period_end seen. */
  latest_period: string;
  rent_index_latest: number;
  rent_yoy_pct: number | null;
  rent_mom_pct: number | null;
}

interface RentalsSnapshot {
  zips: ZipSnapshot[];
  regional_latest_period: string;
  regional_median_rent_index: number;
  regional_median_yoy_pct: number | null;
  zips_covered: number;
  zips_with_yoy: number;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function groupByZip(rows: ZoriZipRow[]): Map<string, ZipSeries> {
  const out = new Map<string, ZipSeries>();
  for (const r of rows) {
    let series = out.get(r.zip_code);
    if (!series) {
      series = {
        zip_code: r.zip_code,
        metro: r.metro,
        county_name: r.county_name,
        city: r.city,
        observations: [],
      };
      out.set(r.zip_code, series);
    }
    series.observations.push({
      period_end: r.period_end,
      rent_index: r.rent_index,
    });
  }
  for (const series of out.values()) {
    series.observations.sort((a, b) =>
      a.period_end < b.period_end ? -1 : a.period_end > b.period_end ? 1 : 0,
    );
  }
  return out;
}

/** Return the observation N months before `latest`, or null if not present. */
function lookbackObservation(
  observations: ZipSeries["observations"],
  monthsBack: number,
): { period_end: string; rent_index: number } | null {
  if (observations.length === 0) return null;
  const latestDate = new Date(observations[observations.length - 1].period_end);
  const target = new Date(latestDate);
  target.setUTCMonth(target.getUTCMonth() - monthsBack);

  // Walk backwards from the end until we find an observation whose date is
  // <= the target. Tolerance of 7 days for month-end-vs-month-start drift.
  const targetMs = target.getTime();
  const toleranceMs = 7 * 86400_000;
  for (let i = observations.length - 1; i >= 0; i--) {
    const obs = observations[i];
    const obsMs = new Date(obs.period_end).getTime();
    if (Math.abs(obsMs - targetMs) <= toleranceMs) return obs;
    if (obsMs < targetMs - toleranceMs) return null;
  }
  return null;
}

function buildZipSnapshot(series: ZipSeries): ZipSnapshot | null {
  const obs = series.observations;
  if (obs.length === 0) return null;
  const latest = obs[obs.length - 1];

  const yearAgo = lookbackObservation(obs, 12);
  const monthAgo = lookbackObservation(obs, 1);

  const rent_yoy_pct =
    yearAgo && yearAgo.rent_index > 0 ? (latest.rent_index / yearAgo.rent_index - 1) * 100 : null;
  const rent_mom_pct =
    monthAgo && monthAgo.rent_index > 0
      ? (latest.rent_index / monthAgo.rent_index - 1) * 100
      : null;

  return {
    zip_code: series.zip_code,
    metro: series.metro,
    county_name: series.county_name,
    city: series.city,
    latest_period: latest.period_end,
    rent_index_latest: latest.rent_index,
    rent_yoy_pct,
    rent_mom_pct,
  };
}

export function buildSnapshot(rows: ZoriZipRow[]): RentalsSnapshot | null {
  if (rows.length === 0) return null;
  const grouped = groupByZip(rows);

  const zipSnaps: ZipSnapshot[] = [];
  for (const series of grouped.values()) {
    const snap = buildZipSnapshot(series);
    if (snap) zipSnaps.push(snap);
  }
  if (zipSnaps.length === 0) return null;

  // Use the single latest period_end across all ZIPs as the regional anchor —
  // every ZIP should land on the same month after a clean ZORI publish.
  zipSnaps.sort((a, b) => (a.zip_code < b.zip_code ? -1 : a.zip_code > b.zip_code ? 1 : 0));
  const regional_latest_period = zipSnaps
    .map((z) => z.latest_period)
    .sort()
    .reverse()[0];

  const indices = zipSnaps.map((z) => z.rent_index_latest);
  const yoys = zipSnaps
    .map((z) => z.rent_yoy_pct)
    .filter((y): y is number => y !== null && Number.isFinite(y));

  return {
    zips: zipSnaps,
    regional_latest_period,
    regional_median_rent_index: median(indices),
    regional_median_yoy_pct: yoys.length > 0 ? median(yoys) : null,
    zips_covered: zipSnaps.length,
    zips_with_yoy: yoys.length,
  };
}

// ── Polarity classifier (locked per plan §5) ─────────────────────────────────

interface PolarityVerdict {
  direction: BrainOutputDirection;
  caveats: string[];
  magnitude: number;
}

export function classifyPolarity(regional_median_yoy_pct: number | null): PolarityVerdict {
  if (regional_median_yoy_pct === null) {
    return {
      direction: "neutral",
      caveats: [
        "Regional median YoY undefined — no ZIP in the corpus has a full 12-month history yet.",
      ],
      magnitude: 0,
    };
  }
  const yoy = regional_median_yoy_pct;
  const magnitude = Math.min(Math.abs(yoy) / 10, 1);

  if (yoy < 0) return { direction: "bearish", caveats: [], magnitude };
  if (yoy < 2)
    return {
      direction: "neutral",
      caveats: [POLARITY_CAVEAT_NEUTRAL_SUB_INFLATION],
      magnitude,
    };
  if (yoy <= 6) return { direction: "bullish", caveats: [], magnitude };
  if (yoy <= 10)
    return {
      direction: "bullish",
      caveats: [POLARITY_CAVEAT_BULLISH_DURABILITY],
      magnitude,
    };
  return {
    direction: "neutral",
    caveats: [POLARITY_CAVEAT_NEUTRAL_SURGE],
    magnitude,
  };
}

// ── §05: view-row snapshot builder (replaces the raw-row path post-cutover) ──
// Per-ZIP math already computed by data_lake.zori_zip_latest; this function
// only does the regional rollup (R1 — the pack still decides what numbers mean).
function buildSnapshotFromViewRows(rows: ZoriZipLatestRow[]): RentalsSnapshot | null {
  if (rows.length === 0) return null;

  const zipSnaps: ZipSnapshot[] = rows.map((v) => ({
    zip_code: v.zip_code,
    metro: v.metro,
    county_name: v.county_name,
    city: v.city,
    latest_period: v.latest_period,
    rent_index_latest: v.rent_index_latest,
    rent_yoy_pct: v.rent_yoy_pct,
    rent_mom_pct: v.rent_mom_pct,
  }));

  zipSnaps.sort((a, b) => (a.zip_code < b.zip_code ? -1 : a.zip_code > b.zip_code ? 1 : 0));
  const regional_latest_period = zipSnaps
    .map((z) => z.latest_period)
    .sort()
    .reverse()[0];
  const values = zipSnaps.map((z) => z.rent_index_latest);
  const yoys = zipSnaps
    .map((z) => z.rent_yoy_pct)
    .filter((y): y is number => y !== null && Number.isFinite(y));

  return {
    zips: zipSnaps,
    regional_latest_period,
    regional_median_rent_index: median(values),
    regional_median_yoy_pct: yoys.length > 0 ? median(yoys) : null,
    zips_covered: zipSnaps.length,
    zips_with_yoy: yoys.length,
  };
}

// ── Module-level state for corpusSummary -> outputProducer handoff ──────────

let lastSnapshot: RentalsSnapshot | null = null;
let lastFetchedAt: string | null = null;

function rowsFromFragments(fragments: RawFragment[]): ZoriZipLatestRow[] {
  return fragments
    .map((f) => f.normalized as unknown as ZoriZipLatestRow)
    .filter((r): r is ZoriZipLatestRow => !!r && typeof r === "object");
}

function rentalsCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  lastSnapshot = null;
  lastFetchedAt = null;

  const rows = rowsFromFragments(allFragments);
  if (rows.length === 0) return [];

  const snap = buildSnapshotFromViewRows(rows);
  if (!snap) return [];

  lastSnapshot = snap;
  lastFetchedAt = allFragments[0]?.fetched_at ?? new Date().toISOString();

  const yoyStr =
    snap.regional_median_yoy_pct === null ? "n/a" : `${snap.regional_median_yoy_pct.toFixed(2)}%`;

  return [
    {
      topic: "corpus_overview",
      fact: "Zillow ZORI SWFL rent-index corpus",
      value: `${rows.length.toLocaleString()} rows across ${snap.zips_covered} ZIPs through ${snap.regional_latest_period}. Regional median rent index = $${snap.regional_median_rent_index.toFixed(0)}, regional median YoY = ${yoyStr}.`,
      source_fragment_ids: [],
    },
  ];
}

// ── outputProducer ──────────────────────────────────────────────────────────

function buildSourceMeta(fetched_at: string): BrainOutputMetricSource {
  const citation =
    env.source === "fixture"
      ? "Zillow Observed Rent Index (ZORI), ZIP-level latest-per-ZIP (fixture: zori-zip-latest.sample.json)."
      : "Zillow Observed Rent Index (ZORI), ZIP-level all-homes monthly composite (SFR + Condo + Multifamily). Source: Zillow Research (files.zillowstatic.com); Tier 2 cache: data_lake.zori_zip_latest (brain-input pivot view).";
  return {
    url: "https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv",
    fetched_at,
    tier: 3,
    citation,
  };
}

function metricDirection(delta: number | null): "rising" | "falling" | "stable" {
  if (delta === null) return "stable";
  if (delta > 0.1) return "rising";
  if (delta < -0.1) return "falling";
  return "stable";
}

function rentalsOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snap = lastSnapshot;
  const fetched_at = lastFetchedAt ?? new Date().toISOString();

  if (!snap) {
    return {
      conclusion: "rentals-swfl could not load any Zillow ZORI rows this build.",
      key_metrics: [],
      caveats: [
        "Zero rows from ZORI ingest. Verify ingest:zori-swfl ran successfully + data_lake.zori_swfl has recent rows.",
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
  const verdict = classifyPolarity(snap.regional_median_yoy_pct);

  // Rank ZIPs by YoY for the heating / cooling lists.
  const ranked = snap.zips
    .filter((z) => z.rent_yoy_pct !== null && Number.isFinite(z.rent_yoy_pct))
    .sort((a, b) => (b.rent_yoy_pct ?? 0) - (a.rent_yoy_pct ?? 0));
  const topHeating = ranked.slice(0, TOP_N);
  const topCooling = ranked.slice(-TOP_N).reverse();

  const key_metrics: BrainOutputMetric[] = [];

  // 1. Regional median YoY — the headline polarity driver.
  key_metrics.push({
    metric: "rental_rent_yoy_pct_regional_median",
    value:
      snap.regional_median_yoy_pct === null
        ? "n/a"
        : Number(snap.regional_median_yoy_pct.toFixed(2)),
    direction: metricDirection(snap.regional_median_yoy_pct),
    label: "SWFL regional median ZORI rent YoY % (latest period across all covered ZIPs)",
    variable_type: snap.regional_median_yoy_pct === null ? "categorical" : "intensive",
    ...(snap.regional_median_yoy_pct === null
      ? {}
      : { units: "percent", display_format: "percent" as const }),
    source,
  });

  // 2. Regional median rent index.
  key_metrics.push({
    metric: "rental_rent_index_zori_regional_median",
    value: Number(snap.regional_median_rent_index.toFixed(0)),
    direction: "stable",
    label: `SWFL regional median ZORI rent index (USD/month) at ${snap.regional_latest_period}`,
    variable_type: "extensive",
    units: "USD/month",
    display_format: "currency",
    source,
  });

  // 3. Coverage count.
  key_metrics.push({
    metric: "rentals_swfl_zips_covered",
    value: snap.zips_covered,
    direction: "stable",
    label: "Count of SWFL ZIPs with at least one observation in the corpus",
    variable_type: "extensive",
    units: "count",
    display_format: "count",
    source,
  });

  // 4. Top-heating ZIPs (categorical roll-up).
  if (topHeating.length > 0) {
    key_metrics.push({
      metric: "rental_rent_yoy_pct_top_heating_zips",
      value: topHeating
        .map(
          (z) =>
            `${z.zip_code}:${z.rent_yoy_pct === null ? "n/a" : z.rent_yoy_pct.toFixed(2) + "%"}`,
        )
        .join(","),
      direction: "stable",
      label: `Top-${TOP_N} SWFL ZIPs by ZORI rent YoY % (rank-ordered, heating)`,
      variable_type: "categorical",
      source,
    });
  }

  // 5. Per-ZIP YoY for top-heating + top-cooling — resolved through the
  // patterns hook in refinery/vocab/patterns.mts via raw_slug_patterns on
  // rental_rent_yoy_pct.
  for (const z of [...topHeating, ...topCooling]) {
    if (z.rent_yoy_pct === null) continue;
    key_metrics.push({
      metric: `rental_rent_yoy_pct_zip_${z.zip_code}`,
      value: Number(z.rent_yoy_pct.toFixed(2)),
      direction: metricDirection(z.rent_yoy_pct),
      label: `ZORI rent YoY % - ZIP ${z.zip_code}${z.city ? " (" + z.city + ")" : ""}, ${z.latest_period}`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source,
    });
    key_metrics.push({
      metric: `rental_rent_index_zori_zip_${z.zip_code}`,
      value: Number(z.rent_index_latest.toFixed(0)),
      direction: "stable",
      label: `ZORI rent index (USD/month) - ZIP ${z.zip_code}${z.city ? " (" + z.city + ")" : ""}, ${z.latest_period}`,
      variable_type: "extensive",
      units: "USD/month",
      display_format: "currency",
      source,
    });
  }

  // ── Caveats ──
  const caveats: string[] = [...verdict.caveats];

  if (snap.zips_with_yoy < snap.zips_covered) {
    const missing = snap.zips_covered - snap.zips_with_yoy;
    caveats.push(
      `${missing} of ${snap.zips_covered} ZIPs lack a 12-month look-back; YoY excludes them.`,
    );
  }
  if (snap.zips_covered < 10) {
    caveats.push(
      `Only ${snap.zips_covered} SWFL ZIPs in the corpus this build — regional median is thin.`,
    );
  }

  // ── Conclusion prose ──
  const yoyDisplay =
    snap.regional_median_yoy_pct === null ? "n/a" : `${snap.regional_median_yoy_pct.toFixed(2)}%`;
  const rentDisplay = `$${snap.regional_median_rent_index.toFixed(0)}`;
  const heatList =
    topHeating
      .map(
        (z) =>
          `${z.zip_code} (${z.rent_yoy_pct === null ? "n/a" : z.rent_yoy_pct.toFixed(1) + "%"})`,
      )
      .join(", ") || "none";
  const coolList =
    topCooling
      .map(
        (z) =>
          `${z.zip_code} (${z.rent_yoy_pct === null ? "n/a" : z.rent_yoy_pct.toFixed(1) + "%"})`,
      )
      .join(", ") || "none";

  const conclusion = [
    `SWFL ZORI rents read ${verdict.direction} at ${snap.regional_latest_period} — regional median YoY ${yoyDisplay} on a median rent of ${rentDisplay}/month across ${snap.zips_covered} ZIPs.`,
    `Hottest: ${heatList}. Coolest: ${coolList}.`,
  ].join(" ");

  // Per-ZIP detail table — ALL ZORI ZIPs, not just the heating/cooling extremes.
  // Key = zip_code; one row per ZIP. Mirrors housing-swfl's housing_by_zip shape.
  const zipDetailRows = snap.zips.map((z) => ({
    key: z.zip_code,
    label: z.zip_code,
    cells: {
      metro: z.metro ?? null,
      county_name: z.county_name ?? null,
      city: z.city ?? null,
      latest_period: z.latest_period,
      rent_index_latest: Number(z.rent_index_latest.toFixed(0)),
      rent_yoy_pct:
        z.rent_yoy_pct === null || !Number.isFinite(z.rent_yoy_pct)
          ? null
          : Number(z.rent_yoy_pct.toFixed(2)),
      rent_mom_pct:
        z.rent_mom_pct === null || !Number.isFinite(z.rent_mom_pct)
          ? null
          : Number(z.rent_mom_pct.toFixed(2)),
    } as Record<string, number | string | boolean | null>,
  }));

  return {
    conclusion,
    key_metrics,
    caveats,
    direction: verdict.direction,
    magnitude: verdict.magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    detail_tables:
      zipDetailRows.length > 0
        ? [
            {
              id: "rentals_by_zip",
              title: `SWFL ZORI rent index by ZIP — latest period ${snap.regional_latest_period}`,
              grain: "zip",
              columns: [
                { id: "metro", label: "Metro area" },
                { id: "county_name", label: "County" },
                { id: "city", label: "City" },
                { id: "latest_period", label: "Latest period" },
                {
                  id: "rent_index_latest",
                  label: "Rent index (USD/month)",
                  display_format: "currency" as const,
                  units: "USD/month",
                },
                {
                  id: "rent_yoy_pct",
                  label: "Rent YoY %",
                  display_format: "percent" as const,
                  units: "percent",
                },
                {
                  id: "rent_mom_pct",
                  label: "Rent MoM %",
                  display_format: "percent" as const,
                  units: "percent",
                },
              ],
              rows: zipDetailRows,
              source,
              note: "One row per SWFL ZIP with at least one ZORI observation. Rent index is Zillow's repeat-rent measure (USD/month). YoY and MoM are null when a 12-month or 1-month look-back observation is unavailable.",
            },
          ]
        : undefined,
  };
}

// ── Pack definition ─────────────────────────────────────────────────────────

export const rentalsSwfl: PackDefinition = {
  id: BRAIN_ID,
  brain_id: BRAIN_ID,
  public_label: "Rentals Market",
  domain: "real-estate",
  scope:
    "SWFL ZIP-level residential rent index (Zillow ZORI), monthly — regional median direction, heating/cooling ZIPs, and per-ZIP YoY/MoM.",
  ttl_seconds: 86400 * 35, // monthly cadence + one publish-cycle of slack
  sources: [zoriZipLatestSource], // §05 cutover: reads data_lake.zori_zip_latest (view)
  input_brains: [],
  fitScore: () => 10,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: rentalsCorpusSummary,
  outputProducer: rentalsOutputProducer,
  preferences: [
    "The user reads rental direction from the investor/operator frame — bullish when rents rise within a durable band, with a regime-shift caveat above +10% YoY.",
    "Rate-of-change (YoY %) is the headline; dollar levels are secondary context.",
    "Top-heating and top-cooling ZIPs are the operational cuts the user wants in the conclusion prose.",
  ],
  activeProject:
    "rentals-swfl: track SWFL ZIP-level rent direction via Zillow ZORI as a leading multifamily/SFR demand signal.",
  prompts: {
    triageContext:
      "A ZORI row is decision-relevant when it falls in a tracked SWFL MSA. The pack runs deterministically — no LLM triage is invoked.",
    synthesisContext:
      "Produce a regional-median rent-direction read using the locked polarity table. Quote per-ZIP YoY for the top-heating and top-cooling cuts. Never infer cap-rate or NOI implications from rent index alone.",
  },
};
