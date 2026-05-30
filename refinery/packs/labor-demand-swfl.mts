import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
  BrainOutputDirection,
} from "../types/brain-output.mts";
import {
  flDeoJobPostingsSource,
  type FlDeoPostingsSummary,
} from "../sources/fl-deo-job-postings-source.mts";

const SOURCE_ID = "fl_deo_job_postings";
const CITATION_URL =
  "https://www.careersourceflorida.com/workforce-professionals/labor-market-information/";

/**
 * labor-demand-swfl — weekly job posting demand signal for Lee + Collier counties.
 *
 * Source: data_lake.fl_deo_job_postings (ingest/pipelines/fl_deo_job_postings,
 * cron Wednesday 12:00 UTC via fl-deo-job-postings-weekly.yml).
 *
 * Emits posting counts and WoW delta by NAICS supersector for SWFL.
 * Direction logic: rising total postings = bullish (more labor demand →
 * healthier hiring environment). Threshold: ±3% WoW to exceed week-to-week
 * noise in online job posting analytics (Lightcast methodology).
 *
 * Tier-1 Reporter — no upstream brains. Pure deterministic aggregation.
 */

// ── Closure state ─────────────────────────────────────────────────────────────

let lastSummary: FlDeoPostingsSummary | null = null;
let lastFetchedAt: string | null = null;

// ── Direction helpers ─────────────────────────────────────────────────────────

// ±3% WoW threshold: exceeds typical Lightcast weekly revision noise.
function wowDirection(
  pct: number | null,
): "rising" | "falling" | "stable" {
  if (pct == null) return "stable";
  if (pct > 3) return "rising";
  if (pct < -3) return "falling";
  return "stable";
}

function directionToBrain(
  d: "rising" | "falling" | "stable",
): "bullish" | "bearish" | "neutral" {
  return d === "rising" ? "bullish" : d === "falling" ? "bearish" : "neutral";
}

const fmt = (n: number, dec = 0): string => n.toFixed(dec);
const sign = (n: number): string => (n >= 0 ? "+" : "");

// ── outputProducer ────────────────────────────────────────────────────────────

function laborDemandOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const summary = lastSummary;
  const fetchedAt =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!summary || !summary.latest.week_end_date) {
    return {
      conclusion:
        "labor-demand-swfl: no job posting data available — fl_deo_job_postings table may be empty or pipeline has not yet run.",
      key_metrics: [],
      caveats: [
        "data_lake.fl_deo_job_postings returned 0 rows. Run the fl-deo-job-postings-weekly pipeline.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const { latest, prior, lee_wow_pct, collier_wow_pct } = summary;
  const weekEnd = latest.week_end_date;

  const key_metrics: BrainOutputMetric[] = [];

  const makeSource = (label: string): BrainOutputMetric["source"] => ({
    url: CITATION_URL,
    fetched_at: fetchedAt,
    tier: 1,
    citation: `CareerSource Florida / FL DEO OSPA — ${label}, week ending ${weekEnd}`,
  });

  // Lee total postings
  if (latest.lee.total > 0) {
    key_metrics.push({
      metric: "lee_job_postings_total",
      label: "Lee County Job Postings",
      value: latest.lee.total,
      direction: wowDirection(lee_wow_pct),
      variable_type: "extensive",
      units: "postings",
      display_format: "count",
      source: makeSource(`Lee County total ${latest.lee.total.toLocaleString()} postings`),
    });
  }

  // Collier total postings
  if (latest.collier.total > 0) {
    key_metrics.push({
      metric: "collier_job_postings_total",
      label: "Collier County Job Postings",
      value: latest.collier.total,
      direction: wowDirection(collier_wow_pct),
      variable_type: "extensive",
      units: "postings",
      display_format: "count",
      source: makeSource(`Collier County total ${latest.collier.total.toLocaleString()} postings`),
    });
  }

  // Lee WoW delta
  if (lee_wow_pct != null) {
    key_metrics.push({
      metric: "lee_job_postings_wow_pct",
      label: "Lee County Postings WoW Δ",
      value: lee_wow_pct,
      direction: wowDirection(lee_wow_pct),
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source: makeSource(
        `Lee County WoW: ${sign(lee_wow_pct)}${fmt(lee_wow_pct, 1)}% vs week ending ${prior?.week_end_date ?? "prior"}`,
      ),
    });
  }

  // Collier WoW delta
  if (collier_wow_pct != null) {
    key_metrics.push({
      metric: "collier_job_postings_wow_pct",
      label: "Collier County Postings WoW Δ",
      value: collier_wow_pct,
      direction: wowDirection(collier_wow_pct),
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source: makeSource(
        `Collier County WoW: ${sign(collier_wow_pct)}${fmt(collier_wow_pct, 1)}% vs week ending ${prior?.week_end_date ?? "prior"}`,
      ),
    });
  }

  // Top sector for Lee
  if (latest.lee.by_sector.length > 0) {
    const top = latest.lee.by_sector[0];
    key_metrics.push({
      metric: "lee_top_sector_postings",
      label: `Lee Top Sector: ${top.naics_label}`,
      value: top.posting_count,
      direction: "stable",
      variable_type: "extensive",
      units: "postings",
      display_format: "count",
      source: makeSource(
        `Lee top sector: ${top.naics_label} (NAICS ${top.naics_sector}) = ${top.posting_count.toLocaleString()} postings`,
      ),
    });
  }

  // Top sector for Collier
  if (latest.collier.by_sector.length > 0) {
    const top = latest.collier.by_sector[0];
    key_metrics.push({
      metric: "collier_top_sector_postings",
      label: `Collier Top Sector: ${top.naics_label}`,
      value: top.posting_count,
      direction: "stable",
      variable_type: "extensive",
      units: "postings",
      display_format: "count",
      source: makeSource(
        `Collier top sector: ${top.naics_label} (NAICS ${top.naics_sector}) = ${top.posting_count.toLocaleString()} postings`,
      ),
    });
  }

  // ── Direction ─────────────────────────────────────────────────────────────
  const leeDir = directionToBrain(wowDirection(lee_wow_pct));
  const collierDir = directionToBrain(wowDirection(collier_wow_pct));

  let direction: BrainOutputDirection;
  if (leeDir === collierDir) {
    direction = leeDir;
  } else if (leeDir === "neutral") {
    direction = collierDir;
  } else if (collierDir === "neutral") {
    direction = leeDir;
  } else {
    direction = "mixed";
  }

  // ── Conclusion ─────────────────────────────────────────────────────────────
  const leePart =
    latest.lee.total > 0
      ? `Lee County ${latest.lee.total.toLocaleString()} postings` +
        (lee_wow_pct != null
          ? ` (${sign(lee_wow_pct)}${fmt(lee_wow_pct, 1)}% WoW)`
          : "")
      : null;
  const collierPart =
    latest.collier.total > 0
      ? `Collier County ${latest.collier.total.toLocaleString()} postings` +
        (collier_wow_pct != null
          ? ` (${sign(collier_wow_pct)}${fmt(collier_wow_pct, 1)}% WoW)`
          : "")
      : null;

  const parts = [leePart, collierPart].filter(Boolean).join("; ");
  const topSectors = [
    latest.lee.top_sector ? `Lee top: ${latest.lee.top_sector}` : null,
    latest.collier.top_sector ? `Collier top: ${latest.collier.top_sector}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const conclusion =
    `SWFL job postings week ending ${weekEnd}: ${parts}. ` +
    (topSectors ? `${topSectors}. ` : "") +
    `Source: CareerSource Florida / FL DEO OSPA.`;

  // Magnitude from larger WoW absolute move, capped at 1.
  const maxWow = Math.max(Math.abs(lee_wow_pct ?? 0), Math.abs(collier_wow_pct ?? 0));
  const magnitude = Math.min(maxWow / 15, 1.0);

  return {
    conclusion,
    key_metrics,
    caveats: [
      "FL DEO OSPA job postings data reflects online postings aggregated from CareerSource Florida / Lightcast; counts may vary from actual employer vacancies.",
      prior
        ? null
        : "Only one week of data available — WoW delta metrics will appear after two successful pipeline runs.",
    ].filter(Boolean) as string[],
    direction,
    magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    grain_boundary:
      `Weekly SWFL job posting demand; Lee + Collier counties; NAICS 2-digit supersectors; ${weekEnd} reference week.`,
  };
}

// ── Pack definition ───────────────────────────────────────────────────────────

export const laborDemandSwfl: PackDefinition = {
  id: "labor-demand-swfl",
  brain_id: "labor-demand-swfl",
  domain: "macro",
  scope:
    "Southwest Florida weekly labor demand signal — online job posting counts by NAICS supersector for Lee County and Collier County, sourced from CareerSource Florida / FL DEO Online Job Posting Analytics.",
  ttl_seconds: 7 * 24 * 60 * 60, // 7 days

  sources: [flDeoJobPostingsSource],
  input_brains: [],

  fitScore: () => 0.8,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: (allFragments: RawFragment[]) => {
    const fragment = allFragments.find(
      (f) =>
        f.source_id === SOURCE_ID &&
        (f.normalized as { kind?: string }).kind === "fl-deo-postings-swfl-summary",
    );
    lastSummary = fragment
      ? (fragment.normalized as FlDeoPostingsSummary)
      : null;
    lastFetchedAt = fragment?.fetched_at ?? null;

    if (!lastSummary) return [];

    const { latest, lee_wow_pct, collier_wow_pct } = lastSummary;
    return [
      {
        topic: "fl_deo_postings_swfl_latest",
        fact: `SWFL job postings week ending ${latest.week_end_date}`,
        value:
          `Lee: ${latest.lee.total.toLocaleString()} (top: ${latest.lee.top_sector ?? "n/a"})` +
          (lee_wow_pct != null ? `, WoW ${lee_wow_pct >= 0 ? "+" : ""}${lee_wow_pct.toFixed(1)}%` : "") +
          `. Collier: ${latest.collier.total.toLocaleString()} (top: ${latest.collier.top_sector ?? "n/a"})` +
          (collier_wow_pct != null ? `, WoW ${collier_wow_pct >= 0 ? "+" : ""}${collier_wow_pct.toFixed(1)}%` : "") +
          `. Source: CareerSource FL / DEO OSPA.`,
        source_fragment_ids: [],
      },
    ];
  },

  outputProducer: laborDemandOutputProducer,

  preferences: [
    "The user reads weekly job posting counts as a leading labor-demand indicator for the SWFL market.",
    "Lee County is the primary reference; Collier is the secondary. WoW delta is the primary direction signal.",
    "Top NAICS sector by posting count identifies which industry is driving demand in a given week.",
  ],
  activeProject:
    "labor-demand-swfl: weekly FL DEO OSPA job posting counts for Lee + Collier counties by NAICS supersector.",
  prompts: {
    triageContext:
      "Fragment is a fl-deo-postings-swfl-summary with total postings and WoW delta for Lee + Collier. Decision-relevant by construction; pack is pure deterministic aggregation.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). BrainOutput built by laborDemandOutputProducer from weekly posting counts and WoW deltas.",
  },
};
