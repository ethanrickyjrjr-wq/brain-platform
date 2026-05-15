import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type { BrainOutput, BrainOutputMetric } from "../types/brain-output.mts";
import {
  macroSwflSource,
  type MacroSwflNormalized,
} from "../sources/macro-swfl-source.mts";
import {
  makeBrainInputSource,
  type BrainInputNormalized,
} from "../sources/brain-input-source.mts";

/**
 * macro-swfl — financial macro snapshot for SWFL operators.
 *
 * Branches: four FRED series (SOFR, FLUR, CPI YoY, FLLFPR) — the macro
 * indicators an SWFL real-estate / franchise operator actually reads when
 * pricing capital, sizing absorption, and judging the timing window.
 *
 * Upstream brain: `master` (the SWFL Intelligence Lake index). macro-swfl
 * reads master's OUTPUT block via BrainInputSource so the macro snapshot is
 * paired with the same-market context master already curates.
 *
 * Pure deterministic pack — no synthesis agent. Every fact is computed in
 * code from typed fragments, and the BrainOutput is assembled by a
 * dedicated outputProducer. Confidence inherits the worst of (self,
 * upstream) per the propagation rule in lib/confidence.mts.
 */

// ---------------------------------------------------------------------
// Closure state — populated by corpusSummary, read by outputProducer.
// SynthesizedEvent.value is a string, so we keep the typed indicators here
// to recover them when building BrainOutput.key_metrics. Per-pack-build
// scope only; safe within a single pipeline run.
// ---------------------------------------------------------------------
let lastIndicators: MacroSwflNormalized[] = [];
let lastMasterOutput: BrainOutput | null = null;

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

function masterOutputFrom(fragments: RawFragment[]): BrainOutput | null {
  for (const f of fragments) {
    const n = f.normalized as unknown as BrainInputNormalized;
    if (n?.kind === "brain-input" && n.upstream_id === "master") {
      return n.output;
    }
  }
  return null;
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
  const master = masterOutputFrom(allFragments);

  // Stash for outputProducer (typed values cannot survive in SynthesisFact.value)
  lastIndicators = indicators;
  lastMasterOutput = master;

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

  // Last — routing fact pointing at master upstream (only when present).
  if (master) {
    facts.push({
      topic: "master :: upstream_routing",
      fact: "SWFL Intelligence Lake context — fetch master for record-level detail",
      value:
        `The SWFL Intelligence Lake master index (confidence ${master.confidence.toFixed(2)} ` +
        `at ${master.refined_at}) covers verified franchise outcomes and CRE corridor profiles ` +
        `for the same Lee–Collier market. Record-level detail is read from master, not inferred here.`,
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
function macroSwflOutputProducer(
  _out: PackOutput,
): Pick<BrainOutput, "conclusion" | "key_metrics" | "caveats"> {
  const indicators = lastIndicators;
  const master = lastMasterOutput;

  const key_metrics: BrainOutputMetric[] = indicators
    .map((i) => {
      const m = METRIC_MAP[i.series_id];
      if (!m) return null;
      return {
        metric: m.metric,
        value: i.value,
        direction: i.direction,
        label: m.label,
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
        `record-level franchise and corridor detail lives in the master index.`,
    );
  }
  if (master) {
    conclusionParts.push(
      `Upstream master confidence is ${master.confidence.toFixed(2)} ` +
        `(as of ${master.refined_at.slice(0, 10)}).`,
    );
  }

  const caveats: string[] = [
    "Macro indicators in this build are synthetic fixture data (FRED-shaped) — replace with a live FRED API fetch before relying on the numbers for decisions.",
  ];

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats,
  };
}

export const macroSwfl: PackDefinition = {
  id: "macro-swfl",
  brain_id: "macro-swfl",
  domain: "finance",
  scope:
    "Macro context for Southwest Florida operators — FRED rates, Florida labor, and US inflation, paired with the SWFL Intelligence Lake index.",
  ttl_seconds: 86400, // 1 day — macro indicators refresh fast
  sources: [macroSwflSource, makeBrainInputSource("master")],
  input_brains: ["master"],
  // Every fragment belongs — both the FRED indicators and the master brain-input.
  // Composite cutoff = 0 so the 2-source DAG output survives triage uncontested.
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
      "These fragments are FRED macro indicators and a master-index OUTPUT pointer. They are all decision-relevant by construction; the pack is pure deterministic aggregation.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by macroSwflCorpusSummary and the BrainOutput is built by macroSwflOutputProducer.",
  },
};
