// lib/charts/svg/dot-plot.ts
//
// PURE SVG BUILDER — no React, no DOM, no I/O. Returns a self-contained,
// email-safe <svg> STRING (system fonts only, no <script>/<style>/<canvas>,
// ≤600px). The React DotPlotFrame wraps this string; the email PNG path
// (lib/email/spec-to-png.ts) rasterizes the SAME string. One function, two
// surfaces — never fork the renderer.
//
// SHAPE: dot-plot / comparison. Each row is "this place vs a reference": a label,
// a faint baseline rule, a grey dot at the reference (if present) and an accent
// dot at the value, with the formatted value at the end. A shared horizontal
// scale spans the min..max of every value + reference so rows are comparable.
//
// Style copied verbatim from lib/email/chart-image.ts: W/H/pad geometry, the
// GRID / AXIS_TEXT palette, the esc() helper, formatAxisTick(fmt,v) for numbers,
// formatDisplayDate(s) for the as-of caption.

import { formatAxisTick, type ValueFormat } from "@/lib/charts/format";
import { formatDisplayDate } from "@/lib/format-date";

const GRID = "#EAECEF";
const AXIS_TEXT = "#6B7280";
const REF_DOT = "#B6BDC6"; // grey reference dot (matches GREY_LINE family)

export interface DotPlotItem {
  label: string;
  value: number;
  /** Optional comparison point (prior year, benchmark, region). */
  reference?: number;
}

export interface DotPlotOpts {
  title: string;
  accent: string; // brand accent hex — the value dot + end label
  /** How the end value + axis ticks format. Default "usd". */
  valueFormat?: ValueFormat;
  /** Legend name for the grey reference dot. Default "reference". */
  referenceLabel?: string;
  /** Legend name for the accent value dot. Default "value" (was the cryptic "this"). */
  valueLabel?: string;
  /** Caption under the chart: "{source} · as of MM/DD/YYYY". */
  source?: string;
  asOf?: string;
  width?: number;
}

/**
 * Email-safe DOT-PLOT comparison chart as a self-contained SVG string
 * (system fonts, explicit size) ready for resvg. Shared horizontal scale across
 * all rows, a faint per-row baseline rule, a grey reference dot + an accent value
 * dot, the formatted value at the row end, and a tiny "● this  ○ {referenceLabel}"
 * legend. Capped to 8 rows to keep the email height sane.
 */
export function dotPlotSvg(items: DotPlotItem[], opts: DotPlotOpts): string {
  const W = opts.width ?? 600;
  const rows = items.slice(0, 8);
  const n = rows.length;
  const fmt: ValueFormat = opts.valueFormat ?? "usd";
  const refLabel = opts.referenceLabel ?? "reference";

  const padL = 156,
    padR = 88,
    padT = 64,
    padB = 44;
  const rowH = 30;
  const H = padT + n * rowH + padB;
  const trackW = W - padL - padR;

  // Shared horizontal scale across every value + reference.
  const allVals = rows.flatMap((r) =>
    typeof r.reference === "number" ? [r.value, r.reference] : [r.value],
  );
  const minV = allVals.length ? Math.min(...allVals) : 0;
  const maxV = allVals.length ? Math.max(...allVals) : 1;
  const span = maxV - minV || 1;
  const xPos = (v: number) => padL + ((v - minV) / span) * trackW;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text x="${padL}" y="28" font-family="Arial" font-size="15" font-weight="bold" fill="#1F2937">${esc(opts.title)}</text>`,
  ];

  // Tiny top legend: ● {valueLabel}  ○ {referenceLabel}. The reference dot is placed
  // AFTER the value label (width estimated from its length, ~6.2px/char at 11px) so a
  // long label like "Median sale price" never collides with the reference legend.
  const legY = 46;
  const valLabel = opts.valueLabel ?? "value";
  const refDotX = padL + 15 + Math.round(valLabel.length * 6.2) + 16;
  parts.push(
    `<circle cx="${padL + 5}" cy="${legY - 4}" r="5" fill="${esc(opts.accent)}"/>`,
    `<text x="${padL + 15}" y="${legY}" font-family="Arial" font-size="11" fill="${AXIS_TEXT}">${esc(valLabel)}</text>`,
    `<circle cx="${refDotX}" cy="${legY - 4}" r="5" fill="#ffffff" stroke="${REF_DOT}" stroke-width="2"/>`,
    `<text x="${refDotX + 10}" y="${legY}" font-family="Arial" font-size="11" fill="${AXIS_TEXT}">${esc(refLabel)}</text>`,
  );

  rows.forEach((r, i) => {
    const cy = padT + i * rowH + rowH / 2;
    const label = r.label.length > 26 ? `${r.label.slice(0, 25)}…` : r.label;
    // label + faint baseline rule
    parts.push(
      `<text x="${padL - 8}" y="${(cy + 4).toFixed(1)}" text-anchor="end" font-family="Arial" font-size="12" fill="#374151">${esc(label)}</text>`,
      `<line x1="${padL}" y1="${cy.toFixed(1)}" x2="${(padL + trackW).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`,
    );
    // grey reference dot (if present)
    if (typeof r.reference === "number") {
      parts.push(
        `<circle cx="${xPos(r.reference).toFixed(1)}" cy="${cy.toFixed(1)}" r="6" fill="#ffffff" stroke="${REF_DOT}" stroke-width="2"/>`,
      );
    }
    // accent value dot + end label
    parts.push(
      `<circle cx="${xPos(r.value).toFixed(1)}" cy="${cy.toFixed(1)}" r="6" fill="${esc(opts.accent)}"/>`,
      `<text x="${(padL + trackW + 10).toFixed(1)}" y="${(cy + 4).toFixed(1)}" font-family="Arial" font-size="12" font-weight="bold" fill="#1F2937">${esc(formatAxisTick(fmt, r.value))}</text>`,
    );
  });

  // source · as-of caption
  const captionParts: string[] = [];
  if (opts.source) captionParts.push(opts.source);
  if (opts.asOf) captionParts.push(`as of ${formatDisplayDate(opts.asOf)}`);
  if (captionParts.length)
    parts.push(
      `<text x="${padL}" y="${H - 12}" font-family="Arial" font-size="10" fill="${AXIS_TEXT}">${esc(captionParts.join(" · "))}</text>`,
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
