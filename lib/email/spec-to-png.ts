// lib/email/spec-to-png.ts
//
// THE BRIDGE: a ChartSpec (the ONE chart contract that powers chat + /p decks via
// buildChartForQuestion / composeChartFromRequest / computeMetricChart) → a hosted
// PNG for email. The registry's React FrameRenderer can't run in email (clients
// strip JS/SVG), so email shares the SELECTION + DATA (the spec) and only the final
// RENDER branches here: spec → static SVG → resvg PNG → hosted email-media URL.
//
// Supported frames: bar-table (the generic any-brain bar, the dominant output) and
// time-series (zhvi-area). Anything else returns null → the build proceeds with no
// chart (best-effort, never blocks — RULE 0.7).

import type { ChartSpec } from "@/components/charts/registry/chart-spec";
import type { ValueFormat } from "@/lib/charts/format";
import {
  trendChartSvg,
  barChartSvg,
  svgToPng,
  hostEmailPng,
  type TrendPoint,
} from "@/lib/email/chart-image";
import { formatDisplayDate } from "@/lib/format-date";
import { rankedDeltaSvg } from "@/lib/charts/svg/ranked-delta";
import { donutShareSvg } from "@/lib/charts/svg/donut-share";
import { dotPlotSvg } from "@/lib/charts/svg/dot-plot";
import { sparkGridSvg } from "@/lib/charts/svg/spark-grid";
import { lineBandSvg } from "@/lib/charts/svg/line-band";

/** Map a ChartBlock value_format to the chart-image value root's ValueFormat. */
function mapValueFormat(vf?: string): ValueFormat {
  switch (vf) {
    case "usd":
    case "aal":
      return "usd";
    case "currency":
      return "rent";
    case "percent":
      return "pct";
    case "count":
      return "count";
    default:
      return "index"; // "number" / unset / unknown → unitless
  }
}

/** A zhvi-area (or any options.data) spec → trend points (first numeric series). */
function specToTrendPoints(spec: ChartSpec): TrendPoint[] | null {
  const data = (spec.options?.data as Record<string, unknown>[] | undefined) ?? undefined;
  if (!Array.isArray(data) || data.length < 2) return null;
  const sample = data[0];
  const labelKey = "month" in sample ? "month" : Object.keys(sample)[0];
  const valKey = Object.keys(sample).find((k) => k !== labelKey && typeof sample[k] === "number");
  if (!valKey) return null;
  const points = data
    .map((r) => ({ label: String(r[labelKey]), value: Number(r[valKey]) }))
    .filter((p) => Number.isFinite(p.value));
  return points.length >= 2 ? points : null;
}

/** A bar-table ChartBlock (columns + rows) → {label, value} bars. */
function specToBars(spec: ChartSpec): { label: string; value: number }[] | null {
  const rows = spec.rows as (string | number | null)[][] | undefined;
  if (!Array.isArray(rows) || !rows.length) return null;
  const valIdx = Array.isArray(spec.columns) && spec.columns.length > 1 ? 1 : rows[0].length - 1;
  const bars = rows
    .map((r) => ({ label: String(r[0] ?? ""), value: Number(r[valIdx]) }))
    .filter((b) => Number.isFinite(b.value));
  return bars.length ? bars : null;
}

export interface EmailChartImage {
  url: string;
  alt: string;
  caption: string;
}

/** ChartSpec → the email-safe SVG STRING (the dispatch only — no I/O). PURE and
 *  exported so the frame→builder routing is unit-testable without Supabase. Returns
 *  null for an unsupported frame or on any error (never throws). */
export function chartSpecToEmailSvg(spec: ChartSpec, accent: string): string | null {
  try {
    const title = spec.title || "Market data";
    const vf = mapValueFormat(spec.value_format);
    const baseOpts = {
      title,
      accent,
      valueFormat: vf,
      source: spec.source?.citation ?? undefined,
      asOf: spec.asOf ?? undefined,
    };
    const o = (spec.options ?? {}) as Record<string, unknown>;
    let svg: string | null = null;

    // Registry frames → their shared SVG builder (ONE renderer, web frame + email PNG).
    switch (spec.frameId) {
      case "ranked-delta":
        if (Array.isArray(o.items) && o.items.length)
          svg = rankedDeltaSvg(o.items as Parameters<typeof rankedDeltaSvg>[0], {
            ...baseOpts,
            // The chip renders the SOURCE's published change verbatim (a YoY % stays
            // a %), never a value re-derived into a different unit.
            deltaFormat:
              typeof o.delta_format === "string" ? (o.delta_format as ValueFormat) : undefined,
          });
        break;
      case "donut-share":
        if (Array.isArray(o.segments) && o.segments.length)
          svg = donutShareSvg(o.segments as Parameters<typeof donutShareSvg>[0], {
            ...baseOpts,
            total: typeof o.total === "number" ? o.total : undefined,
            unit: typeof o.unit === "string" ? o.unit : undefined,
          });
        break;
      case "dot-plot":
        if (Array.isArray(o.data) && o.data.length)
          svg = dotPlotSvg(o.data as Parameters<typeof dotPlotSvg>[0], {
            ...baseOpts,
            referenceLabel: typeof o.referenceLabel === "string" ? o.referenceLabel : undefined,
            valueLabel: typeof o.valueLabel === "string" ? o.valueLabel : undefined,
          });
        break;
      case "spark-grid":
        if (Array.isArray(o.cards) && o.cards.length)
          svg = sparkGridSvg(o.cards as Parameters<typeof sparkGridSvg>[0], baseOpts);
        break;
      case "line-band":
        if (Array.isArray(o.data) && o.data.length)
          svg = lineBandSvg(o.data as Parameters<typeof lineBandSvg>[0], baseOpts);
        break;
    }

    // Fallbacks: zhvi-area / any options.data time series, then bar-table.
    if (!svg && (spec.frameId === "zhvi-area" || spec.chart_type === "area")) {
      const pts = specToTrendPoints(spec);
      if (pts) svg = trendChartSvg(pts.slice(-18), baseOpts);
    }
    if (!svg) {
      const bars = specToBars(spec);
      if (bars) svg = barChartSvg(bars, baseOpts);
    }
    return svg;
  } catch {
    return null;
  }
}

/** The email image-block caption (the line shown UNDER the chart). Pure + exported so
 *  the Rule-2 date format is unit-tested without Supabase. Mirrors the SVG's own
 *  caption: "{title} — {source} · as of MM/DD/YYYY" — never the raw ISO/SWFL token. */
export function chartImageCaption(spec: {
  title?: string;
  source?: { citation?: string } | null;
  asOf?: string | null;
}): string {
  const title = spec.title || "Market data";
  const srcName = spec.source?.citation ?? "";
  const srcPart = srcName ? ` — ${srcName}` : "";
  const asOfPart = spec.asOf ? ` · as of ${formatDisplayDate(spec.asOf)}` : "";
  return `${title}${srcPart}${asOfPart}`;
}

/** ChartSpec → hosted PNG image spec for an EmailDoc image block. Returns null for
 *  unsupported frames or on any error — never throws (the build is never blocked). */
export async function chartSpecToEmailImage(
  spec: ChartSpec,
  accent: string,
  key: string,
): Promise<EmailChartImage | null> {
  const svg = chartSpecToEmailSvg(spec, accent);
  if (!svg) return null;
  try {
    const title = spec.title || "Market data";
    const png = svgToPng(svg);
    const url = await hostEmailPng(key, png);
    return { url, alt: title, caption: chartImageCaption(spec) };
  } catch {
    return null;
  }
}
