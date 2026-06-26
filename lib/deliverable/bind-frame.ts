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
  BrainOutputDetailTable,
} from "../../refinery/types/brain-output.mts";
import {
  computeMetricChart,
  numericQualifyingColumns,
  isDateColumn,
  isDeltaColumn,
  isTimeSeriesTable,
} from "../../refinery/lib/chart-from-metrics.mts";
import { bindRankedDeltaSpec } from "./ranked-delta-bind";
import { pickFramesForData } from "../../components/charts/registry/pick-frames";
import { isFixtureOnly, getFrame } from "../../components/charts/registry/registry";
import type { ChartBlock } from "../../refinery/validate/chart-block-lint.mts";
import type { ChartSpec, ChartTheme } from "../../components/charts/registry/chart-spec";
// Type-only imports of each frame's exact `spec.options` payload shape, so the
// row→options mapping below is compile-checked against what the frame reads.
// (Erased at build — no client component is pulled into this pure lib.)
import type { TimelineEvent } from "../../components/charts/registry/frames/TimelineFrame";
import type { SeasonalRadialEntry } from "../../types/viz";

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

// Three distinct, non-overlapping reasons a frame yields no live ChartSpec —
// kept separate so none becomes a second hardcoded list:
//   1. fixtureOnly (FrameDef.fixtureOnly, the SINGLE registry gate read here):
//      the frame's data is not yet in any brain's --- OUTPUT --- thin pipe
//      (seasonal-radial until its emitting pack lands) →
//      bindFrameSpec returns null at the gate, caller drops. A later PR flips the
//      flag in the SAME commit as the pack that emits the table (brain-first).
//   2. not-yet-implemented: a live-bindable frame this binder has no `case` for
//      (zhvi-area, corridor-scatter) → `buildFrame`'s switch default returns
//      null. A property of the code below, not an exclusion list.
//   3. table-absent: a detail_tables-driven frame whose `buildFrame` case exists
//      but the brain hasn't emitted the named table yet (storm-timeline before
//      env-swfl emits `storm_timeline`) → the binder returns null. The case is
//      live; it just has no data. NEVER substitute a different geometry.

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

/**
 * Numeric coercion for a detail_table cell. Unlike `num`, a `null`/`undefined`/
 * `boolean` cell stays `null` (never coerced to 0 — `Number(null)` is 0, which
 * would silently turn an absent paid total or an unassessable survival rate into
 * a real-looking zero). Only a finite number or numeric string yields a number.
 */
function cellNum(v: number | string | boolean | null | undefined): number | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
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
    case "storm-timeline":
      return bindStormTimeline(output, req, asOf);
    case "seasonal-radial":
      return bindSeasonalRadial(output, req, asOf);
    // ── 2026-06-26 SVG frames (one builder shared by web frame + email PNG) ──
    case "ranked-delta":
      // Registry-free root, shared with the conversation producer's auto-upgrade.
      return bindRankedDeltaSpec(output, { title: req.title });
    case "donut-share":
      return bindDonutShare(output, req, asOf);
    case "dot-plot":
      return bindDotPlot(output, req, asOf);
    case "spark-grid":
      return bindSparkGrid(output, req, asOf);
    case "line-band":
      return bindLineBand(output, req, asOf);
    default:
      return null;
  }
}

/**
 * blockToSpec — the ChartBlock → ChartSpec adapter for the PRE-COMPUTED path.
 *
 * `computeMetricChart` persists a deterministic bar `ChartBlock` (stamped with
 * `frame_id: "bar-table"`) into the brain `.md`. To render that block through the
 * frame registry (`FrameRenderer`), it must first become a `ChartSpec`. This is
 * that one-line lift: `{ ...block, frameId }`, plus optional brand `theme` and a
 * `compact` sizing hint.
 *
 * SCOPE: `bar-table` only — and deliberately so. The pre-computed path is
 * bar-only (`chart-from-metrics.mts` emits nothing else), so no persisted block
 * is ever a time-series or a relationship. The rich frames that wrap a raw-array
 * component (`zhvi-area`, `corridor-scatter`) are fed `options.data` DIRECTLY by
 * their producer (`buildChartForIntent`, `bindFrameSpec`) — there is no faithful,
 * lossless way to reconstruct their typed payload from flat columns, so this
 * adapter refuses to try. A non-bar `frame_id` reaching here is a contract bug,
 * not a render path — hence the loud throw.
 *
 * FAIL MODE (build contract): throws on a missing/unknown/unsupported `frame_id`.
 * Refinery-time callers let it throw (hard fail); the live dock wraps the render
 * in a boundary that degrades to `<ChartUnavailable>` instead of crashing.
 */
