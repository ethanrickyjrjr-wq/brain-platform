/**
 * lib/deliverable/bind-frame.ts — the LIVE brain → ChartSpec binder (Phase 3).
 *
 * This is the missing seam the Presentation Deliverable Engine was built around:
 * the Phase 2a–2g frame registry (`ChartSpec` / `FrameRenderer`) was orphaned —
 * nothing fed it live brain data. `bindFrameSpec` is that feed. Given a brain's
 * `BrainOutput` and a small request (which frame, which metrics), it produces a
 * ready-to-render `ChartSpec`:
 *   - data pulled from `key_metrics` / `detail_tables` (deterministic, no LLM),
 *   - `asOf` stamped from the brain's own `refined_at` (per-visual vintage),
 *   - `source.citation` carried verbatim from the metric/table provenance.
 *
 * It is PURE (no I/O): the caller (`freezeSnapshot`) loads the brain off disk and
 * hands the parsed `BrainOutput` here. Unsupported / un-bindable requests return
 * `null` so the caller drops the exhibit rather than rendering something broken.
 *
 * `asOf` and `source.citation` are PROVENANCE — never run through prose policing.
 */

import type {
  BrainOutput,
  BrainOutputMetric,
  BrainOutputMetricSource,
} from "../../refinery/types/brain-output.mts";
import { computeMetricChart } from "../../refinery/lib/chart-from-metrics.mts";
import { pickFramesForData } from "../../components/charts/registry/pick-frames";
import { isFixtureOnly } from "../../components/charts/registry/registry";
import type { ChartSpec } from "../../components/charts/registry/chart-spec";

/** What the caller knows about a frame before it is bound to live data. */
export interface FrameBindRequest {
  /** Registry frame id. Absent → auto-pick via `pickFramesForData`. */
  frame_id?: string;
  /** Metric slugs to pull (composition segments / the gauge value). */
  metric_keys?: string[];
  /** Reserved for table-driven frames (not yet bound by the supported set). */
  table_id?: string;
  /** Optional title override; defaults to the source metric / chart title. */
  title?: string;
}

// Two distinct, non-overlapping reasons a frame yields no live ChartSpec — kept
// separate so neither becomes a second hardcoded list:
//   1. fixtureOnly (FrameDef.fixtureOnly, the SINGLE registry gate read here):
//      the frame needs a bespoke fixture no brain emits (seasonal-radial's
//      per-corridor seasonal index) → bindFrameSpec returns null, caller drops.
//   2. not-yet-implemented: a live-bindable frame this binder has no `case` for
//      (zhvi-area, corridor-scatter, storm-timeline) → `buildFrame`'s switch
//      default returns null. A property of the code below, not an exclusion list.

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** ISO date portion of the brain's freshness — the per-visual as-of. */
function asOfOf(output: BrainOutput): string {
  return (output.refined_at ?? "").slice(0, 10);
}

function metricBySlug(output: BrainOutput, slug: string): BrainOutputMetric | undefined {
  return output.key_metrics.find((m) => m.metric === slug);
}

/** Provenance receipt → the ChartBlock `source` field. NEVER sanitized. */
function sourceOf(src: BrainOutputMetricSource | undefined): ChartSpec["source"] {
  if (!src) return undefined;
  return src.url ? { citation: src.citation, url: src.url } : { citation: src.citation };
}

function num(v: number | string | null | undefined): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// bindFrameSpec — the public entry
// ---------------------------------------------------------------------------

/**
 * Bind one frame request to a `ChartSpec`, or `null` if it cannot be bound from
 * this brain's live data. Pure: no fetch, no Date.now, no randomness.
 */
/** Build the named frame if this binder implements it; null otherwise (the
 *  switch default covers live-bindable frames not yet coded, e.g. zhvi-area). */
function buildFrame(
  frameId: string,
  output: BrainOutput,
  req: FrameBindRequest,
  asOf: string,
): ChartSpec | null {
  switch (frameId) {
    case "composition":
      return bindComposition(output, req, asOf);
    case "z-gauge":
      return bindZGauge(output, req, asOf);
    case "bar-table":
      return bindBarTable(output, req, asOf);
    default:
      return null;
  }
}

