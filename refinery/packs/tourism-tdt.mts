import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputDirection,
  BrainOutputMetric,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import {
  tourismTdtSource,
  type TourismTdtNormalized,
} from "../sources/tourism-tdt-source.mts";
import { env } from "../config/env.mts";

/**
 * tourism-tdt — Lee County hospitality pulse from Tourist Development Tax
 * collections (Florida DOR, monthly).
 *
 * Branches: 48 months of `fl_dor_tdt_collections` from the premise-engine
 * Supabase (FY2022 → FY2025 in fixture mode; full 103-row series FY2013 →
 * FY2026 in live mode).
 *
 * Leaf brain (no upstream brains). Per the leaf-back-pointers rule, hospitality
 * brains do not declare master as upstream — master consumes this downstream.
 * Wiring tourism-tdt into master.input_brains is a separate follow-up after
 * the live-mode gauntlet confirms 0 orphans.
 *
 * Pure deterministic pack — no synthesis agent. Every fact is computed in
 * code from typed fragments, and the BrainOutput is assembled by a dedicated
 * outputProducer. Same shape as macro-swfl.
 */

// ---------------------------------------------------------------------
// Closure state — populated by corpusSummary, read by outputProducer.
// Same pattern as macro-swfl: typed values cannot survive in
// SynthesisFact.value (which is a string), so the typed read stays here
// for the producer to consume within a single pipeline run.
// ---------------------------------------------------------------------
let lastSnapshot: TdtSnapshot | null = null;

interface TdtSnapshot {
  /** All rows that came back, filtered to those with a parseable period + value. */
  rows: TourismTdtNormalized[];
  /** Most recent row (by period_yyyymm). null = no usable data. */
  latest: TourismTdtNormalized | null;
  /** Same-month-prior-year row, when present. */
  priorYear: TourismTdtNormalized | null;
  /** Sum of the last 12 valid months ending at `latest`. null = insufficient history. */
  trailing12moUsd: number | null;
  /** Best trailing-12mo total over the pre-Ian window. null = no pre-Ian rows. */
  preIanBaseline12moUsd: number | null;
  /** Mean gross for the same calendar month as `latest`, across all years. */
  sameMonthHistoricalMeanUsd: number | null;
}

function tdtRowsFrom(fragments: RawFragment[]): TourismTdtNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as TourismTdtNormalized)
    .filter((n) => n?.kind === "tdt-collection")
    .filter(
      (n) => n.period_yyyymm.length === 7 && n.gross_collections_usd !== null,
    );
}

/** Sort rows ascending by period_yyyymm — stable, alphanumeric on YYYY-MM. */
function byPeriodAsc(a: TourismTdtNormalized, b: TourismTdtNormalized): number {
  return a.period_yyyymm.localeCompare(b.period_yyyymm);
}

/** Month-of-year (1-12) for a YYYY-MM string. */
function monthOf(yyyymm: string): number {
  return parseInt(yyyymm.slice(5, 7), 10);
}

/** Year (YYYY) for a YYYY-MM string. */
function yearOf(yyyymm: string): number {
  return parseInt(yyyymm.slice(0, 4), 10);
}

/** "YYYY-MM" minus N years, preserving month. */
function shiftYears(yyyymm: string, deltaYears: number): string {
  const y = yearOf(yyyymm) + deltaYears;
  const m = yyyymm.slice(5, 7);
  return `${y}-${m}`;
}

