// buildChartForQuestion — the one moat-safe chart producer for the CONVERSATION
// path (BriefcaseChat / OUTSIDE / public welcome). It mirrors what the report
// path does inline, but generalizes BEYOND the 4 hardcoded fixture intents to
// ANY chartable brain we hold.
//
// THE MOAT (non-negotiable): every number plotted is a REAL, audited brain
// number. The LLM never touches a chart figure — `computeMetricChart` builds
// the bar in code from the brain's already-public key_metrics / detail_tables
// (lint-passed, leak-guarded), and `summarizeChartForGrounding` hands the model
// only those figures with an explicit "state ONLY these; never invent" rule.
//
// Two layers, first hit wins:
//   1. RICH special-case visuals — `routeChart` → `buildChartForIntent`
//      (zhvi area-trend, corridor scatter, vacancy / asking-rent bars). These
//      are shapes the generic bar producer cannot make (a raw-array time series
//      / relationship), so they stay a deliberate overlay.
//   2. GENERIC any-brain bar — route the question to the most relevant brain
//      (`resolveReachTargets`) and emit THAT brain's pre-computed
//      `computeMetricChart` block (the same chart that already rides /r and the
//      `/api/b` dossier). Covers env / cre / permits / rentals / labor / tourism
//      — every chartable brain, not just the 4 fixtures.
//
// Returns null when nothing chartable matches (text-only answer). Never throws —
// a chart is best-effort and must never block or 500 the answer.
import { routeChart, routeRankedDelta } from "@/lib/route-chart";
import { buildChartForIntent, summarizeChartForGrounding } from "@/lib/build-chart-for-intent.mts";
import { resolveReachTargets } from "@/lib/highlighter/reach";
import { fetchBrain } from "@/lib/fetch-brain";
import { computeMetricChart } from "@/refinery/lib/chart-from-metrics.mts";
import { bindRankedDeltaSpec } from "@/lib/deliverable/ranked-delta-bind";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";

export interface ChartForQuestion {
  /** The ready-to-render spec (carries its own frameId). */
  chart: ChartSpec;
  /** The chart's REAL figures as a grounding block — injected into the system
   *  prompt so the analyst describes the chart from truth and never invents a
   *  figure it was not given (the same technique the report path uses). */
  groundingNote: string;
}

export async function buildChartForQuestion(
  question: string,
  origin: string,
): Promise<ChartForQuestion | null> {
  if (!question || typeof question !== "string") return null;

  // Layer 0 — explicit ranked-delta intent ("rank/compare ZIPs by home value /
  // investor yield / market heat, with the YoY change"). resolveReachTargets never
  // routes to these value+delta brains, and routeChart would send "home value" to
  // the zhvi TREND — so without this, ranked-delta never reaches chat or email. The
  // router fires only on a value+delta topic AND a ranking intent, so trend
  // questions still get the zhvi area chart below. This is what lands ranked-delta
  // in a scheduled email.
  try {
    const rdSlug = routeRankedDelta(question);
    if (rdSlug) {
      const { output } = await fetchBrain(rdSlug, { tier: 2, origin });
      const rd = bindRankedDeltaSpec(output);
      if (rd) return { chart: rd, groundingNote: summarizeChartForGrounding(rd) };
    }
  } catch {
    /* fall through to the canned + generic producers */
  }

  // Layer 1 — rich special-case visuals. `routeChart` can match an intent whose
  // builder returns null (e.g. flood-aal has no detail_table yet); in that case
  // we DON'T return here — we fall through to the generic any-brain path, which
  // can still chart that brain (env-swfl AAL-by-ZIP) from its computed block.
  try {
    const intent = routeChart(question);
    if (intent) {
      const chart = await buildChartForIntent(intent);
      if (chart) return { chart, groundingNote: summarizeChartForGrounding(chart) };
    }
  } catch {
    /* fall through to the generic producer */
  }

  // Layer 2 — generic any-brain bar from the deterministic producer. Walk the
  // routed brains in priority order; the first one with a chartable shape wins.
  try {
    for (const slug of resolveReachTargets(question, "master")) {
      const { output } = await fetchBrain(slug, { tier: 2, origin });

      // Auto-pick upgrade: when this brain's table carries a value column paired
      // with its OWN period-over-period delta (home_value_zhvi + value_yoy_pct, …),
      // emit ranked-delta — the same bars plus a ▲/▼ chip. Strictly non-regressive:
      // null when no clean pair exists, falling through to the bar below. The binder
      // is registry-free, so this stays off the chat route's server bundle.
      const ranked = bindRankedDeltaSpec(output);
      if (ranked) return { chart: ranked, groundingNote: summarizeChartForGrounding(ranked) };

      const block = computeMetricChart(output);
      if (block) {
        // Server-side lift: computeMetricChart only ever stamps frame_id
        // "bar-table", so this is a faithful one-line ChartBlock → ChartSpec
        // (no registry import on the server; the client DockChart validates
        // frameId and degrades to <ChartUnavailable> if it ever drifts).
        const chart: ChartSpec = { ...block, frameId: block.frame_id ?? "bar-table" };
        return { chart, groundingNote: summarizeChartForGrounding(chart) };
      }
    }
  } catch {
    /* no chart — the answer streams text-only */
  }

  return null;
}