export function blockToSpec(block: ChartBlock, theme?: ChartTheme, compact?: boolean): ChartSpec {
  const frameId = block.frame_id;
  if (!frameId) {
    throw new Error("blockToSpec: frame_id is required");
  }
  if (!getFrame(frameId)) {
    throw new Error(`blockToSpec: unknown frame_id '${frameId}' (not in CHART_REGISTRY)`);
  }
  if (frameId !== "bar-table") {
    throw new Error(
      `blockToSpec: frame '${frameId}' has no ChartBlock→ChartSpec normalizer. ` +
        `Frames wrapping a raw-array component (zhvi-area, corridor-scatter, …) are built ` +
        `with options.data by their producer, never reconstructed from flat columns.`,
    );
  }
  const spec: ChartSpec = { ...block, frameId };
  if (theme) spec.theme = theme;
  if (compact !== undefined) spec.compact = compact;
  return spec;
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

  // Auto pre-check: prefer ranked-delta when a cross-sectional table carries a
  // value column paired with its OWN period-over-period delta (home_value_zhvi +
  // value_yoy_pct, …). A strict upgrade over a plain bar — the same bars plus a
  // ▲/▼ chip — and the only one of the new frames with a data-shape signal the
  // brains actually emit. The pairing guard (shared token stem, no date axis) keeps
  // it from firing on a time series or mispairing a delta to an unrelated metric.
  const ranked = bindRankedDeltaSpec(output, { title: req.title });
  if (ranked) return ranked;

  // Else bind EXACTLY what the picker selects (it already drops fixture-only frames
  // via the same flag). If this binder hasn't implemented the picked frame (e.g.
  // zhvi-area's time series, corridor-scatter's 2-var relationship), return null so
  // the caller DROPS it — never substitute a different geometry. bar/table paints
  // only when the picker itself chose ranked-categories; showing a time series or a
  // relationship as bars would misrepresent the data on /p.
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

// ---------------------------------------------------------------------------
// detail_tables-driven frames (Phase L0)
// ---------------------------------------------------------------------------
//
// Two frames render PER-ROW data the thin pipe carries only as a
// `detail_table` (never as a flat key_metric): storm-timeline and
// seasonal-radial. Each binder finds its named table in `output.detail_tables`,
// maps `rows`/`columns` into the frame's exact `spec.options` payload, stamps
// `asOf` from `refined_at`, and carries `source` verbatim from the table. Absent
// or empty table → null (caller drops the exhibit; never substitute geometry).
//
// COLUMN CONTRACT each emitting pack (Tasks L1–L3) must produce — this is the
// authoritative input to those tasks; the frame adapters consume these cell ids
// with NO remap:
//
//   storm_timeline       grain "storm"     row.key/label = storm name
//     cells: year         (count)    INTEGER calendar year of landfall
//            paid_usd      (currency) per-storm NFIP paid total (B+C+ICO)
//            date          (optional) ISO YYYY-MM-DD landfall date; when present
//                          it overrides the year-synthesized date for ordering.
//
//
//   corridor_seasonality grain "corridor"  row.key/label = corridor name
//     cells: seasonal_index (ratio 0–1; 0 = no seasonality, 1 = extreme)
//
// fixtureOnly gate: seasonal-radial stays `fixtureOnly:true` in the registry
// until its pack lands, so `bindFrameSpec({frame_id})` returns null at the gate
// even though the case below exists. L3 flips the flag in the SAME PR as the emit
// (brain-first). storm-timeline is already `fixtureOnly:false` → its case is live
// the moment env-swfl emits `storm_timeline`.

/** Find a named detail_table, or undefined. */
function findDetailTable(output: BrainOutput, tableId: string): BrainOutputDetailTable | undefined {
  return output.detail_tables?.find((t) => t.id === tableId);
}

/** Build a per-storm timeline from a `storm_timeline` detail_table. */
function bindStormTimeline(
  output: BrainOutput,
  req: FrameBindRequest,
  asOf: string,
): ChartSpec | null {
  const table = findDetailTable(output, "storm_timeline");
  if (!table || table.rows.length === 0) return null;

  const events: TimelineEvent[] = [];
  for (const r of table.rows) {
    const amount = cellNum(r.cells.paid_usd);
    if (amount === null) continue; // a storm with no paid total → omit, don't crash
    // Prefer an explicit ISO landfall date; else anchor the year for ordering.
    const cellDate = r.cells.date;
    const year = cellNum(r.cells.year);
    const date =
      typeof cellDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cellDate)
        ? cellDate
        : year !== null
          ? `${year}-01-01`
          : null;
    if (date === null) continue;
    events.push({ label: r.label, date, amount_usd: amount });
  }
  if (events.length === 0) return null;

  return {
    title: req.title ?? table.title,
    columns: ["storm", "paid_usd"],
    rows: events.map((e) => [e.label, e.amount_usd]),
    chart_type: "bar",
    value_format: "usd",
    asOf,
    source: sourceOf(table.source),
    frameId: "storm-timeline",
    options: { events },
  };
}