function buildSnapshot(rows: TourismTdtNormalized[]): TdtSnapshot {
  if (rows.length === 0) {
    return {
      rows,
      latest: null,
      priorYear: null,
      trailing12moUsd: null,
      preIanBaseline12moUsd: null,
      sameMonthHistoricalMeanUsd: null,
    };
  }
  const sorted = [...rows].sort(byPeriodAsc);
  const latest = sorted[sorted.length - 1];
  const priorYearKey = shiftYears(latest.period_yyyymm, -1);
  const priorYear =
    sorted.find((r) => r.period_yyyymm === priorYearKey) ?? null;

  // Trailing 12 months ending at latest (inclusive). Sum what we have; if
  // fewer than 12 months exist, the result is still meaningful — we just
  // surface the partial-window caveat downstream.
  const trailingSlice = sorted.slice(-12);
  const trailing12moUsd =
    trailingSlice.length === 0
      ? null
      : trailingSlice.reduce((s, r) => s + (r.gross_collections_usd ?? 0), 0);

  // Pre-Ian baseline: walk pre-Ian rows in 12-month sliding windows, take the
  // max. This represents the strongest pre-Ian annual run — the bar recovery
  // is measured against. null when fewer than 12 pre-Ian months exist.
  const preIan = sorted.filter((r) => !r.post_ian);
  let preIanBaseline12moUsd: number | null = null;
  if (preIan.length >= 12) {
    let maxWindow = 0;
    for (let i = 0; i + 12 <= preIan.length; i++) {
      const sum = preIan
        .slice(i, i + 12)
        .reduce((s, r) => s + (r.gross_collections_usd ?? 0), 0);
      if (sum > maxWindow) maxWindow = sum;
    }
    preIanBaseline12moUsd = maxWindow;
  }

  // Mean for the same calendar month across all years — the denominator for
  // a same-month seasonal position read.
  const latestMonth = monthOf(latest.period_yyyymm);
  const sameMonthRows = sorted.filter(
    (r) => monthOf(r.period_yyyymm) === latestMonth,
  );
  const sameMonthHistoricalMeanUsd =
    sameMonthRows.length === 0
      ? null
      : sameMonthRows.reduce((s, r) => s + (r.gross_collections_usd ?? 0), 0) /
        sameMonthRows.length;

  return {
    rows: sorted,
    latest,
    priorYear,
    trailing12moUsd,
    preIanBaseline12moUsd,
    sameMonthHistoricalMeanUsd,
  };
}

// ---------------------------------------------------------------------
// Display helpers — keep formatting localized to this pack.
// ---------------------------------------------------------------------

function fmtUsdMillions(n: number): string {
  return `$${(n / 1_000_000).toFixed(2)}M`;
}

function fmtPct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function seasonLabel(monthIndex: number): "peak" | "shoulder" | "trough" {
  // SWFL hospitality pattern: Jan-Mar peak (winter snowbirds), Apr-May +
  // Oct-Dec shoulder, Jun-Sep trough (heat + hurricane season).
  if (monthIndex >= 1 && monthIndex <= 3) return "peak";
  if (monthIndex >= 6 && monthIndex <= 9) return "trough";
  return "shoulder";
}

/**
 * Brain-level direction vote — combines YoY momentum and post-Ian recovery
 * into a single bullish/bearish/neutral/mixed read for hospitality operators.
 *
 * Threshold logic:
 *   • YoY > +5% AND recovery_ratio ≥ 0.9 → bullish.
 *   • YoY < -5% OR recovery_ratio < 0.7 → bearish.
 *   • Two signals disagree by enough to matter → mixed.
 *   • Otherwise → neutral.
 *
 * Magnitude scales with how decisive the read is — a clean both-signals-agree
 * reads ~0.8; a marginal one ~0.4; mixed is fixed at 0.5.
 */
function voteTdtDirection(snapshot: TdtSnapshot): {
  direction: BrainOutputDirection;
  magnitude: number;
  yoyPct: number | null;
  recoveryRatio: number | null;
} {
  const latest = snapshot.latest;
  if (!latest || latest.gross_collections_usd === null) {
    return {
      direction: "neutral",
      magnitude: 0,
      yoyPct: null,
      recoveryRatio: null,
    };
  }
  const prior = snapshot.priorYear?.gross_collections_usd ?? null;
  const yoyPct =
    prior !== null && prior !== 0
      ? ((latest.gross_collections_usd - prior) / prior) * 100
      : null;
  const recoveryRatio =
    snapshot.trailing12moUsd !== null &&
    snapshot.preIanBaseline12moUsd !== null &&
    snapshot.preIanBaseline12moUsd > 0
      ? snapshot.trailing12moUsd / snapshot.preIanBaseline12moUsd
      : null;

  const yoyBullish = yoyPct !== null && yoyPct > 5;
  const yoyBearish = yoyPct !== null && yoyPct < -5;
  const recoveryBullish = recoveryRatio !== null && recoveryRatio >= 0.9;
  const recoveryBearish = recoveryRatio !== null && recoveryRatio < 0.7;

  if ((yoyBullish && recoveryBearish) || (yoyBearish && recoveryBullish)) {
    return { direction: "mixed", magnitude: 0.5, yoyPct, recoveryRatio };
  }
  if (yoyBullish && recoveryBullish) {
    return { direction: "bullish", magnitude: 0.8, yoyPct, recoveryRatio };
  }
  if (yoyBearish || recoveryBearish) {
    return { direction: "bearish", magnitude: 0.7, yoyPct, recoveryRatio };
  }
  if (yoyBullish || recoveryBullish) {
    return { direction: "bullish", magnitude: 0.55, yoyPct, recoveryRatio };
  }
  return { direction: "neutral", magnitude: 0.4, yoyPct, recoveryRatio };
}

