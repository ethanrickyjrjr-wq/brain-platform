// lib/social/chart-svg.ts
//
// Client-safe SVG chart helpers. Carved out of render-social-image.ts so the canvas
// composer can render the SAME chart shapes to an SVG (then load it as a Konva image)
// without importing @resvg/resvg-js. renderChart itself is import-safe (no native bin).
import { renderChart } from "@/lib/email/templates/charts/chart-renderer";
import type { EmailChartSpec } from "@/lib/email/templates/charts/chart-types";

/** XML-escape so any data-derived text is inert inside the SVG. */
export function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Crude single-line truncation so a long line never overruns the card. SVG
 * `<text>` does not wrap; callers ellipsize the tail or wrap explicitly.
 */
export function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

const SVG_OPEN_RE = /<svg\b[^>]*>/i;
const SVG_CLOSE_RE = /<\/svg\s*>/i;

/**
 * Pull the inner body out of a `renderChart` SVG so it can be re-parented under a
 * `<g transform>` inside the card. `renderChart` returns either a pure `<svg>`
 * (sparkline / gauge) wrapped in a `<div>`, or an HTML `<table>` (bar / stacked /
 * heat-row) which has no SVG to extract. Returns null when no `<svg>` is present.
 */
export function extractInnerSvg(
  html: string,
): { inner: string; width: number; height: number } | null {
  const open = html.match(SVG_OPEN_RE);
  if (!open) return null;
  const start = html.indexOf(open[0]);
  const closeMatch = html.match(SVG_CLOSE_RE);
  if (!closeMatch) return null;
  const closeIdx = html.lastIndexOf(closeMatch[0]);
  if (closeIdx < start) return null;
  const tag = open[0];
  const inner = html.slice(start + tag.length, closeIdx);
  const w = Number(tag.match(/\bwidth="(\d+(?:\.\d+)?)"/i)?.[1] ?? "0");
  const h = Number(tag.match(/\bheight="(\d+(?:\.\d+)?)"/i)?.[1] ?? "0");
  if (!w || !h) return null;
  return { inner, width: w, height: h };
}

/**
 * Draw a native SVG horizontal bar for chart types `renderChart` emits as HTML
 * tables (bar / stacked-bar / heat-row), which resvg cannot render. Keeps the
 * card chart-bearing without importing an HTML engine. Numbers are taken
 * verbatim from the spec — none invented.
 */
export function nativeBarSvg(
  spec: EmailChartSpec,
  width: number,
  accent: string,
  neutral: string,
): string {
  // Normalize the few shapes into {label, value}[] for a simple bar.
  let rows: Array<{ label: string; value: number }> = [];
  if (spec.type === "bar") {
    rows = spec.data.map((d) => ({ label: d.label, value: d.value }));
  } else if (spec.type === "stacked-bar") {
    rows = spec.segments.map((s) => ({ label: s.label, value: Math.max(0, s.value) }));
  } else if (spec.type === "heat-row") {
    rows = spec.rows.map((r) => ({
      label: r.label,
      value: r.cells.reduce((m, c) => Math.max(m, c.value), 0),
    }));
  }
  rows = rows.slice(0, 5);
  if (rows.length === 0) return "";

  const rowH = 44;
  const gap = 14;
  const labelW = Math.round(width * 0.34);
  const trackW = width - labelW - 90;
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;

  const parts = rows.map((r, i) => {
    const y = i * (rowH + gap);
    const barW = Math.max(2, Math.round((r.value / max) * trackW));
    return [
      `<text x="0" y="${y + rowH * 0.62}" font-size="22" fill="${esc(neutral)}">${esc(clip(r.label, 18))}</text>`,
      `<rect x="${labelW}" y="${y + rowH * 0.2}" width="${trackW}" height="${rowH * 0.6}" rx="6" fill="#E5E7EB"/>`,
      `<rect x="${labelW}" y="${y + rowH * 0.2}" width="${barW}" height="${rowH * 0.6}" rx="6" fill="${esc(accent)}"/>`,
      `<text x="${labelW + trackW + 12}" y="${y + rowH * 0.62}" font-size="22" font-weight="bold" fill="${esc(neutral)}">${esc(r.value)}</text>`,
    ].join("");
  });
  const totalH = rows.length * (rowH + gap);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH}" viewBox="0 0 ${width} ${totalH}">${parts.join("")}</svg>`;
}

/** Build the chart block as an SVG fragment placed at (x,y) with a target width. */
export function chartFragment(
  spec: EmailChartSpec,
  x: number,
  y: number,
  targetW: number,
  accent: string,
  neutral: string,
): { svg: string; height: number } {
  // sparkline / gauge → pure SVG from the shared renderer (brand accent carried in).
  const html = renderChart(spec, { accent, neutral, primary: accent });
  const extracted = extractInnerSvg(html);
  if (extracted) {
    const scale = targetW / extracted.width;
    const h = extracted.height * scale;
    return {
      svg: `<g transform="translate(${x},${y}) scale(${scale.toFixed(4)})">${extracted.inner}</g>`,
      height: h,
    };
  }
  // bar / stacked / heat-row (HTML table from renderChart) → native SVG bar.
  const bar = nativeBarSvg(spec, targetW, accent, neutral);
  if (!bar) return { svg: "", height: 0 };
  const inner = extractInnerSvg(bar);
  if (!inner) return { svg: "", height: 0 };
  return {
    svg: `<g transform="translate(${x},${y})">${inner.inner}</g>`,
    height: inner.height,
  };
}