/** Build per-corridor seasonality rings from a `corridor_seasonality` table. */
function bindSeasonalRadial(
  output: BrainOutput,
  req: FrameBindRequest,
  asOf: string,
): ChartSpec | null {
  const table = findDetailTable(output, "corridor_seasonality");
  if (!table || table.rows.length === 0) return null;

  const data: SeasonalRadialEntry[] = [];
  for (const r of table.rows) {
    const idx = cellNum(r.cells.seasonal_index);
    if (idx === null) continue;
    data.push({ corridor: r.label, seasonal_index: idx });
  }
  if (data.length === 0) return null;

  return {
    title: req.title ?? table.title,
    columns: ["corridor", "seasonal_index"],
    rows: data.map((d) => [d.corridor, d.seasonal_index]),
    chart_type: "bar",
    value_format: "number",
    asOf,
    source: sourceOf(table.source),
    frameId: "seasonal-radial",
    options: { data },
  };
}

// ---------------------------------------------------------------------------
// 2026-06-26 SVG frames — explicit-request binders (donut-share / dot-plot /
// line-band / spark-grid). These have NO auto-pick rung: the brains don't emit a
// data-shape signal that beats the existing default (a share metric set, a
// reference column, confidence bounds, or per-metric series), so auto-firing them
// would invent the selection. They bind on an EXPLICIT `frame_id` request — the
// Email Lab design surface or a future AI chooser names the frame; this maps live
// brain data into it. ranked-delta is the exception (it has a real signal) and
// lives in `ranked-delta-bind.ts`, reached by its own `buildFrame` case.
// ---------------------------------------------------------------------------

/** ChartBlock value_format + the frame-vocab ValueFormat its SVG builder reads,
 *  in lock-step with the email bridge's `mapValueFormat` (web frame == PNG). */
function frameValueFormat(fmt: BrainOutputMetric["display_format"]): {
  block: "usd" | "percent" | "count" | "number";
  frame: "usd" | "pct" | "count" | "index";
} {
  switch (fmt) {
    case "currency":
      return { block: "usd", frame: "usd" };
    case "percent":
      return { block: "percent", frame: "pct" };
    case "count":
      return { block: "count", frame: "count" };
    default:
      return { block: "number", frame: "index" };
  }
}

/** First cross-sectional table + its first non-delta numeric column (the level a
 *  comparison plots), or null. Shared by dot-plot. */
function firstLevelColumn(
  output: BrainOutput,
): { table: BrainOutputDetailTable; col: BrainOutputDetailTable["columns"][number] } | null {
  for (const t of output.detail_tables ?? []) {
    if (isTimeSeriesTable(t)) continue;
    const qualifying = new Set(numericQualifyingColumns(t).map((c) => c.id));
    const col = t.columns.find((c) => qualifying.has(c.id) && !isDeltaColumn(c));
    if (col) return { table: t, col };
  }
  return null;
}

/** donut-share — parts-of-a-whole from share metrics (the composition shape, drawn
 *  as a donut). Needs >= 2 slices; adds an honest complement if they undershoot. */
function bindDonutShare(
  output: BrainOutput,
  req: FrameBindRequest,
  asOf: string,
): ChartSpec | null {
  const slugs = req.metric_keys?.length ? req.metric_keys : autoShareSlugs(output);
  const metrics = slugs
    .map((s) => metricBySlug(output, s))
    .filter((m): m is BrainOutputMetric => Boolean(m));
  if (metrics.length < 2) return null;

  const segments = metrics
    .map((m) => {
      const v = num(m.value);
      const value = v === null ? 0 : Math.abs(v) <= 1 ? round2(v * 100) : round2(v);
      return { label: m.label, value };
    })
    .filter((s) => s.value > 0);
  if (segments.length < 2) return null;

  const sum = segments.reduce((a, s) => a + s.value, 0);
  if (sum < 99.5) segments.push({ label: "Remaining", value: round2(100 - sum) });

  return {
    title: req.title ?? `${metrics[0].label} — share`,
    columns: ["segment", "share_pct"],
    rows: segments.map((s) => [s.label, s.value]),
    chart_type: "bar",
    value_format: "percent",
    asOf,
    source: sourceOf(metrics[0].source),
    frameId: "donut-share",
    options: { segments, total: 100, unit: "%", valueFormat: "pct" },
  };
}