// ---------------------------------------------------------------------
// Stage 3 — deterministic corpus facts.
// ---------------------------------------------------------------------

const METRIC_LATEST = "latest_monthly_collections_usd";
const METRIC_YOY = "yoy_delta_pct";
const METRIC_TRAILING_12MO = "trailing_12mo_collections_usd";
const METRIC_RECOVERY = "post_ian_recovery_ratio";
const METRIC_SEASONAL = "seasonal_position_vs_history";

function tourismTdtCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const rows = tdtRowsFrom(allFragments);
  const snapshot = buildSnapshot(rows);
  lastSnapshot = snapshot;

  if (!snapshot.latest) return [];

  const facts: SynthesisFact[] = [];
  const latest = snapshot.latest;
  const latestUsd = latest.gross_collections_usd ?? 0;
  const vote = voteTdtDirection(snapshot);
  const season = seasonLabel(monthOf(latest.period_yyyymm));

  // f001 — overview snapshot (one paragraph)
  facts.push({
    topic: "tdt_snapshot",
    fact: `Lee County TDT pulse — latest month ${latest.period_yyyymm} (${season})`,
    value:
      `Lee County Tourist Development Tax — latest reported month ${latest.period_yyyymm} ` +
      `(${season} season) at ${fmtUsdMillions(latestUsd)}. ` +
      (vote.yoyPct !== null
        ? `Year-over-year: ${fmtPct(vote.yoyPct)} vs same month FY${
            snapshot.priorYear?.fiscal_year ?? "?"
          }. `
        : `No same-month prior-year comparable in the loaded window. `) +
      (snapshot.trailing12moUsd !== null
        ? `Trailing 12 months: ${fmtUsdMillions(snapshot.trailing12moUsd)}. `
        : "") +
      (vote.recoveryRatio !== null
        ? `Trailing window stands at ${(vote.recoveryRatio * 100).toFixed(0)}% of the strongest pre-Ian 12-month run.`
        : "Pre-Ian baseline not computable from the loaded window."),
    source_fragment_ids: [],
  });

  // f002 — latest monthly collections
  facts.push({
    topic: `metric:${METRIC_LATEST}`,
    fact: `Latest monthly TDT collections (Lee County)`,
    value:
      `Lee County TDT collections for ${latest.period_yyyymm}: ${fmtUsdMillions(latestUsd)} ` +
      `(fiscal_year ${latest.fiscal_year ?? "?"}, ${season} season).`,
    source_fragment_ids: [],
  });

  // f003 — YoY delta
  if (vote.yoyPct !== null && snapshot.priorYear) {
    facts.push({
      topic: `metric:${METRIC_YOY}`,
      fact: `Same-month year-over-year delta`,
      value:
        `Year-over-year delta for ${latest.period_yyyymm} vs ${snapshot.priorYear.period_yyyymm}: ` +
        `${fmtPct(vote.yoyPct)} ` +
        `(${fmtUsdMillions(latestUsd)} vs ${fmtUsdMillions(snapshot.priorYear.gross_collections_usd ?? 0)}).`,
      source_fragment_ids: [],
    });
  }

  // f004 — trailing 12-month total
  if (snapshot.trailing12moUsd !== null) {
    facts.push({
      topic: `metric:${METRIC_TRAILING_12MO}`,
      fact: `Trailing 12 months of TDT collections (Lee County)`,
      value:
        `Trailing 12 months of Lee County TDT collections through ${latest.period_yyyymm}: ` +
        `${fmtUsdMillions(snapshot.trailing12moUsd)}.`,
      source_fragment_ids: [],
    });
  }

  // f005 — post-Ian recovery ratio
  if (vote.recoveryRatio !== null && snapshot.preIanBaseline12moUsd !== null) {
    facts.push({
      topic: `metric:${METRIC_RECOVERY}`,
      fact: `Post-Hurricane-Ian recovery ratio`,
      value:
        `Post-Ian recovery ratio (trailing 12mo / best pre-Ian 12mo): ` +
        `${(vote.recoveryRatio * 100).toFixed(0)}% ` +
        `(${fmtUsdMillions(snapshot.trailing12moUsd ?? 0)} vs ` +
        `${fmtUsdMillions(snapshot.preIanBaseline12moUsd)}). ` +
        `Ian landfall 2022-09-28; FY2023 onward treated as post-Ian window.`,
      source_fragment_ids: [],
    });
  }

  // f006 — seasonal position
  if (snapshot.sameMonthHistoricalMeanUsd !== null) {
    const seasonalPosition = latestUsd / snapshot.sameMonthHistoricalMeanUsd;
    facts.push({
      topic: `metric:${METRIC_SEASONAL}`,
      fact: `Seasonal position vs same-month historical mean`,
      value:
        `Latest month is ${(seasonalPosition * 100).toFixed(0)}% of the historical mean ` +
        `for the same calendar month across ` +
        `${snapshot.rows.filter((r) => monthOf(r.period_yyyymm) === monthOf(latest.period_yyyymm)).length} ` +
        `observed years (${fmtUsdMillions(latestUsd)} vs ` +
        `${fmtUsdMillions(snapshot.sameMonthHistoricalMeanUsd)} mean).`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

// ---------------------------------------------------------------------
// Stage 4 — BrainOutput producer.
// ---------------------------------------------------------------------

function tourismTdtOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snapshot = lastSnapshot;
  if (!snapshot || !snapshot.latest) {
    return {
      conclusion:
        "tourism-tdt: no usable TDT rows in this build window — pack rendered with no metrics.",
      key_metrics: [],
      caveats: [
        "No fl_dor_tdt_collections rows survived normalization. Check REFINERY_SOURCE and the fixture file before treating this output as a real read.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const latest = snapshot.latest;
  const latestUsd = latest.gross_collections_usd ?? 0;
  const vote = voteTdtDirection(snapshot);
  const season = seasonLabel(monthOf(latest.period_yyyymm));

  const key_metrics: BrainOutputMetric[] = [];

  key_metrics.push({
    metric: METRIC_LATEST,
    value: latestUsd,
    direction:
      vote.yoyPct === null
        ? "stable"
        : vote.yoyPct > 0
          ? "rising"
          : vote.yoyPct < 0
            ? "falling"
            : "stable",
    label: `Latest monthly TDT collections (Lee County, ${latest.period_yyyymm}, ${season} season)`,
  });

  if (vote.yoyPct !== null) {
    key_metrics.push({
      metric: METRIC_YOY,
      value: Math.round(vote.yoyPct * 10) / 10,
      direction:
        vote.yoyPct > 0 ? "rising" : vote.yoyPct < 0 ? "falling" : "stable",
      label: "Year-over-year delta vs same month prior year",
    });
  }

  if (snapshot.trailing12moUsd !== null) {
    key_metrics.push({
      metric: METRIC_TRAILING_12MO,
      value: snapshot.trailing12moUsd,
      direction: "stable", // sum, not a rate-of-change
      label: "Trailing 12-month TDT collections total",
    });
  }

  if (vote.recoveryRatio !== null) {
    key_metrics.push({
      metric: METRIC_RECOVERY,
      value: Math.round(vote.recoveryRatio * 100) / 100,
      direction:
        vote.recoveryRatio >= 0.95
          ? "rising"
          : vote.recoveryRatio < 0.85
            ? "falling"
            : "stable",
      label:
        "Post-Hurricane-Ian recovery ratio (trailing 12mo ÷ best pre-Ian 12mo)",
    });
  }

  if (snapshot.sameMonthHistoricalMeanUsd !== null) {
    const seasonalPosition = latestUsd / snapshot.sameMonthHistoricalMeanUsd;
    key_metrics.push({
      metric: METRIC_SEASONAL,
      value: Math.round(seasonalPosition * 100) / 100,
      direction:
        seasonalPosition > 1.05
          ? "rising"
          : seasonalPosition < 0.95
            ? "falling"
            : "stable",
      label: "Seasonal position vs same-month historical mean",
    });
  }

  const conclusionParts: string[] = [];
  conclusionParts.push(
    `Lee County TDT collections for ${latest.period_yyyymm} (${season} season): ${fmtUsdMillions(latestUsd)}.`,
  );
  if (vote.yoyPct !== null) {
    conclusionParts.push(
      `Year-over-year ${fmtPct(vote.yoyPct)} against the prior fiscal year.`,
    );
  }
  if (vote.recoveryRatio !== null) {
    conclusionParts.push(
      `Trailing 12 months stand at ${(vote.recoveryRatio * 100).toFixed(0)}% of the strongest pre-Hurricane-Ian annual run.`,
    );
  }
  conclusionParts.push(
    `Hospitality / accommodation operators should weight forward decisions against this seasonal pulse; the cross-vertical read lives downstream in master.`,
  );

  const caveats: string[] = [];
  if (env.source === "fixture") {
    caveats.push(
      "TDT collections in this build are SYNTHETIC fixture data — unset REFINERY_SOURCE or set it to `live` to read the real fl_dor_tdt_collections table.",
    );
  } else {
    caveats.push(
      "Florida DOR distribution rosters may revise recent months for ~60 days after first publication — treat the latest month as directional, not final.",
    );
  }
  if (vote.recoveryRatio === null) {
    caveats.push(
      "Post-Ian recovery ratio not computable: the loaded window does not contain ≥12 pre-Ian months. Surface the trailing 12-month total alone, not a recovery framing.",
    );
  }
  if (season === "trough") {
    caveats.push(
      `Latest month is a trough-season reading (${season}). Operators should not extrapolate the single-month figure to an annual run rate — weight against trailing_12mo_collections_usd instead.`,
    );
  }
  if (vote.direction === "mixed") {
    caveats.push(
      "Direction is mixed: YoY momentum and post-Ian recovery point opposite ways. Read the metrics individually before acting on the headline direction.",
    );
  }

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats,
    direction: vote.direction,
    magnitude: vote.magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

export const tourismTdt: PackDefinition = {
  id: "tourism-tdt",
  brain_id: "tourism-tdt",
  domain: "hospitality",
  scope:
    "Lee County hospitality pulse — monthly Tourist Development Tax (TDT) collections from the Florida Department of Revenue, with seasonal, year-over-year, and post-Hurricane-Ian recovery context for accommodation / food-service operators.",
  ttl_seconds: 604800, // 7 days — DOR publishes monthly
  sources: [tourismTdtSource],
  input_brains: [],
  // Every TDT fragment belongs by construction; composite cutoff = 0 so the
  // deterministic output survives triage uncontested.
  fitScore: (): number => 8,
  compositeCutoff: 0,
  // Pure deterministic — every fact is computed in tourismTdtCorpusSummary.
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: tourismTdtCorpusSummary,
  outputProducer: tourismTdtOutputProducer,
  synthesisStrategy: "deterministic",
  preferences: [
    "The user is an SWFL operator who reads Lee County TDT collections as the seasonal pulse for any hospitality, accommodation, or food-service decision in the region.",
    "The user weights post-Hurricane-Ian recovery against the strongest pre-Ian annual run; a single trough-month read never overrides the trailing 12-month total.",
    "The user expects this brain to surface its single direction read and let master synthesize it against macro, sector-credit, CRE, and franchise reads downstream.",
  ],
  activeProject:
    "tourism-tdt: standing hospitality pulse for SWFL operators — monthly Lee County TDT collections, YoY, trailing-12mo, and post-Ian recovery.",
  prompts: {
    triageContext:
      "These fragments are Lee County TDT monthly collection rows from the FL DOR table. They are all decision-relevant by construction; the pack is pure deterministic aggregation.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by tourismTdtCorpusSummary and the BrainOutput is built by tourismTdtOutputProducer.",
  },
};
