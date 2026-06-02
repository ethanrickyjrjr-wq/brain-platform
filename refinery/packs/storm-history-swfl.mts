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
  stormHistorySource,
  stormSourceUrl,
  STORM_HISTORY_CITATION_BASE,
  type StormPerCountyAggregate,
  type StormCorpusSummary,
} from "../sources/storm-history-source.mts";
import { env } from "../config/env.mts";

/**
 * storm-history-swfl — NOAA Storm Events Database for SWFL (Lee, Collier,
 * Charlotte counties), 1996-2025 modern-schema vintage.
 *
 * Single Tier-1 source: s3://lake-tier1/environmental/storm_events_swfl.parquet
 * (audited in data_lake._tier1_inventory). The source connector pre-aggregates
 * raw rows into per-county totals + one corpus summary; this pack is a pure
 * reader of those aggregates.
 *
 * Risk-history brain — direction is "bearish" when recent extreme-wind activity
 * is elevated (>= 3 hurricane-force events in the trailing 10yr window across
 * the SWFL footprint), "neutral" otherwise. Never emits "bullish" — the absence
 * of named storms is the baseline, not an upside signal.
 *
 * Leaf brain (no upstream brains). Pure deterministic — no synthesis agent.
 */

const SWFL_COUNTIES = ["LEE", "COLLIER", "CHARLOTTE"] as const;
const EXTREME_WIND_BEARISH_THRESHOLD = 3;

interface StormSnapshot {
  perCounty: StormPerCountyAggregate[];
  corpus: StormCorpusSummary;
  /** SWFL-wide rollups across the per-county aggregates. */
  swflPropertyDamageEvents10yr: number;
  swflExtremeWindEvents10yr: number;
  swflMajorStormCount30yr: number;
  swflTotalStormCount: number;
}

let lastSnapshot: StormSnapshot | null = null;
let lastFetchedAt: string | null = null;

function perCountyFrom(fragments: RawFragment[]): StormPerCountyAggregate[] {
  return fragments
    .map((f) => f.normalized as unknown as StormPerCountyAggregate)
    .filter((n) => n?.kind === "storm-per-county");
}

function corpusFrom(fragments: RawFragment[]): StormCorpusSummary | null {
  const hit = fragments.find(
    (f) =>
      (f.normalized as { kind?: string } | null)?.kind ===
      "storm-corpus-summary",
  );
  return hit ? (hit.normalized as unknown as StormCorpusSummary) : null;
}

function buildSnapshot(
  perCounty: StormPerCountyAggregate[],
  corpus: StormCorpusSummary,
): StormSnapshot {
  return {
    perCounty,
    corpus,
    swflPropertyDamageEvents10yr: perCounty.reduce(
      (s, c) => s + c.property_damage_event_count,
      0,
    ),
    swflExtremeWindEvents10yr: perCounty.reduce(
      (s, c) => s + c.extreme_wind_event_count,
      0,
    ),
    swflMajorStormCount30yr: perCounty.reduce(
      (s, c) => s + c.major_storm_count,
      0,
    ),
    swflTotalStormCount: perCounty.reduce((s, c) => s + c.total_storm_count, 0),
  };
}

export function directionFromExtremeWind(
  extremeWindCount: number,
): "bearish" | "neutral" {
  return extremeWindCount >= EXTREME_WIND_BEARISH_THRESHOLD
    ? "bearish"
    : "neutral";
}

function buildStormSource(fetched_at: string): BrainOutputMetricSource {
  return {
    url: stormSourceUrl(),
    fetched_at,
    tier: 1,
    citation:
      `${STORM_HISTORY_CITATION_BASE} ` +
      `(SWFL counties: ${SWFL_COUNTIES.join("+")}; vintage 1996-2025 modern-schema; ` +
      "ingested by ingest/duckdb_pipelines/storm_history_swfl/pipeline.py).",
  };
}

function stormCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const perCounty = perCountyFrom(allFragments);
  const corpus = corpusFrom(allFragments);
  lastFetchedAt = allFragments[0]?.fetched_at ?? null;

  if (perCounty.length === 0 || corpus == null) {
    lastSnapshot = null;
    return [];
  }
  const snapshot = buildSnapshot(perCounty, corpus);
  lastSnapshot = snapshot;

  const facts: SynthesisFact[] = [];

  facts.push({
    topic: "corpus_overview",
    fact: `NOAA Storm Events corpus — SWFL footprint (${SWFL_COUNTIES.join("+")}), vintage ${corpus.vintage_start_year}-${corpus.vintage_end_year}`,
    value:
      `Southwest Florida storm history across ${SWFL_COUNTIES.length} counties — ${snapshot.swflTotalStormCount.toLocaleString()} total events ` +
      `from NOAA NCEI Storm Events Database (${corpus.vintage_start_year}-${corpus.vintage_end_year} modern-schema vintage). ` +
      `${corpus.unparseable_damage_count.toLocaleString()} events have unparseable damage_property strings (excluded from damage metrics).`,
    source_fragment_ids: [],
  });

  facts.push({
    topic: "metric:property_damage_events_10yr",
    fact: "SWFL property-damage events in the trailing 10-year window",
    value: `${snapshot.swflPropertyDamageEvents10yr.toLocaleString()} events with parseable, non-zero property damage across LEE+COLLIER+CHARLOTTE in the trailing 10-year window.`,
    source_fragment_ids: [],
  });

  facts.push({
    topic: "metric:extreme_wind_events_10yr",
    fact: "SWFL hurricane-force-wind events (>= 74 kt) in the trailing 10-year window",
    value: `${snapshot.swflExtremeWindEvents10yr.toLocaleString()} events with MAGNITUDE >= 74 kt across the SWFL footprint in the trailing 10-year window.`,
    source_fragment_ids: [],
  });

  facts.push({
    topic: "metric:major_storm_count_30yr",
    fact: "SWFL major-storm count (full 30-year vintage, damage >= $1M AND major event type)",
    value: `${snapshot.swflMajorStormCount30yr.toLocaleString()} events qualify as major storms (damage >= $1M AND event_type in {Hurricane, Tornado, Flash Flood, Storm Surge/Tide}) across the full ${corpus.vintage_start_year}-${corpus.vintage_end_year} vintage.`,
    source_fragment_ids: [],
  });

  facts.push({
    topic: "metric:total_storm_count_30yr",
    fact: "SWFL total storm event count (full 30-year vintage)",
    value: `${snapshot.swflTotalStormCount.toLocaleString()} total storm events across the SWFL footprint for ${corpus.vintage_start_year}-${corpus.vintage_end_year}.`,
    source_fragment_ids: [],
  });

  if (
    corpus.last_billion_dollar_event_date &&
    corpus.last_billion_dollar_event_type
  ) {
    facts.push({
      topic: "metric:last_billion_dollar_event",
      fact: "Most recent SWFL billion-dollar storm event",
      value: `Last billion-dollar event in the SWFL footprint: ${corpus.last_billion_dollar_event_type} on ${corpus.last_billion_dollar_event_date}.`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

function stormOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snapshot = lastSnapshot;
  const fetched_at =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!snapshot) {
    return {
      conclusion:
        "storm-history-swfl could not load any NOAA Storm Events aggregates this build — the Parquet read returned no SWFL rows.",
      key_metrics: [],
      caveats: [
        `Zero per-county aggregates survived fetch. If live mode, confirm s3://lake-tier1/environmental/storm_events_swfl.parquet exists (data_lake._tier1_inventory) and S3 creds are loaded; if fixture mode, confirm refinery/__fixtures__/storm-history-swfl.sample.parquet is present.`,
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const corpus = snapshot.corpus;
  const sourceMeta = buildStormSource(fetched_at);
  const direction: BrainOutputDirection = directionFromExtremeWind(
    snapshot.swflExtremeWindEvents10yr,
  );
  // Magnitude: explicit baseline-not-zero on the neutral path so master sees a
  // low-weight contributor; bearish path bumps to 0.5 (risk-history brains
  // never claim full conviction — the ongoing exposure read lives in env-swfl).
  const magnitude = direction === "bearish" ? 0.5 : 0.2;

  const key_metrics: BrainOutputMetric[] = [];

  key_metrics.push({
    metric: "storm_property_damage_events_10yr",
    value: snapshot.swflPropertyDamageEvents10yr,
    direction: "stable",
    label:
      "SWFL property-damage event count (trailing 10-year window, all 3 SWFL counties)",
    variable_type: "extensive",
    units: "events",
    display_format: "count",
    source: sourceMeta,
  });

  key_metrics.push({
    metric: "storm_extreme_wind_events_10yr",
    value: snapshot.swflExtremeWindEvents10yr,
    direction: "stable",
    label:
      "SWFL hurricane-force wind event count (MAGNITUDE >= 74 kt, trailing 10-year window)",
    variable_type: "extensive",
    units: "events",
    display_format: "count",
    source: sourceMeta,
  });

  key_metrics.push({
    metric: "storm_major_storm_count_30yr",
    value: snapshot.swflMajorStormCount30yr,
    direction: "stable",
    label:
      "SWFL major storm count (damage >= $1M AND event_type in MAJOR_EVENT_TYPES, full vintage)",
    variable_type: "extensive",
    units: "events",
    display_format: "count",
    source: sourceMeta,
  });

  key_metrics.push({
    metric: "storm_total_storm_count_30yr",
    value: snapshot.swflTotalStormCount,
    direction: "stable",
    label: `SWFL total storm event count (full vintage ${corpus.vintage_start_year}-${corpus.vintage_end_year})`,
    variable_type: "extensive",
    units: "events",
    display_format: "count",
    source: sourceMeta,
  });

  if (
    corpus.last_billion_dollar_event_date &&
    corpus.last_billion_dollar_event_type
  ) {
    key_metrics.push({
      metric: "storm_last_billion_dollar_event_date",
      value: corpus.last_billion_dollar_event_date,
      direction: "stable",
      label: "Most recent SWFL billion-dollar storm event date (ISO 8601)",
      variable_type: "categorical",
      source: sourceMeta,
    });
    key_metrics.push({
      metric: "storm_last_billion_dollar_event_type",
      value: corpus.last_billion_dollar_event_type,
      direction: "stable",
      label: "Most recent SWFL billion-dollar storm event type",
      variable_type: "categorical",
      source: sourceMeta,
    });
  }

  key_metrics.push({
    metric: "storm_counties_covered",
    value: corpus.counties_covered.join("+"),
    direction: "stable",
    label: "SWFL counties present in the storm history corpus (alphabetical)",
    variable_type: "categorical",
    source: sourceMeta,
  });

  key_metrics.push({
    metric: "storm_ingest_vintage",
    value: `${corpus.vintage_start_year}-${corpus.vintage_end_year}`,
    direction: "stable",
    label: "NOAA Storm Events vintage range covered by this build",
    variable_type: "categorical",
    source: sourceMeta,
  });

  const conclusionParts: string[] = [];
  conclusionParts.push(
    `Southwest Florida storm history (${SWFL_COUNTIES.join(" + ")}) — ` +
      `${snapshot.swflTotalStormCount.toLocaleString()} total NOAA Storm Events across the ${corpus.vintage_start_year}-${corpus.vintage_end_year} modern-schema vintage, ` +
      `${snapshot.swflMajorStormCount30yr.toLocaleString()} qualifying as major storms (damage >= $1M AND event_type in {Hurricane, Tornado, Flash Flood, Storm Surge/Tide}).`,
  );
  if (
    corpus.last_billion_dollar_event_date &&
    corpus.last_billion_dollar_event_type
  ) {
    conclusionParts.push(
      `Most recent billion-dollar event in scope: ${corpus.last_billion_dollar_event_type} on ${corpus.last_billion_dollar_event_date}.`,
    );
  } else {
    conclusionParts.push(
      "No billion-dollar events present in the current corpus window.",
    );
  }
  conclusionParts.push(
    `Trailing 10-year window: ${snapshot.swflPropertyDamageEvents10yr.toLocaleString()} property-damage events, ` +
      `${snapshot.swflExtremeWindEvents10yr.toLocaleString()} events at hurricane-force wind (>= 74 kt) — ${direction} read on near-term physical risk.`,
  );

  const caveats: string[] = [];
  caveats.push(
    `NOAA modernized the Storm Events schema in 1996; this brain reads the modern-schema vintage only (${corpus.vintage_start_year}+). Pre-1996 records use an incompatible column layout and are excluded by construction.`,
  );
  caveats.push(
    `damage_property strings are parsed best-effort (regex matches "1.5M" / "10K" / "2B" / plain numbers). ${corpus.unparseable_damage_count.toLocaleString()} events in this corpus had unparseable damage strings and are excluded from damage-based metrics (counted but not summed).`,
  );
  caveats.push(
    `Vintage end year is ${corpus.vintage_end_year} — bump YEAR_RANGE_END in ingest/duckdb_pipelines/storm_history_swfl/constants.py and re-run the ingest when NCEI publishes the next yearly file.`,
  );
  caveats.push(
    "Direction is bearish when SWFL-wide extreme-wind event count (>= 74 kt) in the trailing 10-year window crosses 3; neutral otherwise. This brain never emits bullish — absence of named storms is the baseline, not an upside.",
  );
  if (env.source === "fixture") {
    caveats.unshift(
      "Storm-history aggregates in this build are derived from the 91-row fixture Parquet (2022-2024 only) — unset REFINERY_SOURCE or set it to `live` to read the full 1,178-row NOAA vintage from Tier 1 Storage.",
    );
  }

  return {
    conclusion: conclusionParts.join(" "),
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

export const stormHistorySwfl: PackDefinition = {
  id: "storm-history-swfl",
  brain_id: "storm-history-swfl",
  public_label: "Storm History",
  domain: "environmental",
  scope:
    "NOAA Storm Events history for Southwest Florida (LEE + COLLIER + CHARLOTTE), 1996-2025 modern-schema vintage. Surfaces SWFL-wide event counts (total / major / 10yr property-damage / 10yr extreme-wind) and the most recent billion-dollar event for risk-history framing. Pairs with env-swfl (modeled NFHL exposure) — exposure says WHERE flood risk lives, storm-history says WHAT has hit historically.",
  ttl_seconds: 31536000, // 1 year — NCEI publishes annually
  sources: [stormHistorySource],
  input_brains: [],
  fitScore: (): number => 8,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: stormCorpusSummary,
  outputProducer: stormOutputProducer,
  synthesisStrategy: "deterministic",
  preferences: [
    "The user reads storm-history data as a backward-looking risk-record, not a forecast — counts and the last billion-dollar event are the load-bearing fields, not narrative speculation about future seasons.",
    "The user expects the brain to be honest about parsing limits — unparseable damage strings are counted but excluded from damage aggregates, never silently treated as zero.",
    "The user pairs storm-history (what has hit) with env-swfl (modeled flood exposure) when sizing risk — the two brains answer different questions and one never substitutes for the other.",
  ],
  activeProject:
    "storm-history-swfl: standing 30-year NOAA Storm Events read for the SWFL footprint — first brain to consume a Tier 1 Storage Parquet via DuckDB httpfs.",
  prompts: {
    triageContext:
      "These fragments are per-county and corpus-level aggregates pre-computed from a Tier 1 Parquet (s3://lake-tier1/environmental/storm_events_swfl.parquet). They are all decision-relevant by construction; the pack is pure deterministic aggregation over pre-aggregated source values.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by stormCorpusSummary and the BrainOutput is built by stormOutputProducer.",
  },
};
