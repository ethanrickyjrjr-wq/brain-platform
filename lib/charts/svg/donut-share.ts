// lib/charts/svg/donut-share.ts
//
// DONUT / SHARE — composition at a glance. ONE pure SVG builder, two surfaces:
// the React `DonutShareFrame` wraps this string; the email PNG path rasterizes
// the SAME string through resvg (lib/email/spec-to-png.ts). No React, no DOM, no
// I/O — a deterministic, self-contained, email-safe <svg> STRING (system fonts
// only, no <script>/<style>/<canvas>/<foreignObject>, ≤600px wide).
//
// Idiom copied from lib/email/chart-image.ts: W/H/pad geometry, the GRID /
// AXIS_TEXT palette, the esc() helper, numbers via formatAxisTick, dates via
// formatDisplayDate, a bold title at top and an optional source/as-of caption at
// the bottom.

import { formatAxisTick, type ValueFormat } from "@/lib/charts/format";
import { formatDisplayDate } from "@/lib/format-date";
import { extendPalette } from "@/lib/charts/palette";

export interface DonutSegment {
  label: string;
  value: number;
  /** Explicit segment color; falls back to an on-brand extendPalette fill. */
  color?: string;
}

export interface DonutShareOpts {
  title: string;
  accent: string; // brand accent hex — the dominant segment + tint ramp seed
  /** Center total; defaults to the sum of segment values. */
  total?: number;
  /** Small label under the center number (e.g. "permits", "units"). */
  unit?: string;
  /**
   * How the center total + legend values format. Additive optional knob (the
   * deliverable contract requires numbers route through formatAxisTick, which
   * needs a ValueFormat). Default "count" — the common share-chart case.
   */
  valueFormat?: ValueFormat;
  /** Caption under the chart: "{source} · as of MM/DD/YYYY". */
  source?: string;
  asOf?: string;
  width?: number;
}

const GRID = "#EAECEF";
const AXIS_TEXT = "#6B7280";
const TITLE_FILL = "#1F2937";
const LABEL_FILL = "#374151";

/** Point on the ring (center of the stroke) at `angle` radians (0 = right). */
function ringPoint(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

/**
 * Email-safe DONUT/SHARE chart as a self-contained SVG string. A stroked ring of
 * parts-of-whole (one arc <path> per segment, or a full <circle> for a lone 100%
 * share), the total in the center, and a right-hand legend (swatch · label ·
 * value · percent). Segments without an explicit color get an on-brand,
 * grayscale-distinct extendPalette fill. Caps at 6 segments. Empty / zero-total input renders a graceful
 * titled placeholder rather than NaN geometry.
 */
export function donutShareSvg(segments: DonutSegment[], opts: DonutShareOpts): string {
  const W = opts.width ?? 600;
  const fmt: ValueFormat = opts.valueFormat ?? "count";
  const accent = opts.accent && /^#?[0-9a-fA-F]{6}$/.test(opts.accent) ? opts.accent : "#2563EB";

  // Cap at 6 segments; drop non-positive values from the geometry.
  const rows = segments.filter((s) => Number.isFinite(s.value) && s.value > 0).slice(0, 6);

  // Ring geometry — left side; legend on the right.
  const padT = 48;
  const R = 78; // radius to the center of the stroke
  const thickness = 30;
  const cx = 150;
  const cy = padT + R + thickness / 2 + 8;
  const ringBottom = cy + R + thickness / 2;

  // Legend geometry (right of the ring).
  const legendX = 300;
  const swatch = 12;
  const rowH = 26;
  const legendTop = padT + 6;
  const legendBottom = legendTop + Math.max(rows.length, 1) * rowH;

  const captionParts: string[] = [];
  if (opts.source) captionParts.push(opts.source);
  if (opts.asOf) captionParts.push(`as of ${formatDisplayDate(opts.asOf)}`);
  const captionH = captionParts.length ? 26 : 14;
  const H = Math.round(Math.max(ringBottom, legendBottom) + captionH);

  const head = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text x="40" y="28" font-family="Arial" font-size="15" font-weight="bold" fill="${TITLE_FILL}">${esc(opts.title)}</text>`,
  ];

  const caption = captionParts.length
    ? `<text x="40" y="${H - 12}" font-family="Arial" font-size="10" fill="${AXIS_TEXT}">${esc(captionParts.join(" · "))}</text>`
    : "";

  const sum = rows.reduce((acc, s) => acc + s.value, 0);
  const total = opts.total ?? sum;

  // Graceful empty / zero-total state — no NaN arcs.
  if (rows.length === 0 || sum <= 0) {
    return [
      ...head,
      `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${GRID}" stroke-width="${thickness}"/>`,
      `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="Arial" font-size="13" fill="${AXIS_TEXT}">No data</text>`,
      caption,
      `</svg>`,
    ].join("");
  }

  // Resolve a color per segment: explicit segment color wins; else an on-brand,
  // grayscale-distinct extension of the accent (extendPalette). White canvas.
  const generated = extendPalette([accent], rows.length, { background: "#ffffff" });
  const colorOf = (i: number, s: DonutSegment) => s.color ?? generated[i] ?? accent;

  // Arc segments — start at top (-90°), sweep clockwise.
  const arcs: string[] = [];
  let angle = -Math.PI / 2;
  rows.forEach((s, i) => {
    const frac = s.value / sum;
    const color = colorOf(i, s);
    if (frac >= 0.9999) {
      // Lone full share: a stroked arc with start==end renders nothing — use a circle.
      arcs.push(
        `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${esc(color)}" stroke-width="${thickness}"/>`,
      );
      return;
    }
    const span = frac * 2 * Math.PI;
    const end = angle + span;
    const [x0, y0] = ringPoint(cx, cy, R, angle);
    const [x1, y1] = ringPoint(cx, cy, R, end);
    const largeArc = span > Math.PI ? 1 : 0;
    arcs.push(
      `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" ` +
        `fill="none" stroke="${esc(color)}" stroke-width="${thickness}"/>`,
    );
    angle = end;
  });

  // Center total + unit label.
  const center = [
    `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-family="Arial" font-size="26" font-weight="bold" fill="${TITLE_FILL}">${esc(formatAxisTick(fmt, total))}</text>`,
  ];
  if (opts.unit) {
    center.push(
      `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-family="Arial" font-size="11" fill="${AXIS_TEXT}">${esc(opts.unit)}</text>`,
    );
  }

  // Legend: swatch · label · value (pct).
  const legend: string[] = [];
  rows.forEach((s, i) => {
    const ty = legendTop + i * rowH;
    const color = colorOf(i, s);
    const pct = ((s.value / sum) * 100).toFixed(1);
    const label = s.label.length > 22 ? `${s.label.slice(0, 21)}…` : s.label;
    legend.push(
      `<rect x="${legendX}" y="${ty}" width="${swatch}" height="${swatch}" rx="2" fill="${esc(color)}"/>`,
      `<text x="${legendX + swatch + 8}" y="${ty + swatch - 1}" font-family="Arial" font-size="12" fill="${LABEL_FILL}">${esc(label)}</text>`,
      `<text x="${W - 24}" y="${ty + swatch - 1}" text-anchor="end" font-family="Arial" font-size="12" font-weight="bold" fill="${TITLE_FILL}">${esc(formatAxisTick(fmt, s.value))}</text>`,
      `<text x="${W - 24}" y="${ty + swatch + 12}" text-anchor="end" font-family="Arial" font-size="10" fill="${AXIS_TEXT}">${esc(pct)}%</text>`,
    );
  });

  return [...head, ...arcs, ...center, ...legend, caption, `</svg>`].join("");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