export function bindFrameSpec(output: BrainOutput, req: FrameBindRequest = {}): ChartSpec | null {
  const asOf = asOfOf(output);
  if (!asOf) return null;

  // Explicit recipe: a fixture-only frame (the single FrameDef.fixtureOnly gate)
  // has no live data to bind → drop it. Otherwise build exactly what was named.
  if (req.frame_id) {
    if (isFixtureOnly(req.frame_id)) return null;
    return buildFrame(req.frame_id, output, req, asOf);
  }

  // Auto: bind EXACTLY what the picker selects (it already drops fixture-only
  // frames via the same flag). If this binder hasn't implemented the picked
  // frame (e.g. zhvi-area's time series, corridor-scatter's 2-var relationship),
  // return null so the caller DROPS it — never substitute a different geometry.
  // bar/table paints only when the picker itself chose ranked-categories; showing
  // a time series or a relationship as bars would misrepresent the data on /p.
  const cand = pickFramesForData(output.detail_tables, output.key_metrics);
  return cand ? buildFrame(cand.frameId, output, req, asOf) : null;
}

// ---------------------------------------------------------------------------
// composition — parts-of-a-whole bar from percent/ratio metrics
// ---------------------------------------------------------------------------

/** Slugs of key_metrics that read as a share (percent, or ratio in [0,1]). */
function autoShareSlugs(output: BrainOutput): string[] {
  return output.key_metrics
    .filter((m) => {
      if (m.display_format === "percent") return true;
      if (m.display_format === "ratio") {
        const v = num(m.value);
        return v !== null && v >= 0 && v <= 1;
      }
      return false;
    })
    .map((m) => m.metric);
}

function bindComposition(
  output: BrainOutput,
  req: FrameBindRequest,
  asOf: string,
): ChartSpec | null {
  const slugs = req.metric_keys?.length ? req.metric_keys : autoShareSlugs(output);
  const metrics = slugs
    .map((s) => metricBySlug(output, s))
    .filter((m): m is BrainOutputMetric => Boolean(m));
  if (metrics.length === 0) return null;

  const segments = metrics
    .map((m) => {
      const v = num(m.value);
      // ratios (≤1) → percent; values already in percent units pass through
      const valuePct = v === null ? 0 : Math.abs(v) <= 1 ? round2(v * 100) : round2(v);
      return { label: m.label, valuePct };
    })
    .filter((s) => s.valuePct > 0);
  if (segments.length === 0) return null;

  // If the named segments don't fill the whole, add the honest complement so the
  // bar reads as a real composition (e.g. "in a flood zone" vs "outside").
  const sum = segments.reduce((a, s) => a + s.valuePct, 0);
  if (sum < 99.5) segments.push({ label: "Remaining area", valuePct: round2(100 - sum) });

  const title = req.title ?? `${metrics[0].label} — composition`;
  return {
    title,
    columns: ["segment", "share_pct"],
    rows: segments.map((s) => [s.label, s.valuePct]),
    chart_type: "bar",
    value_format: "percent",
    asOf,
    source: sourceOf(metrics[0].source),
    frameId: "composition",
    options: { segments },
  };
}

// ---------------------------------------------------------------------------
// z-gauge — single value against a baseline (index, rate vs target, …)
// ---------------------------------------------------------------------------

function bindZGauge(output: BrainOutput, req: FrameBindRequest, asOf: string): ChartSpec | null {
  const slug = req.metric_keys?.[0];
  const metric = slug
    ? metricBySlug(output, slug)
    : output.key_metrics.find((m) => num(m.value) !== null);
  if (!metric) return null;

  const value = num(metric.value);
  if (value === null) return null;

  const unit = metric.units ?? "";
  // An index series is centered on its base (100); everything else on 0.
  const isIndex = /index/i.test(unit) || /index/i.test(metric.label);
  const baseline = isIndex ? 100 : 0;

  let min: number;
  let max: number;
  if (baseline > 0) {
    min = baseline * 0.8;
    max = baseline * 1.2;
  } else {
    min = 0;
    max = value > 0 ? value * 1.25 : 100;
  }
  // Guarantee the value is in range, then round to clean gauge bounds.
  min = Math.floor(Math.min(min, value));
  max = Math.ceil(Math.max(max, value));

  const title = req.title ?? metric.label;
  return {
    title,
    columns: ["metric", "value"],
    rows: [[metric.label, value]],
    chart_type: "bar",
    value_format: "number",
    asOf,
    source: sourceOf(metric.source),
    frameId: "z-gauge",
    options: { value, baseline, min, max, unit, segments: 9 },
  };
}

// ---------------------------------------------------------------------------
// bar-table — reuse the existing deterministic chart-from-metrics computation
// ---------------------------------------------------------------------------

function bindBarTable(output: BrainOutput, req: FrameBindRequest, asOf: string): ChartSpec | null {
  const block = computeMetricChart(output);
  if (!block) return null;
  return {
    ...block,
    title: req.title ?? block.title,
    asOf: block.asOf || asOf,
    frameId: "bar-table",
  };
}
