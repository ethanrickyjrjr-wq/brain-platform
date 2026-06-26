/**
 * Social image rasterizer — brain data + client brand → branded, watermarked PNG.
 *
 * ── FORK DECISION (build 02) ────────────────────────────────────────────────
 * Chosen: **option (b) — author the whole card as ONE SVG string, rasterize with
 * `@resvg/resvg-js`** (SVG → PNG `Buffer`). NOT Satori/`next/og`.
 *
 * Verified IN-SESSION against live vendor docs (RULE 1 — Vendor First):
 *  - `@resvg/resvg-js@2.6.2` — https://github.com/yisibl/resvg-js  (README, 2026-06-20).
 *    `new Resvg(svg, opts).render().asPng()` returns a Node `Buffer`; ships
 *    per-platform native binaries via napi (win32-x64-msvc verified locally,
 *    linux-x64-gnu resolves on Vercel). PNG dims come from the SVG's intrinsic
 *    width/height — no `fitTo` needed for exact platform sizes.
 *  - `next/og` `ImageResponse` — https://nextjs.org/docs/app/api-reference/functions/image-response
 *    + https://vercel.com/docs/og-image-generation (2026-06-20): it is a
 *    streaming `Response` subclass, documented ONLY for `return new ImageResponse(…)`
 *    out of a route handler. The cron worker (build 04) calls `renderSocialImage`
 *    DIRECTLY (not over HTTP) and needs a raw PNG `Buffer` — which `ImageResponse`
 *    does not cleanly yield from a plain Node function. resvg-js does, in BOTH a
 *    route handler and a Node script. (`@vercel/og` itself wraps Satori + resvg;
 *    we call resvg directly so we own the Buffer.)
 *  - Satori (https://github.com/vercel/satori, 2026-06-20) needs a mandatory font
 *    `ArrayBuffer` and cannot render inline `<svg>` (only `<img>` data-URIs).
 *    Authoring one SVG string sidesteps both: resvg renders real `<text>` with
 *    system fonts + a `defaultFontFamily` fallback, and the existing
 *    `renderChart` SVG (sparkline/gauge) inlines directly with no base64 round-trip.
 *
 * ── NO-INVENTION MOAT ───────────────────────────────────────────────────────
 * The renderer NEVER fabricates a number. A missing/empty stat value omits the
 * whole stat block — no "$0", no "N/A", no "—" placeholder literal ever reaches
 * the output. Every number on the card traces verbatim to the input model.
 */

import { Resvg } from "@resvg/resvg-js";
import { renderChart } from "@/lib/email/templates/charts/chart-renderer";
import type { EmailChartSpec } from "@/lib/email/templates/charts/chart-types";
import { resolveTheme, type BrandTheme } from "@/scripts/email/types";
import { asOfFromToken, asOfFromIso } from "@/lib/project/as-of";

// ── Formats ──────────────────────────────────────────────────────────────────
// Standard platform sizes (the spec's four). `social-practices.json` is not in
// the tree (only the crawl script), so we proceed with these per the build brief.
export const SOCIAL_FORMATS = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
} as const;

export type SocialFormat = keyof typeof SOCIAL_FORMATS;

export function isSocialFormat(v: unknown): v is SocialFormat {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SOCIAL_FORMATS, v);
}

// ── Input model ────────────────────────────────────────────────────────────
// Intentionally decoupled from refinery's `BrainOutput` (keeps `lib/` free of the
// refinery dependency graph) but structurally a subset of it: `stat` maps to one
// `BrainOutputMetric`, `as_of`/`source`/`freshness_token` are dossier provenance.

/** The ONE headline stat. `value` is shown VERBATIM — never coerced or defaulted. */
export interface SocialStat {
  label: string;
  /**
   * The already-formatted display value (e.g. "$412K", "10.1/1k", "+60 bps").
   * Number formatting happens upstream (deterministic math owns it). When this is
   * null/undefined/empty the stat block is OMITTED — the moat: no placeholder.
   */
  value: string | number | null | undefined;
  /** Optional sub-line under the value (e.g. "median sale price, 33908"). */
  caption?: string;
}

