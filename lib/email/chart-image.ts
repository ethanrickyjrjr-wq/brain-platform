// lib/email/chart-image.ts
//
// The ONE email-safe chart path. crawl4ai (2026-06-25, caniemail + react.email):
// email clients strip inline <svg> and reject base64/data-URI images in Gmail —
// only a HOSTED .png/.jpg/.gif renders everywhere. So a chart for ANY of our email
// systems (block-canvas React-Email, token shells, drip) is: data → SVG → PNG
// (resvg, the render-social-image rasterizer) → uploaded to the public `email-media`
// bucket → a durable URL that drops into an <Img src>. This is the connector the
// chart renderer was missing — `renderChart` only ever produced inline SVG/HTML,
// which is exactly why it never worked in the builder's emails.
//
// Pure-ish: SVG generation is deterministic; only the upload touches I/O.

import { Resvg } from "@resvg/resvg-js";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { formatAxisTick, type ValueFormat } from "@/lib/charts/format";
import { formatAxisDateLabel, formatDisplayDate } from "@/lib/format-date";

const PUBLIC_BUCKET = "email-media";

export interface TrendPoint {
  label: string; // "2024-03" (month) or "2024-03-15" (day) — formatted on render
  value: number;
}

export interface TrendChartOpts {
  title: string;
  accent: string; // brand accent hex — the hero line + fill
  /** Structural brand-palette overrides; default to the house grid/axis greys. */
  grid?: string;
  axisText?: string;
  width?: number;
  height?: number;
  /** How y-ticks + the end label format. Default "usd". */
  valueFormat?: ValueFormat;
  /** Grain-aware title: zip → "34102 — Title"; city/undefined → "Title". */
  grain?: "zip" | "city";
  zip_code?: string;
  /** Caption under the chart: "{source} · as of MM/DD/YYYY". */
  source?: string;
  asOf?: string;
  /** Optional grey context line on the same x-domain (e.g. prior year). */
  compare?: TrendPoint[];
  /** Points at/after this index are a projection: dashed line + shaded band. */
  projectFromIndex?: number;
}

const GRID = "#EAECEF";
const AXIS_TEXT = "#6B7280";
const GREY_LINE = "#B6BDC6";

/** Email-safe trend chart as a self-contained SVG string (system fonts, explicit
 *  size) ready for resvg. Gridlines, area fill, four formatted x-labels, unit
 *  y-ticks (one currency/value root), grain-aware title, optional grey comparison
 *  line and a dashed projection band — the QUALITY-BAR look, not a bare polyline. */
