// reshape-chart-type.ts — the engine behind the Email Lab "pick your chart type"
// control. Given a routed ChartSpec (whatever shape the producer chose) and a
// user-requested type, re-emit the SAME real values under the target frame that
// chartSpecToEmailSvg already knows how to render (bar-table / donut-share /
// dot-plot / ranked-delta). Pure: no fetch, no I/O.
//
// MOAT: reshaping only RELABELS values already in the spec — it never invents a
// number. The single derived value (the dot-plot reference) is the mean of the
// points already on the chart, labeled "average". A target that needs data the
// source lacks (ranked needs a delta) falls back to bar — never a fabricated delta.

import type { ChartSpec } from "@/components/charts/registry/chart-spec";

export type ChartType = "bar" | "ranked" | "donut" | "dotplot";

/** The user-facing labels for the control (kept here so UI + engine share one list). */
export const CHART_TYPE_OPTIONS: { type: ChartType; label: string }[] = [
  { type: "bar", label: "Bar" },
  { type: "ranked", label: "Bar + change" },
  { type: "donut", label: "Donut / share" },
  { type: "dotplot", label: "Dot vs average" },
];

interface Pt {
  label: string;
  value: number;
  delta?: number;
}

/** Pull flat (label, value[, delta]) points out of whatever shape the spec carries. */
function extractPoints(spec: ChartSpec): Pt[] {
  const o = (spec.options ?? {}) as Record<string, unknown>;

  const items = o.items as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(items) && items.length) {
    return items
      .map((it) => ({
        label: String(it.label ?? ""),
        value: Number(it.value),
        delta: typeof it.delta === "number" ? (it.delta as number) : undefined,
      }))
      .filter((p) => Number.isFinite(p.value));
  }

  const segments = o.segments as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(segments) && segments.length) {
    return segments
      .map((s) => ({ label: String(s.label ?? ""), value: Number(s.value) }))
      .filter((p) => Number.isFinite(p.value));
  }

  const data = o.data as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(data) && data.length && "value" in data[0]) {
    return data
      .map((d) => ({ label: String(d.label ?? ""), value: Number(d.value) }))
      .filter((p) => Number.isFinite(p.value));
  }

  const rows = spec.rows as unknown[][] | undefined;
  if (Array.isArray(rows) && rows.length && Array.isArray(rows[0])) {
    const cols = spec.columns;
    const valIdx = Array.isArray(cols) && cols.length > 1 ? 1 : rows[0].length - 1;
    return rows
      .map((r) => ({ label: String(r[0] ?? ""), value: Number(r[valIdx]) }))
      .filter((p) => Number.isFinite(p.value));
  }

  return [];
}

/** Does this data actually support the requested shape? A donut/share is meaningful
 *  ONLY when the values are an additive parts-of-a-whole (counts) — summing medians,
 *  prices, rates, or indexes to a "total" is nonsense. Ranked-with-change needs a real
 *  delta. Bar and dot-vs-average fit any ≥2-point comparison. */
export function chartTypeFits(spec: ChartSpec, type: ChartType): boolean {
  const pts = extractPoints(spec);
  if (pts.length < 2) return false;
  switch (type) {
    case "donut":
      return spec.value_format === "count";
    case "ranked":
      return pts.some((p) => typeof p.delta === "number");
    case "bar":
    case "dotplot":
    default:
      return true;
  }
}

/** Is this a trend over time (a period axis)? Such data must NOT be force-fit into a
 *  categorical bar/donut — slicing it grabs arbitrary (often the OLDEST) points, which
 *  is how year-2000 values leaked onto a "current" chart. The trend's own renderer shows
 *  the recent window. Detected by frame, area type, or chronological YYYY/YYYY-MM labels. */
export function isTimeSeries(spec: ChartSpec): boolean {
  if (spec.chart_type === "area") return true;
  if (/zhvi|area|line-band|seasonal|timeline/i.test(spec.frameId ?? "")) return true;
  const pts = extractPoints(spec);
  return pts.length >= 2 && pts.every((p) => /^\d{4}(-\d{2})?$/.test(String(p.label).trim()));
}

export function reshapeChartToType(spec: ChartSpec, type: ChartType): ChartSpec {
  const pts = extractPoints(spec);
  // A single point can't become a bar/donut/dotplot meaningfully — leave it.
  if (pts.length < 2) return spec;
  // NO OLD DATA: never reshape a time series into a categorical shape (that slices the
  // oldest points). Keep the trend — its renderer shows the recent window.
  if (isTimeSeries(spec)) return spec;
  // GUARDRAIL: a requested shape the data can't honor (donut of medians, ranked
  // without a delta) falls back to a plain bar — never a misleading chart.
  if (type !== "bar" && !chartTypeFits(spec, type)) return reshapeChartToType(spec, "bar");

  const base = {
    title: spec.title,
    value_format: spec.value_format,
    asOf: spec.asOf,
    source: spec.source,
    theme: spec.theme,
  };
  const cols = spec.columns && spec.columns.length >= 2 ? spec.columns : ["Area", "Value"];

  switch (type) {
    case "ranked": {
      const deltaFormat =
        (spec.options as Record<string, unknown> | undefined)?.delta_format ?? "pct";
      return {
        ...base,
        columns: cols,
        rows: pts.map((p) => [p.label, p.value]),
        chart_type: "bar",
        frameId: "ranked-delta",
        options: {
          items: pts.map((p) => ({ label: p.label, value: p.value, delta: p.delta })),
          delta_format: deltaFormat,
        },
      } as ChartSpec;
    }
    case "donut":
      return {
        ...base,
        columns: cols,
        rows: pts.map((p) => [p.label, p.value]),
        chart_type: "table",
        frameId: "donut-share",
        options: {
          segments: pts.map((p) => ({ label: p.label, value: p.value })),
          valueFormat: spec.value_format,
        },
      } as ChartSpec;
    case "dotplot": {
      const avg = Math.round(pts.reduce((a, p) => a + p.value, 0) / pts.length);
      return {
        ...base,
        columns: cols,
        rows: pts.map((p) => [p.label, p.value]),
        chart_type: "scatter",
        frameId: "dot-plot",
        options: {
          data: pts.map((p) => ({ label: p.label, value: p.value, reference: avg })),
          referenceLabel: "average",
          valueLabel: typeof cols[1] === "string" ? cols[1] : "value",
        },
      } as ChartSpec;
    }
    case "bar":
    default:
      return {
        ...base,
        columns: cols,
        rows: pts.map((p) => [p.label, p.value]),
        chart_type: "bar",
        frameId: "bar-table",
      } as ChartSpec;
  }
}
