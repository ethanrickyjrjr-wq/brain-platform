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

const PUBLIC_BUCKET = "email-media";

export interface TrendPoint {
  label: string; // x label, e.g. "2024-03"
  value: number;
}

export interface TrendChartOpts {
  title: string;
  accent: string; // brand accent hex — the line color
  width?: number;
  height?: number;
}

/** A standalone, email-safe line chart as a self-contained SVG string (no external
 *  fonts, explicit width/height) — ready for resvg rasterization. */
export function trendChartSvg(points: TrendPoint[], opts: TrendChartOpts): string {
  const W = opts.width ?? 600;
  const H = opts.height ?? 240;
  const padL = 64,
    padR = 20,
    padT = 44,
    padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = points.length;
  const ys = points.map((p) => p.value);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY || 1;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + (1 - (v - minY) / span) * innerH;
  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const usdK = (v: number) => `$${Math.round(v / 1000)}K`;
  const first = points[0];
  const last = points[n - 1];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text x="${padL}" y="26" font-family="Arial" font-size="15" font-weight="bold" fill="#222222">${esc(opts.title)}</text>`,
    `<line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="#E5E7EB" stroke-width="1"/>`,
    `<text x="${padL - 8}" y="${(y(maxY) + 4).toFixed(1)}" text-anchor="end" font-family="Arial" font-size="11" fill="#888888">${usdK(maxY)}</text>`,
    `<text x="${padL - 8}" y="${(y(minY) + 4).toFixed(1)}" text-anchor="end" font-family="Arial" font-size="11" fill="#888888">${usdK(minY)}</text>`,
    `<polyline points="${pts}" fill="none" stroke="${esc(opts.accent)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`,
    `<circle cx="${x(n - 1).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="4" fill="${esc(opts.accent)}"/>`,
    `<text x="${padL}" y="${H - 12}" font-family="Arial" font-size="11" fill="#888888">${esc(first.label)}</text>`,
    `<text x="${W - padR}" y="${H - 12}" text-anchor="end" font-family="Arial" font-size="11" fill="#888888">${esc(last.label)}</text>`,
    `<text x="${x(n - 1).toFixed(1)}" y="${(y(last.value) - 10).toFixed(1)}" text-anchor="end" font-family="Arial" font-size="12" font-weight="bold" fill="${esc(opts.accent)}">${usdK(last.value)}</text>`,
    `</svg>`,
  ].join("");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Rasterize an email-safe SVG to PNG (resvg, system fonts + Arial fallback). */
export function svgToPng(svg: string): Buffer {
  return new Resvg(svg, {
    background: "rgba(255,255,255,1)",
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
