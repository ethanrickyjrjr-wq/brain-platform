import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputDirection,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import { zhviZipLatestSource, type ZhviZipLatestRow } from "../sources/zhvi-zip-latest-source.mts";
import { env } from "../config/env.mts";

const BRAIN_ID = "home-values-swfl";

// ── Polarity bands (home-value appreciation, investor frame) ─────────────────
// All deterministic, pure code; the LLM never sees these numbers.

const POLARITY_CAVEAT_NEUTRAL_SUB_INFLATION =
  "Sub-inflation home-value growth — flat in real terms.";
const POLARITY_CAVEAT_BULLISH_DURABILITY =
  "Appreciation above the long-run trend — watch durability.";
const POLARITY_CAVEAT_NEUTRAL_SURGE =
  "Appreciation materially above wage growth; the 2021-22 SWFL surge reverted within ~18 months in many ZIPs.";

const TOP_N = 3;

// ── Domain types ─────────────────────────────────────────────────────────────

interface ZipSnapshot {
  zip_code: string;
  metro: string | null;
  county_name: string | null;
  city: string | null;
  /** Latest period_end seen. */
  latest_period: string;
  home_value_latest: number;
  value_yoy_pct: number | null;
  value_mom_pct: number | null;
}

interface HomeValuesSnapshot {
  zips: ZipSnapshot[];
  regional_latest_period: string;
  regional_median_home_value: number;
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

// The raw-row snapshot builder (`buildSnapshot` + groupByZip/lookbackObservation/
// buildZipSnapshot) was retired as a production export at the §05 GATE-B cutover —
// the pack now reads `data_lake.zhvi_zip_latest` via buildSnapshotFromViewRows below.
// Its independent TS reimplementation survives as the view-parity ORACLE in the
// test-only module `_home-values-oracle.mts` (see that file's header).

// ── Polarity classifier ──────────────────────────────────────────────────────

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
  const magnitude = Math.min(Math.abs(yoy) / 15, 1);

  if (yoy < 0) return { direction: "bearish", caveats: [], magnitude };
  if (yoy < 3)
    return {
      direction: "neutral",
      caveats: [POLARITY_CAVEAT_NEUTRAL_SUB_INFLATION],
      magnitude,
    };
  if (yoy <= 10) return { direction: "bullish", caveats: [], magnitude };
  if (yoy <= 15)
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
// Per-ZIP math already computed by data_lake.zhvi_zip_latest; this function
// only does the regional rollup (R1 — the pack still decides what numbers mean).
function buildSnapshotFromViewRows(rows: ZhviZipLatestRow[]): HomeValuesSnapshot | null {
  if (rows.length === 0) return null;

  const zipSnaps: ZipSnapshot[] = rows.map((v) => ({
    zip_code: v.zip_code,
    metro: v.metro,
    county_name: v.county_name,
    city: v.city,
    latest_period: v.latest_period,
    home_value_latest: v.home_value_latest,
    value_yoy_pct: v.value_yoy_pct,
    value_mom_pct: v.value_mom_pct,
  }));

  zipSnaps.sort((a, b) => (a.zip_code < b.zip_code ? -1 : a.zip_code > b.zip_code ? 1 : 0));
  const regional_latest_period = zipSnaps
    .map((z) => z.latest_period)
    .sort()
    .reverse()[0];
  const values = zipSnaps.map((z) => z.home_value_latest);
  const yoys = zipSnaps
    .map((z) => z.value_yoy_pct)
    .filter((y): y is number => y !== null && Number.isFinite(y));

  return {
    zips: zipSnaps,
    regional_latest_period,
    regional_median_home_value: median(values),
    regional_median_yoy_pct: yoys.length > 0 ? median(yoys) : null,
    zips_covered: zipSnaps.length,
    zips_with_yoy: yoys.length,
  };
}

// ── Module-level state for corpusSummary -> outputProducer handoff ──────────

let lastSnapshot: HomeValuesSnapshot | null = null;
let lastFetchedAt: string | null = null;

function rowsFromFragments(fragments: RawFragment[]): ZhviZipLatestRow[] {
  return fragments
    .map((f) => f.normalized as unknown as ZhviZipLatestRow)
    .filter((r): r is ZhviZipLatestRow => !!r && typeof r === "object");
}

function homeValuesCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
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
      fact: "Zillow ZHVI SWFL home-value-index corpus",
      value: `${rows.length.toLocaleString()} rows across ${snap.zips_covered} ZIPs through ${snap.regional_latest_period}. Regional median home value = $${snap.regional_median_home_value.toFixed(0)}, regional median YoY = ${yoyStr}.`,
      source_fragment_ids: [],
    },
  ];
}

