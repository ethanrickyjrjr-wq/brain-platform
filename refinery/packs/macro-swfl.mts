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
  macroSwflSource,
  type MacroSwflNormalized,
} from "../sources/macro-swfl-source.mts";
import { env } from "../config/env.mts";

/**
 * macro-swfl — financial macro snapshot for SWFL operators.
 *
 * Branches: four FRED series (SOFR, FLUR, CPI YoY, FLLFPR) — the macro
 * indicators an SWFL real-estate / franchise operator actually reads when
 * pricing capital, sizing absorption, and judging the timing window.
 *
 * Leaf brain (no upstream brains). macro-swfl used to read master's OUTPUT
 * block for context, but Week 2 inverted that: master is now the deterministic
 * synthesizer that aggregates ACROSS the leaves (including macro-swfl), so a
 * back-pointer here would create a DAG cycle. Operators who want the
 * cross-vertical picture read master.md downstream.
 *
 * Pure deterministic pack — no synthesis agent. Every fact is computed in
 * code from typed fragments, and the BrainOutput is assembled by a dedicated
 * outputProducer.
 */

// ---------------------------------------------------------------------
// Closure state — populated by corpusSummary, read by outputProducer.
// SynthesizedEvent.value is a string, so we keep the typed indicators here
// to recover them when building BrainOutput.key_metrics. Per-pack-build
// scope only; safe within a single pipeline run.
// ---------------------------------------------------------------------
let lastIndicators: MacroSwflNormalized[] = [];

let lastFetchedAt: string | null = null;

/**
 * Build the per-metric receipt for a FRED indicator. URL is the canonical FRED
 * series query (api_key stripped, reproducible by anyone with a key); citation
 * names the FRED series with its latest value/period/direction so the receipt
 * is self-contained inside the OUTPUT block.
 */
function buildFredSource(
  indicator: MacroSwflNormalized,
  fetched_at: string,
): BrainOutputMetricSource {
  const valueStr = Number.isInteger(indicator.value)
    ? String(indicator.value)
    : (Math.round(indicator.value * 100) / 100).toString();
  return {
    url: indicator.source_url,
    fetched_at,
    tier: 1,
    citation:
      `FRED ${indicator.label} (series_id ${indicator.series_id}) — ` +
      `latest observation ${valueStr}${indicator.unit ? " " + indicator.unit : ""} ` +
      `for period ${indicator.period}, ${indicator.direction} vs prior 6 periods. ` +
      `${indicator.context}`,
  };
}

/** Stable mapping from FRED series_id → BrainOutput metric slug + label. */
const METRIC_MAP: Record<string, { metric: string; label: string }> = {
  SOFR: {
    metric: "sofr_rate",
    label: "SOFR (Secured Overnight Financing Rate)",
  },
  FLUR: { metric: "fl_unemployment", label: "Florida unemployment rate" },
  CPIAUCSL_YOY: { metric: "cpi_yoy", label: "US CPI YoY" },
  FLLFPR: {
    metric: "fl_labor_participation",
    label: "Florida labor force participation",
  },
};

function indicatorsFrom(fragments: RawFragment[]): MacroSwflNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as MacroSwflNormalized)
    .filter((n) => n?.kind === "macro-indicator");
}

/** Format a number for display — 1dp for percentages, integer-clean otherwise. */
const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();

/**
 * Deterministic corpus facts. The pack is a pure-aggregation brain — no
 * synthesis agent runs (`skipSynthesisAgent: true`). Stage 3 prepends these
 * verbatim with composite forced to max, in this order.
 */
function macroSwflCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const indicators = indicatorsFrom(allFragments);

  // Stash for outputProducer (typed values cannot survive in SynthesisFact.value)
  lastIndicators = indicators;
  lastFetchedAt = allFragments[0]?.fetched_at ?? null;

  if (indicators.length === 0) return [];

  const facts: SynthesisFact[] = [];

  // f001 — overview snapshot, one paragraph
  const snapshot = indicators
    .map(
      (i) =>
        `${i.label} is ${fmt(i.value)}% (${i.direction}) as of ${i.period}`,
    )
    .join("; ");
  facts.push({
    topic: "macro_snapshot",
    fact: "Current macro context for SWFL operators — funding rates, labor, inflation",
    value:
      `Macro snapshot (synthetic fixture; replace with live FRED pull before publishing): ` +
      `${snapshot}. These four series anchor the funding-cost and labor-supply ` +
      `backdrop a Lee–Collier operator reads alongside the SWFL Intelligence Lake.`,
    source_fragment_ids: [],
  });

  // f002+ — one per-indicator fact, tagged with metric: prefix so the renderer
  // / metric-extraction convention can route them into BrainOutput.key_metrics.
  for (const i of indicators) {
    const m = METRIC_MAP[i.series_id];
    if (!m) continue;
    facts.push({
      topic: `metric:${m.metric}`,
      fact: m.label,
      value: `${m.label} is ${fmt(i.value)}% (period ${i.period}, direction ${i.direction}). ${i.context}`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

/**
 * Build BrainOutput from typed state + the resolved PackOutput. Runs in
 * Stage 4 after facts are sorted + f-ids are assigned. Confidence is
 * computed by Stage 4 (deterministic) and overlaid afterwards — this
 * producer only owns conclusion / key_metrics / caveats.
 */
function macroSwflOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const indicators = lastIndicators;
  const fetched_at =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const key_metrics: BrainOutputMetric[] = indicators
    .map((i) => {
      const m = METRIC_MAP[i.series_id];
      if (!m) return null;
      return {
        metric: m.metric,
        value: i.value,
        direction: i.direction,
        label: m.label,
        source: buildFredSource(i, fetched_at),
      };
    })
    .filter((m): m is BrainOutputMetric => m !== null);

  const conclusionParts: string[] = [];
  if (indicators.length > 0) {
    const sofr = indicators.find((i) => i.series_id === "SOFR");
    const flur = indicators.find((i) => i.series_id === "FLUR");
    const cpi = indicators.find((i) => i.series_id === "CPIAUCSL_YOY");
    const tone: string[] = [];
    if (sofr) {
      tone.push(`SOFR at ${fmt(sofr.value)}% and ${sofr.direction}`);
    }
    if (flur) {
      tone.push(
        `Florida unemployment at ${fmt(flur.value)}% (${flur.direction})`,
      );
    }
    if (cpi) {
      tone.push(`headline CPI at ${fmt(cpi.value)}% YoY and ${cpi.direction}`);
    }
    conclusionParts.push(
      `As of the latest reported periods, the SWFL macro backdrop reads: ${tone.join(", ")}.`,
    );
    conclusionParts.push(
      `The funding-cost and labor-supply picture is the operator's primary lens; ` +
        `cross-vertical synthesis (franchise + CRE + sector-credit) lives downstream in master.`,
    );
  }

  const sourceCaveats: string[] =
    env.source === "fixture"
      ? [
          "Macro indicators in this build are synthetic fixture data (FRED-shaped) — unset REFINERY_SOURCE or set it to `live` for the live FRED API.",
        ]
      : [
          "FRED can revise recent observations within ~30 days of first publication — treat the most recent reading as directional, not final.",
        ];

  // Per-indicator vote: rising rates / inflation / unemployment are all
  // bearish for an SWFL operator (funding cost up, Fed less likely to cut,
  // labor demand softening). Falling is the inverse. Stable is neutral.
  const macroVote = voteMacroDirection(indicators);

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats: [...sourceCaveats, ...macroVote.caveats],
    direction: macroVote.direction,
    magnitude: macroVote.magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

type IndicatorVote = "bullish" | "bearish" | "neutral";

/**
 * Per-indicator vote. SOFR, CPI YoY, and FLUR all read "rising = bearish"
 * for an SWFL operator: funding cost up, Fed less likely to cut, labor
 * market softening. Falling is the inverse. Stable / unknown is neutral.
 * FLLFPR is omitted on purpose — labor force participation's directional
 * interpretation is too context-dependent to vote on.
 */
function voteMacroIndicator(i: MacroSwflNormalized): IndicatorVote {
  if (i.direction === "stable") return "neutral";
  const bearish_on_rising =
    i.series_id === "SOFR" ||
    i.series_id === "CPIAUCSL_YOY" ||
    i.series_id === "FLUR";
  if (!bearish_on_rising) return "neutral";
  return i.direction === "rising" ? "bearish" : "bullish";
}

/**
 * Brain-level direction. Counts per-indicator votes:
 *  - any bullish AND any bearish → "mixed" (operator cannot read one direction).
 *  - otherwise winning side adopts; magnitude = winning_count / total.
 *  - all-neutral → "neutral" with magnitude = neutral_count / total (so an
 *    all-stable read is loudly neutral, not silently absent).
 */
function voteMacroDirection(indicators: MacroSwflNormalized[]): {
  direction: BrainOutputDirection;
  magnitude: number;
  caveats: string[];
} {
  const votes = indicators
    .filter((i) => i.series_id !== "FLLFPR")
    .map(voteMacroIndicator);
  const total = votes.length;
  if (total === 0) return { direction: "neutral", magnitude: 0, caveats: [] };
  const bullish = votes.filter((v) => v === "bullish").length;
  const bearish = votes.filter((v) => v === "bearish").length;
  const neutral = votes.filter((v) => v === "neutral").length;

  if (bullish > 0 && bearish > 0) {
    return {
      direction: "mixed",
      magnitude: 0.5,
      caveats: [
        `Macro indicators split: ${bullish} bullish, ${bearish} bearish, ${neutral} neutral — operator cannot read one direction from this set.`,
      ],
    };
  }
  if (bullish > bearish) {
    return { direction: "bullish", magnitude: bullish / total, caveats: [] };
  }
  if (bearish > bullish) {
    return { direction: "bearish", magnitude: bearish / total, caveats: [] };
  }
  return { direction: "neutral", magnitude: neutral / total, caveats: [] };
}

export const macroSwfl: PackDefinition = {
  id: "macro-swfl",
  brain_id: "macro-swfl",
  domain: "finance",
  scope:
    "Macro context for Southwest Florida operators — FRED rates, Florida labor, and US inflation, paired with the SWFL Intelligence Lake index.",
  ttl_seconds: 86400, // 1 day — macro indicators refresh fast
  sources: [macroSwflSource],
  input_brains: [],
  // Every FRED fragment belongs. Composite cutoff = 0 so the DAG output
  // survives triage uncontested.
  fitScore: (): number => 8,
  compositeCutoff: 0,
  // Pure deterministic — every fact is computed in macroSwflCorpusSummary.
  skipSynthesisAgent: true,
  corpusSummary: macroSwflCorpusSummary,
  outputProducer: macroSwflOutputProducer,
  preferences: [
    "The user is an SWFL operator who reads macro indicators to time capital decisions and judge labor-market tightness.",
    "The user treats funding-rate direction and Florida unemployment as the two highest-signal series for Lee–Collier pricing decisions.",
    "The user pairs the macro snapshot with the SWFL Intelligence Lake master index and never infers record-level franchise or corridor detail from macro alone.",
  ],
  activeProject:
    "macro-swfl: standing macro snapshot for SWFL operators — funding rates, Florida labor, US inflation.",
  prompts: {
    triageContext:
      "These fragments are FRED macro indicators. They are all decision-relevant by construction; the pack is pure deterministic aggregation.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by macroSwflCorpusSummary and the BrainOutput is built by macroSwflOutputProducer.",
  },
};
