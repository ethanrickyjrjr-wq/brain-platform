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
  fdleCrimeSource,
  type FdleCrimeNormalized,
} from "../sources/fdle-crime-source.mts";

/**
 * safety-swfl — SWFL (Lee + Collier) property crime rate from FDLE UCR.
 *
 * Source: public.fdle_crime_swfl (ingest/pipelines/fdle_crime_swfl, quarterly cron).
 * Data: UCR Part I property offenses — burglary, larceny-theft, motor vehicle
 *   theft, arson — per 1,000 residents. Annual grain; FDLE publishes with
 *   ~6–9 month lag. Quarterly ingest cadence picks up each new annual release.
 *
 * Tier-1 Reporter: no opinions, cited facts only.
 *
 * Direction polarity: falling crime rate → bullish (safer investment environment).
 *   |YoY SWFL Δ| ≥ 3%: bullish (falling) or bearish (rising). < 3%: neutral.
 *
 * Key metrics:
 *   safety_property_crime_per_1k_lee      — Lee County per-1k rate, latest year
 *   safety_property_crime_per_1k_collier  — Collier County per-1k rate, latest year
 *   safety_property_crime_per_1k_swfl     — population-weighted SWFL combined rate
 *   safety_property_crime_yoy_pct_swfl    — SWFL YoY % change (direction signal)
 *   safety_property_crime_yoy_pct_lee     — Lee YoY % change
 *   safety_property_crime_yoy_pct_collier — Collier YoY % change
 *   safety_total_property_crimes_lee      — Lee raw incident count, latest year
 *   safety_total_property_crimes_collier  — Collier raw incident count, latest year
 */

// ── Closure state ─────────────────────────────────────────────────────────────

let lastRows: FdleCrimeNormalized[] = [];
let lastFetchedAt: string | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowsFromFragments(fragments: RawFragment[]): FdleCrimeNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as FdleCrimeNormalized)
    .filter((r): r is FdleCrimeNormalized => r?.kind === "fdle-crime");
}

function latestYear(rows: FdleCrimeNormalized[]): number {
  return Math.max(...rows.map((r) => r.data_year), 0);
}

function rowFor(
  rows: FdleCrimeNormalized[],
  county: string,
  year: number,
): FdleCrimeNormalized | null {
  return (
    rows.find(
      (r) =>
        r.county.toLowerCase() === county.toLowerCase() && r.data_year === year,
    ) ?? null
  );
}

function yoyPct(
  current: number | null,
  prior: number | null,
): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return Number((((current - prior) / prior) * 100).toFixed(1));
}

/** Property crime is INVERSE: a falling rate signals an improving investment environment. */
function crimeDirection(yoyPct: number | null): BrainOutputDirection {
  if (yoyPct == null) return "neutral";
  if (yoyPct <= -3) return "bullish";
  if (yoyPct >= 3) return "bearish";
  return "neutral";
}

function rateTrend(yoyPct: number | null): "falling" | "rising" | "stable" {
  if (yoyPct == null) return "stable";
  if (yoyPct <= -3) return "falling";
  if (yoyPct >= 3) return "rising";
  return "stable";
}

function makeSource(
  fetchedAt: string,
  sourceUrl: string,
  year: number,
): BrainOutputMetricSource {
  return {
    url:
      sourceUrl ||
      "https://www.fdle.state.fl.us/FSAC/Crime-Data/UCR-Data-Archive.aspx",
    fetched_at: fetchedAt,
    tier: 1,
    citation: `FDLE Uniform Crime Report — UCR Part I property offenses by county, ${year} annual data. Source: Florida Department of Law Enforcement, FSAC.`,
  };
}

// ── corpusSummary ─────────────────────────────────────────────────────────────

function safetyCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  lastRows = [];
  lastFetchedAt = null;

  const rows = rowsFromFragments(allFragments);
  if (rows.length === 0) return [];

  lastRows = rows;
  lastFetchedAt = new Date().toISOString();

  const yr = latestYear(rows);
  return [
    {
      topic: "corpus_overview",
      fact: "FDLE UCR property crime corpus (Lee + Collier)",
      value: `${rows.length} county-year rows, latest year ${yr}.`,
      source_fragment_ids: [],
    },
  ];
}

// ── outputProducer ────────────────────────────────────────────────────────────

function safetyOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const fetched_at = lastFetchedAt ?? new Date().toISOString();

  if (lastRows.length === 0) {
    return {
      conclusion:
        "safety-swfl: no FDLE UCR rows available this build. Verify fdle_crime_swfl table has been populated via the fdle_crime_swfl ingest pipeline.",
      key_metrics: [],
      caveats: [
        "Zero rows from fdle_crime_swfl. Run: python -m ingest.pipelines.fdle_crime_swfl.pipeline --current",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const yr = latestYear(lastRows);
  const priorYr = yr - 1;

  const leeNow = rowFor(lastRows, "Lee", yr);
  const leePrior = rowFor(lastRows, "Lee", priorYr);
  const collierNow = rowFor(lastRows, "Collier", yr);
  const collierPrior = rowFor(lastRows, "Collier", priorYr);

  const leeRate = leeNow?.property_crime_per_1k ?? null;
  const collierRate = collierNow?.property_crime_per_1k ?? null;
  const leePriorRate = leePrior?.property_crime_per_1k ?? null;
  const collierPriorRate = collierPrior?.property_crime_per_1k ?? null;

  const leeYoy = yoyPct(leeRate, leePriorRate);
  const collierYoy = yoyPct(collierRate, collierPriorRate);

  // Population-weighted SWFL combined rate
  const leePop = leeNow?.population ?? null;
  const collierPop = collierNow?.population ?? null;
  let swflRate: number | null = null;
  if (leeRate !== null && collierRate !== null && leePop && collierPop) {
    const totalPop = leePop + collierPop;
    swflRate = Number(
      ((leeRate * leePop + collierRate * collierPop) / totalPop).toFixed(2),
    );
  } else if (leeRate !== null) {
    swflRate = leeRate;
  } else if (collierRate !== null) {
    swflRate = collierRate;
  }

  // SWFL YoY (population-weighted when both counties available)
  const leePriorPop = leePrior?.population ?? null;
  const collierPriorPop = collierPrior?.population ?? null;
  let swflYoy: number | null = null;
  if (
    leePriorRate !== null &&
    collierPriorRate !== null &&
    leePriorPop &&
    collierPriorPop
  ) {
    const priorTotalPop = leePriorPop + collierPriorPop;
    const priorSwfl = Number(
      (
        (leePriorRate * leePriorPop + collierPriorRate * collierPriorPop) /
        priorTotalPop
      ).toFixed(2),
    );
    swflYoy = yoyPct(swflRate, priorSwfl);
  } else {
    const available = [leeYoy, collierYoy].filter(
      (y): y is number => y !== null,
    );
    swflYoy =
      available.length > 0
        ? Number(
            (available.reduce((a, b) => a + b, 0) / available.length).toFixed(
              1,
            ),
          )
        : null;
  }

  const direction = crimeDirection(swflYoy);
  const magnitude = Math.min(1, Math.abs(swflYoy ?? 0) / 15);

  const archiveUrl =
    "https://www.fdle.state.fl.us/FSAC/Crime-Data/UCR-Data-Archive.aspx";
  const leeSource = makeSource(
    fetched_at,
    leeNow?.source_url || archiveUrl,
    yr,
  );
  const collierSource = makeSource(
    fetched_at,
    collierNow?.source_url || archiveUrl,
    yr,
  );
  const swflSource = makeSource(
    fetched_at,
    leeNow?.source_url || archiveUrl,
    yr,
  );

  const key_metrics: BrainOutputMetric[] = [];

  if (leeRate !== null) {
    key_metrics.push({
      metric: "safety_property_crime_per_1k_lee",
      value: leeRate,
      direction: rateTrend(leeYoy),
      label: `Lee County property crime rate — ${yr} UCR, Part I offenses per 1,000 residents`,
      variable_type: "intensive",
      units: "per 1,000 population",
      display_format: "raw",
      source: leeSource,
    });
  }

  if (collierRate !== null) {
    key_metrics.push({
      metric: "safety_property_crime_per_1k_collier",
      value: collierRate,
      direction: rateTrend(collierYoy),
      label: `Collier County property crime rate — ${yr} UCR, Part I offenses per 1,000 residents`,
      variable_type: "intensive",
      units: "per 1,000 population",
      display_format: "raw",
      source: collierSource,
    });
  }

  if (swflRate !== null) {
    key_metrics.push({
      metric: "safety_property_crime_per_1k_swfl",
      value: swflRate,
      direction: rateTrend(swflYoy),
      label: `SWFL (Lee + Collier) population-weighted property crime rate — ${yr} UCR, Part I offenses per 1,000 residents`,
      variable_type: "intensive",
      units: "per 1,000 population",
      display_format: "raw",
      source: swflSource,
    });
  }

  if (swflYoy !== null) {
    key_metrics.push({
      metric: "safety_property_crime_yoy_pct_swfl",
      value: swflYoy,
      direction: rateTrend(swflYoy),
      label: `SWFL property crime rate YoY — ${priorYr} to ${yr}, percent change`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: swflSource,
    });
  }

  if (leeYoy !== null) {
    key_metrics.push({
      metric: "safety_property_crime_yoy_pct_lee",
      value: leeYoy,
      direction: rateTrend(leeYoy),
      label: `Lee County property crime rate YoY — ${priorYr} to ${yr}, percent change`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: leeSource,
    });
  }

  if (collierYoy !== null) {
    key_metrics.push({
      metric: "safety_property_crime_yoy_pct_collier",
      value: collierYoy,
      direction: rateTrend(collierYoy),
      label: `Collier County property crime rate YoY — ${priorYr} to ${yr}, percent change`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: collierSource,
    });
  }

  if (leeNow?.total_property_crimes != null) {
    key_metrics.push({
      metric: "safety_total_property_crimes_lee",
      value: leeNow.total_property_crimes,
      direction: "stable",
      label: `Lee County total Part I property crime incidents — ${yr} UCR`,
      variable_type: "extensive",
      units: "incidents",
      display_format: "count",
      source: leeSource,
    });
  }

  if (collierNow?.total_property_crimes != null) {
    key_metrics.push({
      metric: "safety_total_property_crimes_collier",
      value: collierNow.total_property_crimes,
      direction: "stable",
      label: `Collier County total Part I property crime incidents — ${yr} UCR`,
      variable_type: "extensive",
      units: "incidents",
      display_format: "count",
      source: collierSource,
    });
  }

  // ── Conclusion prose ──────────────────────────────────────────────────────

  const parts: string[] = [];

  if (swflRate !== null) {
    const trendPhrase =
      swflYoy != null
        ? `, ${swflYoy >= 0 ? "+" : ""}${swflYoy}% YoY`
        : " (no prior-year comparison available)";
    parts.push(
      `SWFL property crime: ${swflRate.toFixed(1)} Part I offenses per 1,000 residents (${yr} UCR)${trendPhrase}.`,
    );
  }

  if (
    leeRate !== null &&
    collierRate !== null &&
    Math.abs(leeRate - collierRate) > 1
  ) {
    const higher = leeRate > collierRate ? "Lee" : "Collier";
    const lower = leeRate > collierRate ? "Collier" : "Lee";
    const higherVal = leeRate > collierRate ? leeRate : collierRate;
    const lowerVal = leeRate > collierRate ? collierRate : leeRate;
    parts.push(
      `${higher} (${higherVal.toFixed(1)}/1k) runs ${(higherVal - lowerVal).toFixed(1)} points above ${lower} (${lowerVal.toFixed(1)}/1k).`,
    );
  }

  const caveats: string[] = [
    `FDLE UCR data is annual (${yr}) with ~6–9 month publication lag; quarterly incident granularity is not available at county level.`,
  ];

  const missing = (["Lee", "Collier"] as const).filter(
    (c) => !rowFor(lastRows, c, yr),
  );
  if (missing.length > 0) {
    caveats.push(
      `${missing.join(", ")} County data absent for ${yr}; FDLE may not yet have published ${yr} UCR.`,
    );
  }

  if (swflYoy == null) {
    caveats.push(
      `Prior-year (${priorYr}) data not in table — YoY comparison unavailable.`,
    );
  }

  return {
    conclusion:
      parts.length > 0
        ? parts.join(" ")
        : `safety-swfl: FDLE UCR property crime data for Lee + Collier (${yr}).`,
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

export const safetySwfl: PackDefinition = {
  id: "safety-swfl",
  brain_id: "safety-swfl",
  domain: "real-estate",
  scope:
    "SWFL (Lee + Collier) property crime rate from FDLE UCR — Part I property offenses " +
    "(burglary, larceny-theft, motor vehicle theft, arson) per 1,000 residents. " +
    "Annual grain, quarterly ingest cadence; data lags ~6–9 months.",
  ttl_seconds: 7_776_000, // 90 days — matches quarterly source cadence
  sources: [fdleCrimeSource],
  input_brains: [],
  fitScore: () => 10,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: safetyCorpusSummary,
  outputProducer: safetyOutputProducer,
  preferences: [
    "Property crime rate is an underwriting input: rising crime is a headwind for occupancy and rent growth in commercial corridors.",
    "Lee vs. Collier divergence in crime trajectory is decision-relevant for corridor-level site selection.",
    "UCR data is annual; do not cross-compare to sub-county or monthly figures from other sources without normalizing the grain.",
  ],
  activeProject:
    "safety-swfl: FDLE UCR property crime baseline for Lee + Collier as a real-estate underwriting input.",
  prompts: {
    triageContext:
      "A FDLE UCR record is decision-relevant when it is a Part I property crime count for Lee or Collier County. Violent crime counts are context only — this brain tracks property crime exclusively.",
    synthesisContext:
      "Report the property_crime_per_1k rate by county and the SWFL population-weighted combined rate. Quote the UCR year and the data lag. Surface the YoY trend direction explicitly — a falling rate is bullish for the investment environment; a rising rate is bearish.",
  },
};