// ── outputProducer ──────────────────────────────────────────────────────────

function buildSourceMeta(fetched_at: string): BrainOutputMetricSource {
  const citation =
    env.source === "fixture"
      ? "Zillow Home Value Index (ZHVI), ZIP-level latest-per-ZIP (fixture: zhvi-zip-latest.sample.json)."
      : "Zillow Home Value Index (ZHVI), ZIP-level all-homes (SFR + Condo) middle-tier (0.33-0.67) seasonally-adjusted. Source: Zillow Research (files.zillowstatic.com); Tier 2 cache: data_lake.zhvi_zip_latest (brain-input pivot view).";
  return {
    url: "https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
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

function homeValuesOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snap = lastSnapshot;
  const fetched_at = lastFetchedAt ?? new Date().toISOString();

  if (!snap) {
    return {
      conclusion: "home-values-swfl could not load any Zillow ZHVI rows this build.",
      key_metrics: [],
      caveats: [
        "Zero rows from ZHVI ingest. Verify ingest:zhvi-swfl ran successfully + data_lake.zhvi_swfl has recent rows.",
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
    .filter((z) => z.value_yoy_pct !== null && Number.isFinite(z.value_yoy_pct))
    .sort((a, b) => (b.value_yoy_pct ?? 0) - (a.value_yoy_pct ?? 0));
  const topHeating = ranked.slice(0, TOP_N);
  const topCooling = ranked.slice(-TOP_N).reverse();

  const key_metrics: BrainOutputMetric[] = [];

  // 1. Regional median YoY — the headline polarity driver.
  key_metrics.push({
    metric: "home_value_yoy_pct_regional_median",
    value:
      snap.regional_median_yoy_pct === null
        ? "n/a"
        : Number(snap.regional_median_yoy_pct.toFixed(2)),
    direction: metricDirection(snap.regional_median_yoy_pct),
    label: "SWFL regional median ZHVI home-value YoY % (latest period across all covered ZIPs)",
    variable_type: snap.regional_median_yoy_pct === null ? "categorical" : "intensive",
    ...(snap.regional_median_yoy_pct === null
      ? {}
      : { units: "percent", display_format: "percent" as const }),
    source,
  });

  // 2. Regional median home value.
  key_metrics.push({
    metric: "home_value_zhvi_regional_median",
    value: Number(snap.regional_median_home_value.toFixed(0)),
    direction: "stable",
    label: `SWFL regional median ZHVI home value (USD) at ${snap.regional_latest_period}`,
    variable_type: "extensive",
    units: "USD",
    display_format: "currency",
    source,
  });

  // 3. Coverage count.
  key_metrics.push({
    metric: "home_values_zips_covered",
    value: snap.zips_covered,
    direction: "stable",
    label: "Count of SWFL ZIPs with at least one ZHVI observation in the corpus",
    variable_type: "extensive",
    units: "count",
    display_format: "count",
    source,
  });

  // 4. Top-appreciating ZIPs (categorical roll-up).
  if (topHeating.length > 0) {
    key_metrics.push({
      metric: "home_value_yoy_pct_top_appreciating_zips",
      value: topHeating
        .map(
          (z) =>
            `${z.zip_code}:${z.value_yoy_pct === null ? "n/a" : z.value_yoy_pct.toFixed(2) + "%"}`,
        )
        .join(","),
      direction: "stable",
      label: `Top-${TOP_N} SWFL ZIPs by ZHVI home-value YoY % (rank-ordered, appreciating)`,
      variable_type: "categorical",
      source,
    });
  }

  // 5. Per-ZIP YoY + value for top-appreciating + top-cooling — resolved through
  // the patterns hook in refinery/vocab/patterns.mts via raw_slug_patterns.
  for (const z of [...topHeating, ...topCooling]) {
    if (z.value_yoy_pct === null) continue;
    key_metrics.push({
      metric: `home_value_yoy_pct_zip_${z.zip_code}`,
      value: Number(z.value_yoy_pct.toFixed(2)),
      direction: metricDirection(z.value_yoy_pct),
      label: `ZHVI home-value YoY % - ZIP ${z.zip_code}${z.city ? " (" + z.city + ")" : ""}, ${z.latest_period}`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source,
    });
    key_metrics.push({
      metric: `home_value_zhvi_zip_${z.zip_code}`,
      value: Number(z.home_value_latest.toFixed(0)),
      direction: "stable",
      label: `ZHVI home value (USD) - ZIP ${z.zip_code}${z.city ? " (" + z.city + ")" : ""}, ${z.latest_period}`,
      variable_type: "extensive",
      units: "USD",
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
  const valueDisplay = `$${snap.regional_median_home_value.toFixed(0)}`;
  const heatList =
    topHeating
      .map(
        (z) =>
          `${z.zip_code} (${z.value_yoy_pct === null ? "n/a" : z.value_yoy_pct.toFixed(1) + "%"})`,
      )
      .join(", ") || "none";
  const coolList =
    topCooling
      .map(
        (z) =>
          `${z.zip_code} (${z.value_yoy_pct === null ? "n/a" : z.value_yoy_pct.toFixed(1) + "%"})`,
      )
      .join(", ") || "none";

  const conclusion = [
    `SWFL ZHVI home values read ${verdict.direction} at ${snap.regional_latest_period} — regional median YoY ${yoyDisplay} on a median value of ${valueDisplay} across ${snap.zips_covered} ZIPs.`,
    `Fastest-appreciating: ${heatList}. Coolest: ${coolList}.`,
  ].join(" ");

  // Per-ZIP detail table — ALL ZHVI ZIPs. Key = zip_code; one row per ZIP.
  // Mirrors rentals-swfl's rentals_by_zip shape so the investor composite can
  // join value + rent by ZIP.
  const zipDetailRows = snap.zips.map((z) => ({
    key: z.zip_code,
    label: z.zip_code,
    cells: {
      metro: z.metro ?? null,
      county_name: z.county_name ?? null,
      city: z.city ?? null,
      latest_period: z.latest_period,
      home_value_zhvi: Number(z.home_value_latest.toFixed(0)),
      value_yoy_pct:
        z.value_yoy_pct === null || !Number.isFinite(z.value_yoy_pct)
          ? null
          : Number(z.value_yoy_pct.toFixed(2)),
      value_mom_pct:
        z.value_mom_pct === null || !Number.isFinite(z.value_mom_pct)
          ? null
          : Number(z.value_mom_pct.toFixed(2)),
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
              id: "home_values_by_zip",
              title: `SWFL ZHVI home value by ZIP — latest period ${snap.regional_latest_period}`,
              grain: "zip",
              columns: [
                { id: "metro", label: "Metro area" },
                { id: "county_name", label: "County" },
                { id: "city", label: "City" },
                { id: "latest_period", label: "Latest period" },
                {
                  id: "home_value_zhvi",
                  label: "Home value (USD)",
                  display_format: "currency" as const,
                  units: "USD",
                },
                {
                  id: "value_yoy_pct",
                  label: "Value YoY %",
                  display_format: "percent" as const,
                  units: "percent",
                },
                {
                  id: "value_mom_pct",
                  label: "Value MoM %",
                  display_format: "percent" as const,
                  units: "percent",
                },
              ],
              rows: zipDetailRows,
              source,
              note: "One row per SWFL ZIP with at least one ZHVI observation. Home value is Zillow's seasonally-adjusted middle-tier (0.33-0.67) all-homes value index (USD). YoY and MoM are null when a 12-month or 1-month look-back observation is unavailable.",
            },
          ]
        : undefined,
  };
}

// ── Pack definition ─────────────────────────────────────────────────────────

export const homeValuesSwfl: PackDefinition = {
  id: BRAIN_ID,
  brain_id: BRAIN_ID,
  public_label: "Home Values",
  domain: "real-estate",
  scope:
    "SWFL ZIP-level home-value index (Zillow ZHVI), monthly — regional median direction, fastest-appreciating/cooling ZIPs, and per-ZIP YoY/MoM.",
  ttl_seconds: 86400 * 35, // monthly cadence + one publish-cycle of slack
  sources: [zhviZipLatestSource], // §05 cutover: reads data_lake.zhvi_zip_latest (view)
  input_brains: [],
  fitScore: () => 10,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: homeValuesCorpusSummary,
  outputProducer: homeValuesOutputProducer,
  preferences: [
    "The user reads home-value direction from the investor frame — bullish when values rise within a durable band, with a regime-shift caveat above +15% YoY.",
    "Rate-of-change (YoY %) is the headline; dollar levels are secondary context.",
    "Fastest-appreciating and coolest ZIPs are the operational cuts the user wants in the conclusion prose.",
  ],
  activeProject:
    "home-values-swfl: track SWFL ZIP-level home values via Zillow ZHVI as the market-value input to the investor-yield composite.",
  prompts: {
    triageContext:
      "A ZHVI row is decision-relevant when it falls in a tracked SWFL MSA. The pack runs deterministically — no LLM triage is invoked.",
    synthesisContext:
      "Produce a regional-median home-value-direction read using the locked polarity table. Quote per-ZIP YoY for the top-appreciating and coolest cuts. Never infer cap-rate or rent-yield implications from the value index alone.",
  },
};
