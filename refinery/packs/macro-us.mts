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
  macroUsSource,
  type MacroUsNormalized,
} from "../sources/macro-us-source.mts";
import { env } from "../config/env.mts";

/**
 * macro-us — national macro context (SOFR + US CPI YoY).
 *
 * Root of the three-tier macro denominator chain:
 *   macro-us → macro-florida → macro-swfl.
 *
 * Branches: two FRED series — the national funding-rate and inflation reads
 * that every regional brain consumes via the chain. Future regional brains
 * (macro-georgia, macro-texas) reuse this as a shared parent without
 * duplicating the national series.
 *
 * Leaf brain (no upstream). Pure deterministic — no synthesis agent. Every
 * fact is computed in code from typed fragments, and the BrainOutput is
 * assembled by a dedicated outputProducer.
 */

let lastIndicators: MacroUsNormalized[] = [];
let lastFetchedAt: string | null = null;

function buildFredSource(
  indicator: MacroUsNormalized,
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

const METRIC_MAP: Record<string, { metric: string; label: string }> = {
  SOFR: {
    metric: "sofr_rate",
    label: "SOFR (Secured Overnight Financing Rate)",
  },
  CPIAUCSL_YOY: { metric: "cpi_yoy", label: "US CPI YoY" },
};

function indicatorsFrom(fragments: RawFragment[]): MacroUsNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as MacroUsNormalized)
    .filter((n) => n?.kind === "macro-indicator");
}

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();

function macroUsCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const indicators = indicatorsFrom(allFragments);

  lastIndicators = indicators;
  lastFetchedAt = allFragments[0]?.fetched_at ?? null;

  if (indicators.length === 0) return [];

  const facts: SynthesisFact[] = [];

  const snapshot = indicators
    .map(
      (i) =>
        `${i.label} is ${fmt(i.value)}% (${i.direction}) as of ${i.period}`,
    )
    .join("; ");
  facts.push({
    topic: "macro_snapshot",
    fact: "Current national macro context — funding rates and headline inflation",
    value:
      `National macro snapshot: ${snapshot}. These two series anchor the funding-cost ` +
      `and inflation backdrop every state and regional brain reads through the macro chain.`,
    source_fragment_ids: [],
  });

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

function macroUsOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const indicators = lastIndicators;
  const fetched_at =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const key_metrics: BrainOutputMetric[] = indicators
    .map((i): BrainOutputMetric | null => {
      const m = METRIC_MAP[i.series_id];
      if (!m) return null;
      return {
        metric: m.metric,
        value: i.value,
        direction: i.direction,
        label: m.label,
        // Both FRED series exposed here (SOFR + CPI YoY) are percentages — rates,
        // not counts. intensive/percent across the board.
        variable_type: "intensive",
        units: "percent",
        display_format: "percent",
        source: buildFredSource(i, fetched_at),
      };
    })
    .filter((m): m is BrainOutputMetric => m !== null);

  const conclusionParts: string[] = [];
  if (indicators.length > 0) {
    const sofr = indicators.find((i) => i.series_id === "SOFR");
    const cpi = indicators.find((i) => i.series_id === "CPIAUCSL_YOY");
    const tone: string[] = [];
    if (sofr) {
      tone.push(`SOFR at ${fmt(sofr.value)}% and ${sofr.direction}`);
    }
    if (cpi) {
      tone.push(`headline CPI at ${fmt(cpi.value)}% YoY and ${cpi.direction}`);
    }
    conclusionParts.push(
      `As of the latest reported periods, the national macro backdrop reads: ${tone.join(", ")}.`,
    );
    conclusionParts.push(
      `This brain is the root of the macro chain (macro-us → macro-florida → macro-swfl). ` +
        `State and regional brains read the funding-cost and inflation backdrop through here.`,
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

  const vote = voteMacroDirection(indicators);

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats: [...sourceCaveats, ...vote.caveats],
    direction: vote.direction,
    magnitude: vote.magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

type IndicatorVote = "bullish" | "bearish" | "neutral";

function voteMacroIndicator(i: MacroUsNormalized): IndicatorVote {
  if (i.direction === "stable") return "neutral";
  return i.direction === "rising" ? "bearish" : "bullish";
}

function voteMacroDirection(indicators: MacroUsNormalized[]): {
  direction: BrainOutputDirection;
  magnitude: number;
  caveats: string[];
} {
  const votes = indicators.map(voteMacroIndicator);
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
        `National macro indicators split: ${bullish} bullish, ${bearish} bearish, ${neutral} neutral — operator cannot read one direction from this set.`,
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

export const macroUs: PackDefinition = {
  id: "macro-us",
  brain_id: "macro-us",
  public_label: "US Macro",
  domain: "macro",
  scope:
    "National macro context — SOFR funding rate and US CPI YoY. Root of the three-tier macro denominator chain (macro-us → macro-florida → macro-swfl).",
  ttl_seconds: 86400, // 1 day — macro indicators refresh fast
  sources: [macroUsSource],
  input_brains: [],
  fitScore: (): number => 8,
  compositeCutoff: 0,
  skipSynthesisAgent: true,
  corpusSummary: macroUsCorpusSummary,
  outputProducer: macroUsOutputProducer,
  preferences: [
    "The user is a regional/state operator who reads national funding-rate and inflation indicators to time capital decisions.",
    "The user treats SOFR direction as the single highest-signal series for pricing floating-rate debt.",
    "The user pairs the national macro snapshot with state and regional brains via the macro chain rather than consuming raw FRED downstream.",
  ],
  activeProject:
    "macro-us: standing national macro snapshot — funding rates and headline inflation as the root of the macro denominator chain.",
  prompts: {
    triageContext:
      "These fragments are national FRED macro indicators (SOFR, CPI YoY). They are all decision-relevant by construction; the pack is pure deterministic aggregation.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by macroUsCorpusSummary and the BrainOutput is built by macroUsOutputProducer.",
  },
};