export interface SocialModel {
  /** Big headline line at the top of the card. */
  headline: string;
  /** The single highlighted stat. Omitted from the card if value is empty. */
  stat?: SocialStat;
  /** Optional chart — embedded as the email-safe SVG (sparkline/gauge) or a
   *  native SVG bar (bar/stacked/heat fall back to a drawn bar; see compose). */
  chart?: EmailChartSpec;
  /** Provenance — burned into the watermark. */
  as_of?: string;
  /** Source brain / dataset label for the watermark (e.g. "Lee County housing"). */
  source?: string;
  /** Optional freshness token (quoted small, bottom). */
  freshness_token?: string;
}

export interface RenderSocialImageArgs {
  model: SocialModel;
  /** Brand theme (colors + logo). Falls back to the SWFL house theme. */
  theme?: BrandTheme | null;
  format: SocialFormat;
  /**
   * Pre-fetched logo bytes. When omitted, `renderSocialImage` fetches
   * `theme.logoUrl` itself (cached). A fetch failure degrades gracefully (the
   * logo is simply absent — never a crash, never a placeholder).
   */
  logoBuffer?: Buffer | null;
  /** Override "now" for deterministic watermark dates in tests. */
  now?: Date;
}

const WATERMARK_BRAND = "SWFL Data Gulf";

// ── small SVG helpers ────────────────────────────────────────────────────────

/** XML-escape so any data-derived text is inert inside the SVG. */
function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** A stat value is "present" only if it is a finite number or a non-blank string. */
function hasStatValue(v: SocialStat["value"]): v is string | number {
  if (v == null) return false;
  if (typeof v === "number") return Number.isFinite(v);
  return v.trim().length > 0;
}

/**
 * Crude single-line truncation so a long line never overruns the card. SVG
 * `<text>` does not wrap; callers ellipsize the tail or wrap explicitly.
 */
function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/**
 * Greedy word-wrap into at most `maxLines` lines of ~`perLine` characters,
 * ellipsizing the final line. Approximate (SVG has no text metrics), but keeps a
 * long headline inside the card instead of overrunning the right edge.
 */
function wrapLines(s: string, perLine: number, maxLines: number): string[] {
  const words = s.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= perLine || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  // Remaining words (including the in-progress line) go on the last line.
  const consumed = lines.join(" ").split(/\s+/).filter(Boolean).length;
  const rest = words.slice(consumed).join(" ") || cur;
  if (lines.length < maxLines) lines.push(rest);
  if (lines.length === maxLines) lines[maxLines - 1] = clip(lines[maxLines - 1], perLine);
  return lines.filter(Boolean);
}

const SVG_OPEN_RE = /<svg\b[^>]*>/i;
const SVG_CLOSE_RE = /<\/svg\s*>/i;

/**
 * Pull the inner body out of a `renderChart` SVG so it can be re-parented under a
 * `<g transform>` inside the card. `renderChart` returns either a pure `<svg>`
 * (sparkline / gauge) wrapped in a `<div>`, or an HTML `<table>` (bar / stacked /
 * heat-row) which has no SVG to extract. Returns null when no `<svg>` is present.
 */
function extractInnerSvg(html: string): { inner: string; width: number; height: number } | null {
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
function nativeBarSvg(
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
function chartFragment(
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

// ── logo fetch (graceful) ─────────────────────────────────────────────────────

const logoCache = new Map<string, Buffer | null>();

/** Map common image extensions to a MIME type for the data URI. */
function mimeFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
  if (u.endsWith(".svg")) return "image/svg+xml";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".gif")) return "image/gif";
  return "image/png";
}

/**
 * Fetch a logo to a Buffer, caching by URL. ANY failure (network, non-2xx, abort)
 * resolves to `null` so the caller simply omits the logo — never a crash, never a
 * placeholder image. resvg cannot decode SVG inside `<image>` reliably, so an SVG
 * logo URL is skipped (returns null) rather than risking a broken render.
 */
export async function fetchLogo(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  if (logoCache.has(url)) return logoCache.get(url) ?? null;
  let result: Buffer | null = null;
  try {
    if (mimeFromUrl(url) === "image/svg+xml") {
      result = null; // raster-only inside <image>; skip vector logos safely.
    } else {
      const ctl = AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined;
      const res = await fetch(url, ctl ? { signal: ctl } : {});
      if (res.ok) {
        const ab = await res.arrayBuffer();
        result = Buffer.from(ab);
      }
    }
  } catch {
    result = null;
  }
  logoCache.set(url, result);
  return result;
}

