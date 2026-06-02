import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutput,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import {
  makeBrainInputSource,
  type BrainInputNormalized,
} from "../sources/brain-input-source.mts";
import {
  blsLausSource,
  type LausSwflSummary,
} from "../sources/bls-laus-source.mts";

/**
 * macro-swfl — regional macro context for the Southwest Florida market.
 *
 * Leaf tier of the three-tier macro denominator chain:
 *   macro-us → macro-florida → macro-swfl.
 *
 * Own sources: BLS LAUS for Lee + Collier counties (monthly unemployment rate,
 * labor force, employment). Upstream: macro-florida, consumed via
 * BrainInputSource for confidence propagation and the FL state baseline.
 *
 * Direction threshold: ±0.2pp YoY delta. BLS LAUS county-level monthly
 * revisions typically swing ±0.1pp (BLS LAUS methodology); 0.2pp exceeds
 * revision noise so direction calls are not revision-driven. Strictly greater
 * than, so exactly ±0.2pp resolves to "stable."
 *
 * Pure deterministic — no synthesis agent. skipTriageAgent because both
 * sources emit a single typed summary fragment — nothing to triage.
 */

const BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

let lastMacroFloridaOutput: BrainOutput | null = null;
let lastLausSummary: LausSwflSummary | null = null;
let lastLausFetchedAt: string | null = null;

function brainInputFrom(
  fragments: RawFragment[],
  upstreamId: string,
): BrainOutput | null {
  for (const f of fragments) {
    const n = f.normalized as unknown as BrainInputNormalized;
    if (n?.kind === "brain-input" && n.upstream_id === upstreamId) {
      return n.output;
    }
  }
  return null;
}

function lausFrom(fragments: RawFragment[]): {
  summary: LausSwflSummary | null;
  fetched_at: string | null;
} {
  for (const f of fragments) {
    const n = f.normalized as { kind?: string };
    if (n?.kind === "laus-swfl-summary") {
      return {
        summary: f.normalized as LausSwflSummary,
        fetched_at: f.fetched_at ?? null,
      };
    }
  }
  return { summary: null, fetched_at: null };
}

// ±0.2pp threshold — see brain docstring for citation.
function lausDirection(delta: number | null): "rising" | "falling" | "stable" {
  if (delta == null) return "stable";
  if (delta > 0.2) return "rising";
  if (delta < -0.2) return "falling";
  return "stable";
}

function makeSource(
  fetched_at: string,
  seriesId: string,
  refMonth: string,
  value: number,
  units: string,
): BrainOutputMetricSource {
  return {
    url: BLS_API_URL,
    fetched_at,
    tier: 1,
    citation: `BLS LAUS series ${seriesId}, ${refMonth} = ${value}${units}`,
  };
}

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();

function macroSwflCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const macroFl = brainInputFrom(allFragments, "macro-florida");
  lastMacroFloridaOutput = macroFl;

  const { summary: laus, fetched_at } = lausFrom(allFragments);
  lastLausSummary = laus;
  lastLausFetchedAt = fetched_at;

  if (!laus) {
    if (!macroFl) return [];
    const flMetricsLine = macroFl.key_metrics
      .map((m) => `${m.label} ${fmt(Number(m.value))}% (${m.direction})`)
      .join("; ");
    return [
      {
        topic: "macro_swfl_baseline",
        fact: "SWFL regional macro context — Florida state baseline used as proxy",
        value:
          `macro-swfl county-level BLS LAUS data is unavailable. ` +
          `The Florida state baseline (macro-florida, confidence ${macroFl.confidence.toFixed(2)}) ` +
          `is the best available proxy: ${flMetricsLine}.`,
        source_fragment_ids: [],
      },
    ];
  }

  const refMonth = laus.reference_month ?? "unknown";
  const leRate = laus.lee_county.unemployment_rate;
  const coRate = laus.collier_county.unemployment_rate;
  const flRate = laus.fl_state.unemployment_rate;
  const flBase =
    flRate != null
      ? `FL state baseline ${fmt(flRate)}%`
      : "FL state baseline unavailable";

  const facts: SynthesisFact[] = [];

  if (leRate != null && flRate != null) {
    const gap = Math.round((leRate - flRate) * 10) / 10;
    const sign = gap >= 0 ? "+" : "";
    facts.push({
      topic: "laus_lee_vs_fl",
      fact: `Lee County unemployment rate vs FL state baseline`,
      value: `Lee County ${fmt(leRate)}% vs ${flBase} (gap: ${sign}${fmt(gap)}pp, ${refMonth}${laus.is_preliminary ? ", preliminary" : ""})`,
      source_fragment_ids: [],
    });
  }

  if (coRate != null && flRate != null) {
    const gap = Math.round((coRate - flRate) * 10) / 10;
    const sign = gap >= 0 ? "+" : "";
    facts.push({
      topic: "laus_collier_vs_fl",
      fact: `Collier County unemployment rate vs FL state baseline`,
      value: `Collier County ${fmt(coRate)}% vs ${flBase} (gap: ${sign}${fmt(gap)}pp, ${refMonth}${laus.is_preliminary ? ", preliminary" : ""})`,
      source_fragment_ids: [],
    });
  }

  if (flRate != null) {
    facts.push({
      topic: "laus_fl_benchmark",
      fact: "FL LAUS state rate (denominator benchmark for gap math)",
      value: `FL state LAUS ${fmt(flRate)}% (${refMonth})${macroFl ? ` — macro-florida confidence ${macroFl.confidence.toFixed(2)}` : ""}`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

function macroSwflOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const macroFl = lastMacroFloridaOutput;
  const laus = lastLausSummary;
  const fetchedAt =
    lastLausFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!macroFl && !laus) {
    return {
      conclusion:
        "macro-swfl could not resolve any upstream data — no SWFL macro context available.",
      key_metrics: [],
      caveats: [
        "Upstream macro-florida brain was unavailable and BLS LAUS data could not be loaded.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  if (!laus) {
    // Fallback — LAUS ingest not yet run; pass through FL baseline.
    const macroFlOut = macroFl!;
    const flSummary = macroFlOut.key_metrics
      .map((m) => `${m.label} ${fmt(Number(m.value))}% (${m.direction})`)
      .join(", ");
    return {
      conclusion:
        `macro-swfl is a regional delta brain. County-level BLS LAUS for Lee + Collier ` +
        `has not yet been ingested. The Florida state baseline reads: ${flSummary} ` +
        `(via macro-florida, confidence ${macroFlOut.confidence.toFixed(2)}). ` +
        `Downstream consumers needing macro context should declare macro-florida or macro-us as direct upstreams ` +
        `until SWFL-specific data lands.`,
      key_metrics: [],
      caveats: [
        "macro-swfl emits no SWFL-specific metrics — county-level BLS LAUS for Lee + Collier has not yet been ingested.",
      ],
      direction: macroFlOut.direction,
      magnitude: macroFlOut.magnitude,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const refMonth = laus.reference_month ?? "unknown";
  const leRate = laus.lee_county.unemployment_rate;
  const leDelta = laus.lee_county.unemployment_rate_yoy_delta;
  const coRate = laus.collier_county.unemployment_rate;
  const coDelta = laus.collier_county.unemployment_rate_yoy_delta;
  const flRate = laus.fl_state.unemployment_rate;
  const flDelta = laus.fl_state.unemployment_rate_yoy_delta;

  const key_metrics: BrainOutputMetric[] = [];

  if (leRate != null) {
    key_metrics.push({
      metric: "laus_lee_unemployment_rate",
      label: "Lee County Unemployment Rate",
      value: leRate,
      direction: lausDirection(leDelta),
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source: makeSource(
        fetchedAt,
        "LAUCN120710000000003",
        refMonth,
        leRate,
        "%",
      ),
    });
  }

  if (coRate != null) {
    key_metrics.push({
      metric: "laus_collier_unemployment_rate",
      label: "Collier County Unemployment Rate",
      value: coRate,
      direction: lausDirection(coDelta),
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source: makeSource(
        fetchedAt,
        "LAUCN120210000000003",
        refMonth,
        coRate,
        "%",
      ),
    });
  }

  if (flRate != null) {
    key_metrics.push({
      metric: "laus_fl_unemployment_rate",
      label: "Florida LAUS Unemployment Rate",
      value: flRate,
      direction: lausDirection(flDelta),
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source: makeSource(
        fetchedAt,
        "LAUST120000000000003",
        refMonth,
        flRate,
        "%",
      ),
    });
  }

  if (leDelta != null) {
    key_metrics.push({
      metric: "laus_lee_unemployment_rate_yoy_delta",
      label: "Lee County Unemployment Rate YoY Δ",
      value: leDelta,
      direction: lausDirection(leDelta),
      variable_type: "intensive",
      units: "pp",
      display_format: "raw",
      source: {
        url: BLS_API_URL,
        fetched_at: fetchedAt,
        tier: 1,
        citation: `BLS LAUS LAUCN120710000000003, YoY delta (prior-year ${refMonth} → ${refMonth}) = ${leDelta >= 0 ? "+" : ""}${fmt(leDelta)}pp`,
      },
    });
  }

  // Winning direction: weight Lee most heavily (primary SWFL reference market).
  const leeMetricDir = lausDirection(leDelta);
  const flMetricDir = lausDirection(flDelta);
  // Rising unemployment = bearish; falling = bullish; stable = neutral.
  const metricToBrainDir = (
    d: "rising" | "falling" | "stable",
  ): "bullish" | "bearish" | "neutral" =>
    d === "rising" ? "bearish" : d === "falling" ? "bullish" : "neutral";
  const primaryDir = metricToBrainDir(leeMetricDir);
  const direction =
    primaryDir !== "neutral" ? primaryDir : metricToBrainDir(flMetricDir);

  const prelim = laus.is_preliminary ? " (preliminary)" : "";
  const leeStr =
    leRate != null
      ? `Lee County at ${fmt(leRate)}%${leDelta != null ? `, ${leDelta >= 0 ? "+" : ""}${fmt(leDelta)}pp YoY` : ""}`
      : null;
  const collierStr =
    coRate != null
      ? `Collier County at ${fmt(coRate)}%${coDelta != null ? `, ${coDelta >= 0 ? "+" : ""}${fmt(coDelta)}pp YoY` : ""}`
      : null;
  const flStr =
    flRate != null ? `FL state LAUS ${fmt(flRate)}% (benchmark)` : null;

  const metricParts = [leeStr, collierStr, flStr].filter(Boolean).join("; ");

  const conclusion =
    `SWFL labor market, ${refMonth}${prelim}: ${metricParts}. ` +
    (macroFl
      ? `Against the FL state macro backdrop (macro-florida, confidence ${macroFl.confidence.toFixed(2)}), ` +
        `SWFL county unemployment is ${leeMetricDir === "rising" ? "rising faster than" : leeMetricDir === "falling" ? "improving relative to" : "tracking"} the state average.`
      : "");

  const caveats: string[] = [];
  if (laus.is_preliminary) {
    caveats.push(
      `BLS LAUS data for ${refMonth} is preliminary — subject to revision at next monthly release.`,
    );
  }
  if (!macroFl) {
    caveats.push(
      "macro-florida upstream was unavailable — FL state confidence propagation is suspended.",
    );
  }

  return {
    conclusion,
    key_metrics,
    caveats,
    direction,
    magnitude: Math.min(Math.abs(leDelta ?? 0) / 0.5, 1.0),
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

export const macroSwfl: PackDefinition = {
  id: "macro-swfl",
  brain_id: "macro-swfl",
  public_label: "SWFL Macro",
  domain: "macro",
  scope:
    "Regional macro context for Southwest Florida — leaf tier of the three-tier macro chain (macro-us → macro-florida → macro-swfl). Own sources: BLS LAUS monthly unemployment for Lee County + Collier County. Upstream: macro-florida for FL state baseline and confidence propagation.",
  ttl_seconds: 86400,
  sources: [makeBrainInputSource("macro-florida"), blsLausSource],
  input_brains: [{ id: "macro-florida", edge_type: "input" }],
  fitScore: (): number => 8,
  compositeCutoff: 0,
  skipSynthesisAgent: true,
  skipTriageAgent: true,
  corpusSummary: macroSwflCorpusSummary,
  outputProducer: macroSwflOutputProducer,
  preferences: [
    "The user is an SWFL operator who reads regional macro context against the FL state LAUS baseline.",
    "Lee County is the primary reference market; Collier County is the secondary. FL state is the denominator for gap math.",
    "YoY direction is meaningful when the delta exceeds ±0.2pp (revision noise floor for BLS LAUS county data).",
    "Preliminary data (footnote_codes=P) is labeled as such — it is the most current but subject to revision.",
  ],
  activeProject:
    "macro-swfl: BLS LAUS county unemployment data live for Lee + Collier counties.",
  prompts: {
    triageContext:
      "Fragments are a macro-florida brain OUTPUT and a BLS LAUS laus-swfl-summary. The pack is pure deterministic aggregation with no synthesis or triage agent.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). BrainOutput is built by macroSwflOutputProducer from BLS LAUS county rates + macro-florida upstream.",
  },
};