export function trendChartSvg(points: TrendPoint[], opts: TrendChartOpts): string {
  const W = opts.width ?? 600;
  const H = opts.height ?? 300;
  const padL = 64,
    padR = 72,
    padT = 48,
    padB = 56;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const fmt: ValueFormat = opts.valueFormat ?? "usd";
  const n = points.length;
  const gridColor = opts.grid ?? GRID;
  const axisColor = opts.axisText ?? AXIS_TEXT;

  const allVals = [...points.map((p) => p.value), ...(opts.compare ?? []).map((p) => p.value)];
  const minY = Math.min(...allVals);
  const maxY = Math.max(...allVals);
  const span = maxY - minY || 1;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + (1 - (v - minY) / span) * innerH;
  const yBase = padT + innerH;

  // gridlines + unit-formatted y ticks (5 levels through the ONE value root)
  const grid: string[] = [];
  for (let k = 0; k <= 4; k++) {
    const gy = padT + (k / 4) * innerH;
    const gv = maxY - (k / 4) * span;
    grid.push(
      `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="${gridColor}" stroke-width="1"/>`,
    );
    grid.push(
      `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-family="Arial" font-size="11" fill="${axisColor}">${esc(formatAxisTick(fmt, gv))}</text>`,
    );
  }

  // area fill under the hero line
  const areaD =
    `M ${x(0).toFixed(1)},${y(points[0].value).toFixed(1)} ` +
    points.map((p, i) => `L ${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ") +
    ` L ${x(n - 1).toFixed(1)},${yBase.toFixed(1)} L ${x(0).toFixed(1)},${yBase.toFixed(1)} Z`;

  // hero line — solid, with an optional dashed projection tail + shaded band
  const lineAll = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const proj = opts.projectFromIndex;
  const hero: string[] = [];
  if (proj == null || proj <= 0 || proj >= n - 1) {
    hero.push(
      `<polyline points="${lineAll}" fill="none" stroke="${esc(opts.accent)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  } else {
    const solid = points
      .slice(0, proj + 1)
      .map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(" ");
    const dashed = points
      .slice(proj)
      .map((p, i) => `${x(proj + i).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(" ");
    hero.push(
      `<rect x="${x(proj).toFixed(1)}" y="${padT}" width="${(W - padR - x(proj)).toFixed(1)}" height="${innerH}" fill="${gridColor}" opacity="0.55"/>`,
      `<polyline points="${solid}" fill="none" stroke="${esc(opts.accent)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`,
      `<polyline points="${dashed}" fill="none" stroke="${esc(opts.accent)}" stroke-width="2.5" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  }

  // optional grey comparison line (same x-domain)
  const compareLine =
    opts.compare && opts.compare.length === n
      ? `<polyline points="${opts.compare
          .map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
          .join(
            " ",
          )}" fill="none" stroke="${GREY_LINE}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`
      : "";

  // four evenly-spaced, formatted x labels (one date root)
  const idxs = Array.from(
    new Set([0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1]),
  ).filter((i) => i >= 0 && i < n);
  const xLabels = idxs
    .map((i) => {
      const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
      return `<text x="${x(i).toFixed(1)}" y="${(yBase + 20).toFixed(1)}" text-anchor="${anchor}" font-family="Arial" font-size="11" fill="${axisColor}">${esc(formatAxisDateLabel(points[i].label))}</text>`;
    })
    .join("");

  // direct end-of-line label (the last value)
  const last = points[n - 1];
  const endLabel =
    `<circle cx="${x(n - 1).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="3.5" fill="${esc(opts.accent)}"/>` +
    `<text x="${(x(n - 1) + 6).toFixed(1)}" y="${(y(last.value) + 4).toFixed(1)}" font-family="Arial" font-size="12" font-weight="bold" fill="${esc(opts.accent)}">${esc(formatAxisTick(fmt, last.value))}</text>`;

  // grain-aware title + source/as-of caption
  const title =
    opts.grain === "zip" && opts.zip_code ? `${opts.zip_code} — ${opts.title}` : opts.title;
  const captionParts: string[] = [];
  if (opts.source) captionParts.push(opts.source);
  if (opts.asOf) captionParts.push(`as of ${formatDisplayDate(opts.asOf)}`);
  const caption = captionParts.length
    ? `<text x="${padL}" y="${(H - 12).toFixed(1)}" font-family="Arial" font-size="10" fill="${axisColor}">${esc(captionParts.join(" · "))}</text>`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text x="${padL}" y="28" font-family="Arial" font-size="15" font-weight="bold" fill="#1F2937">${esc(title)}</text>`,
    ...grid,
    `<path d="${areaD}" fill="${esc(opts.accent)}" fill-opacity="0.10" stroke="none"/>`,
    compareLine,
    ...hero,
    endLabel,
    xLabels,
    caption,
    `</svg>`,
  ].join("");
}

/** Email-safe HORIZONTAL bar chart as a self-contained SVG (resvg-rasterizable) —
 *  the static-image render of the registry's `bar-table` frame (the shape
 *  `computeMetricChart` emits for ANY chartable brain). Values formatted through the
 *  one currency/value root; capped to keep the email height sane. */
export function barChartSvg(
  bars: { label: string; value: number }[],
  opts: {
    title: string;
    accent: string;
    /** Per-bar brand palette (cycled). Omit → every bar uses `accent`. */
    series?: string[];
    /** Structural brand-palette overrides; default to the house grid/axis greys. */
    grid?: string;
    axisText?: string;
    valueFormat?: ValueFormat;
    source?: string;
    asOf?: string;
    width?: number;
  },
): string {
  const W = opts.width ?? 600;
  const gridColor = opts.grid ?? GRID;
  const axisColor = opts.axisText ?? AXIS_TEXT;
  const series = opts.series && opts.series.length ? opts.series : null;
  const rows = bars.slice(0, 8);
  const n = rows.length;
  const padL = 156,
    padR = 80,
    padT = 46,
    padB = 44;
  const rowH = 28;
  const H = padT + n * rowH + padB;
  const fmt: ValueFormat = opts.valueFormat ?? "usd";
  const trackW = W - padL - padR;
  const maxV = Math.max(...rows.map((b) => Math.abs(b.value)), 1);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text x="${padL}" y="28" font-family="Arial" font-size="15" font-weight="bold" fill="#1F2937">${esc(opts.title)}</text>`,
  ];
  rows.forEach((b, i) => {
    const cy = padT + i * rowH;
    const w = Math.max(2, Math.round((Math.abs(b.value) / maxV) * trackW));
    const label = b.label.length > 26 ? `${b.label.slice(0, 25)}…` : b.label;
    const barColor = series ? series[i % series.length] : opts.accent;
    parts.push(
      `<text x="${padL - 8}" y="${cy + 15}" text-anchor="end" font-family="Arial" font-size="12" fill="#374151">${esc(label)}</text>`,
      `<rect x="${padL}" y="${cy + 4}" width="${trackW}" height="16" rx="3" fill="${gridColor}"/>`,
      `<rect x="${padL}" y="${cy + 4}" width="${w}" height="16" rx="3" fill="${esc(barColor)}"/>`,
      `<text x="${padL + trackW + 8}" y="${cy + 16}" font-family="Arial" font-size="12" font-weight="bold" fill="#1F2937">${esc(formatAxisTick(fmt, b.value))}</text>`,
    );
  });
  const captionParts: string[] = [];
  if (opts.source) captionParts.push(opts.source);
  if (opts.asOf) captionParts.push(`as of ${formatDisplayDate(opts.asOf)}`);
  if (captionParts.length)
    parts.push(
      `<text x="${padL}" y="${H - 12}" font-family="Arial" font-size="10" fill="${axisColor}">${esc(captionParts.join(" · "))}</text>`,
    );
  parts.push(`</svg>`);
  return parts.join("");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Rasterize an email-safe SVG to PNG (resvg, system fonts + Arial fallback).
 *  `scale` rasterizes ABOVE the SVG's intrinsic size via resvg `fitTo` zoom — the
 *  display width stays logical (ImageBlock caps at 600px), so the default 2x = retina
 *  without any layout change. Pass `scale: 1` for an exact intrinsic-size raster. */
export function svgToPng(svg: string, opts?: { scale?: number; background?: string }): Buffer {
  const scale = opts?.scale ?? 2;
  return new Resvg(svg, {
    background: opts?.background ?? "rgba(255,255,255,1)",
    fitTo: { mode: "zoom", value: scale },
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  })
    .render()
    .asPng();
}

/**
 * Upload a PNG to the public `email-media` bucket and return its durable URL —
 * the same bucket the email-media route serves photos from. Idempotent on key
 * (upsert). Throws on a real storage error (the caller decides whether a chart is
 * load-bearing; a SNICKLEFRITZ build wants it, a generic build can skip).
 */
export async function hostEmailPng(pngKey: string, png: Buffer): Promise<string> {
  const admin = createServiceRoleClient();
  const { error } = await admin.storage
    .from(PUBLIC_BUCKET)
    .upload(pngKey, png, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`chart upload failed: ${error.message}`);
  const { data } = admin.storage.from(PUBLIC_BUCKET).getPublicUrl(pngKey);
  return data.publicUrl;
}

/** Full path: trend points → SVG → PNG → hosted public URL for an <Img src>. */
export async function buildTrendChartUrl(
  points: TrendPoint[],
  opts: TrendChartOpts & { key: string },
): Promise<string> {
  const svg = trendChartSvg(points, opts);
  const png = svgToPng(svg);
  return hostEmailPng(opts.key, png);
}