/** TESTING ONLY: clear the module-level logo cache. */
export function _clearLogoCache(): void {
  logoCache.clear();
}

// ── card composition ──────────────────────────────────────────────────────────

/**
 * Compose the full card as one SVG string. Pure + deterministic given its inputs
 * (logo already fetched). Exported so tests can assert the watermark/contents on
 * the SVG source directly (independent of the PNG raster).
 */
export function composeCardSvg(args: {
  model: SocialModel;
  theme?: BrandTheme | null;
  format: SocialFormat;
  logoBuffer?: Buffer | null;
  now?: Date;
}): string {
  const { width, height } = SOCIAL_FORMATS[args.format];
  const t = resolveTheme(args.theme);
  const primary = t.primary;
  const accent = t.accent;
  const neutral = "#9CA3AF";
  const onDark = "#FFFFFF";
  const pad = Math.round(width * 0.07);
  const innerW = width - pad * 2;

  const layers: string[] = [];

  // Background — brand primary.
  layers.push(`<rect width="${width}" height="${height}" fill="${esc(primary)}"/>`);
  // Accent rule at the top.
  layers.push(
    `<rect x="${pad}" y="${pad}" width="${Math.round(innerW * 0.18)}" height="8" rx="4" fill="${esc(accent)}"/>`,
  );

  let cursorY = pad + 40;

  // Logo (top-right) — only if we actually have bytes. No bytes → nothing drawn.
  if (args.logoBuffer && args.logoBuffer.length > 0) {
    const logoH = Math.round(height * 0.06);
    const logoW = Math.round(logoH * 3); // bounded box; preserveAspectRatio fits.
    const mime = "image/png"; // fetchLogo only returns raster bytes.
    const b64 = args.logoBuffer.toString("base64");
    layers.push(
      `<image x="${width - pad - logoW}" y="${pad}" width="${logoW}" height="${logoH}" ` +
        `preserveAspectRatio="xMaxYMid meet" href="data:${mime};base64,${b64}"/>`,
    );
  }

  // Headline — wrap to ≤2 lines so a long title stays inside the card.
  const headlineSize = Math.round(width * 0.054);
  // Bold Arial averages ~0.55em/char; budget chars to the inner width.
  const perLine = Math.max(8, Math.floor(innerW / (headlineSize * 0.55)));
  const headlineLines = wrapLines(args.model.headline ?? "", perLine, 2);
  const lineGap = Math.round(headlineSize * 1.12);
  headlineLines.forEach((line, i) => {
    layers.push(
      `<text x="${pad}" y="${cursorY + headlineSize + i * lineGap}" font-size="${headlineSize}" font-weight="bold" ` +
        `fill="${esc(onDark)}" font-family="Arial, Helvetica, sans-serif">${esc(line)}</text>`,
    );
  });
  cursorY += headlineSize + (headlineLines.length - 1) * lineGap + Math.round(height * 0.05);

  // The ONE stat — OMITTED entirely when value is missing (no placeholder = moat).
  const stat = args.model.stat;
  if (stat && hasStatValue(stat.value)) {
    const valueSize = Math.round(width * 0.12);
    layers.push(
      `<text x="${pad}" y="${cursorY + valueSize}" font-size="${valueSize}" font-weight="bold" ` +
        `fill="${esc(accent)}" font-family="Arial, Helvetica, sans-serif">${esc(stat.value)}</text>`,
    );
    cursorY += valueSize + 12;
    const labelSize = Math.round(width * 0.03);
    layers.push(
      `<text x="${pad}" y="${cursorY + labelSize}" font-size="${labelSize}" ` +
        `fill="${esc(onDark)}" font-family="Arial, Helvetica, sans-serif">${esc(clip(stat.label ?? "", 48))}</text>`,
    );
    cursorY += labelSize + 8;
    if (stat.caption && stat.caption.trim()) {
      const capSize = Math.round(width * 0.022);
      layers.push(
        `<text x="${pad}" y="${cursorY + capSize}" font-size="${capSize}" ` +
          `fill="${esc(neutral)}" font-family="Arial, Helvetica, sans-serif">${esc(clip(stat.caption, 56))}</text>`,
      );
      cursorY += capSize + 10;
    }
    cursorY += Math.round(height * 0.03);
  }

  // Chart — only if a spec was provided and it produces drawable SVG.
  if (args.model.chart) {
    const targetW = Math.min(innerW, Math.round(width * 0.7));
    const frag = chartFragment(args.model.chart, pad, cursorY, targetW, accent, onDark);
    if (frag.svg) {
      layers.push(frag.svg);
      cursorY += frag.height + Math.round(height * 0.02);
    }
  }

  // ── Burned-in watermark — MANDATORY. Survives screenshot / re-share. ──
  const now = args.now ?? new Date();
  const asOf = args.model.as_of && args.model.as_of.trim() ? args.model.as_of.trim() : isoDate(now);
  // Rule 5 (CLEAN): DISPLAY the as-of as MM/DD/YYYY — never the backwards ISO
  // slice. Mirrors the freshness line's `asOfFromToken` below; `model.as_of`
  // stays YYYY-MM-DD (stored shape unchanged). Falls back to the raw string when
  // it isn't a parseable ISO date (e.g. already MM/DD/YYYY passes through).
  const asOfDisplay = asOfFromIso(asOf) ?? asOf;
  const wmSize = Math.round(width * 0.024);
  const wmY = height - pad;
  // Top line: brand • as of {date} [+ source brain].
  const sourcePart =
    args.model.source && args.model.source.trim() ? ` • ${args.model.source.trim()}` : "";
  const watermark = `${WATERMARK_BRAND} • as of ${asOfDisplay}${sourcePart}`;
  layers.push(
    `<rect x="0" y="${height - pad * 1.4}" width="${width}" height="${pad * 1.4}" fill="${esc(primary)}" opacity="0.0"/>`,
  );
  layers.push(
    `<text x="${pad}" y="${wmY - wmSize}" font-size="${wmSize}" fill="${esc(onDark)}" ` +
      `opacity="0.85" font-family="Arial, Helvetica, sans-serif">${esc(clip(watermark, 80))}</text>`,
  );
  // Optional freshness date, smaller, beneath. PUBLIC card → cleaned MM/DD/YYYY
  // only; the raw internal SWFL-… token must NEVER paint onto a share image.
  const freshnessAsOf = asOfFromToken(args.model.freshness_token);
  if (freshnessAsOf) {
    const ftSize = Math.round(width * 0.018);
    layers.push(
      `<text x="${pad}" y="${wmY}" font-size="${ftSize}" fill="${esc(neutral)}" ` +
        `font-family="Arial, Helvetica, sans-serif">${esc(freshnessAsOf)}</text>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">${layers.join("")}</svg>`
  );
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── public entry ──────────────────────────────────────────────────────────────

/**
 * Render a branded, watermarked social card to a PNG `Buffer` at the requested
 * platform format. Works identically in a Next.js route handler AND when called
 * directly from a Node script (the cron worker). Logo is pre-fetched (graceful on
 * failure); the watermark is burned in; no number is ever fabricated.
 */
export async function renderSocialImage(args: RenderSocialImageArgs): Promise<Buffer> {
  if (!isSocialFormat(args.format)) {
    throw new Error(`Unknown social format: ${String(args.format)}`);
  }
  // Resolve the logo: caller-supplied bytes win; else fetch from the theme URL.
  let logoBuffer = args.logoBuffer ?? null;
  if (!logoBuffer && args.theme?.logoUrl) {
    logoBuffer = await fetchLogo(args.theme.logoUrl);
  }

  const svg = composeCardSvg({
    model: args.model,
    theme: args.theme,
    format: args.format,
    logoBuffer,
    now: args.now,
  });

  // Intrinsic SVG size already equals the target format → no fitTo needed; resvg
  // renders at exactly width×height. System fonts + Arial fallback for <text>.
  const resvg = new Resvg(svg, {
    background: "rgba(255,255,255,0)",
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  });
  return resvg.render().asPng();
}