/** dot-plot — each place vs a shared reference. The reference is the MEDIAN of the
 *  plotted column (a derived comparison from the same audited values, not invented):
 *  "where each ZIP sits against the middle." */
function bindDotPlot(output: BrainOutput, req: FrameBindRequest, asOf: string): ChartSpec | null {
  const hit = firstLevelColumn(output);
  if (!hit) return null;
  const { table, col } = hit;

  const pts = table.rows
    .map((r) => ({ label: r.label || r.key, value: cellNum(r.cells[col.id]) }))
    .filter((p): p is { label: string; value: number } => p.value !== null);
  if (pts.length < 3) return null;

  const sorted = pts.map((p) => p.value).sort((a, b) => a - b);
  const reference = sorted[Math.floor(sorted.length / 2)]; // median
  const vf = frameValueFormat(col.display_format);
  const data = pts
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map((p) => ({ label: p.label, value: p.value, reference }));

  return {
    // Synthesized title (never inherit table.title — it can carry an ISO date).
    title: req.title ?? `${col.label} vs median`,
    columns: [col.label, col.label],
    rows: data.map((d) => [d.label, d.value]),
    chart_type: "bar",
    value_format: vf.block,
    asOf,
    source: sourceOf(table.source),
    frameId: "dot-plot",
    options: { data, valueFormat: vf.frame, referenceLabel: "median" },
  };
}

/** line-band — a time series with an optional confidence band. The brains emit no
 *  lo/hi bounds yet, so this binds the line; the shaded band appears the moment a
 *  brain emits `lo`/`hi` columns (NEVER synthesize bounds — that invents the
 *  uncertainty). Reached only on an explicit request. */
function bindLineBand(output: BrainOutput, req: FrameBindRequest, asOf: string): ChartSpec | null {
  for (const t of output.detail_tables ?? []) {
    if (!isTimeSeriesTable(t)) continue;
    const dateCol = t.columns.find((c) => isDateColumn(c.id));
    const qualifying = new Set(numericQualifyingColumns(t).map((c) => c.id));
    const valCol = t.columns.find((c) => qualifying.has(c.id) && !isDeltaColumn(c));
    if (!dateCol || !valCol) continue;

    const points = t.rows
      .map((r) => {
        const value = cellNum(r.cells[valCol.id]);
        const label = r.cells[dateCol.id];
        return value !== null && (typeof label === "string" || typeof label === "number")
          ? { label: String(label), value }
          : null;
      })
      .filter((p): p is { label: string; value: number } => p !== null);
    if (points.length < 3) continue;

    const vf = frameValueFormat(valCol.display_format);
    return {
      // Synthesized title (never inherit t.title — it can carry an ISO date).
      title: req.title ?? `${valCol.label} trend`,
      columns: [dateCol.label, valCol.label],
      rows: points.map((p) => [p.label, p.value]),
      chart_type: "area",
      value_format: vf.block,
      asOf,
      source: sourceOf(t.source),
      frameId: "line-band",
      options: { data: points, valueFormat: vf.frame },
    };
  }
  return null;
}

/** spark-grid — a row of KPI cards, each a big value + its own mini trend. No brain
 *  emits that shape today (several metrics each carrying a series), so this returns
 *  null until one does — the case is live, it just has no data (mirrors
 *  storm-timeline before env-swfl emitted `storm_timeline`). NEVER fabricate a
 *  series. */
function bindSparkGrid(
  _output: BrainOutput,
  _req: FrameBindRequest,
  _asOf: string,
): ChartSpec | null {
  return null;
}

/**
 * Bind a detail_tables-driven frame DIRECTLY, bypassing the `fixtureOnly`
 * registry gate that `bindFrameSpec` applies. Public so the per-frame column
 * contract can be proven (in tests, and by L2/L3) BEFORE those frames flip
 * `fixtureOnly → false`. Production rendering still goes through `bindFrameSpec`,
 * which keeps the gate. Returns null for a non-table frame or a missing table.
 */
export function bindDetailTableFrame(
  output: BrainOutput,
  frameId: string,
  req: FrameBindRequest = {},
): ChartSpec | null {
  const asOf = asOfOf(output);
  if (!asOf) return null;
  switch (frameId) {
    case "storm-timeline":
      return bindStormTimeline(output, req, asOf);
    case "seasonal-radial":
      return bindSeasonalRadial(output, req, asOf);
    default:
      return null;
  }
}
