import type {
  EmailChartSpec,
  BarChartSpec,
  SparklineSpec,
  GaugeSpec,
  HeatRowSpec,
  StackedBarSpec,
} from "./chart-types";
import {
  SWFL_CHART_DEFAULTS,
  resolveChartTheme,
  type EmailChartTheme,
  type ResolvedChartTheme,
} from "./chart-defaults";

// Section 2 (S2) — email-safe chart renderer.
//
// Hard rules (email clients strip these): no <script>, no <canvas>, no <style>
// blocks (Gmail drops them), no external font refs inside SVG. Everything is
// inline styles on plain HTML tables or a self-contained inline SVG, ≤600px.
//
// Public entry: renderChart(spec, theme?) -> HTML string for the [ CHART ] slot.

const MAX_WIDTH = 600;
const TRACK_BG = "#E5E7EB"; // light neutral rail behind bars

/** HTML-escape so data-derived labels/values can never break or inject markup. */
function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Resolve the drawing width: spec width or default, clamped to the email max. */
function resolveWidth(specWidth: number | undefined): number {
  const w = specWidth ?? SWFL_CHART_DEFAULTS.maxWidth;
  if (!Number.isFinite(w) || w <= 0) return SWFL_CHART_DEFAULTS.maxWidth;
  return Math.min(Math.round(w), MAX_WIDTH);
}

/** Wrap a chart body with an optional title/subtitle, in a width-bounded box. */
function wrap(
  width: number,
  theme: ResolvedChartTheme,
  body: string,
  title?: string,
  subtitle?: string,
): string {
  const head: string[] = [];
  if (title) {
    head.push(
      `<div style="font-family:${theme.font};font-size:15px;font-weight:bold;color:${theme.primary};margin:0 0 2px;">${esc(title)}</div>`,
    );
  }
  if (subtitle) {
    head.push(
      `<div style="font-family:${theme.font};font-size:12px;color:${theme.neutral};margin:0 0 8px;">${esc(subtitle)}</div>`,
    );
  }
  return `<div style="max-width:${width}px;font-family:${theme.font};">${head.join("")}${body}</div>`;
}

// ── color helpers (for heat-row shading) ──────────────────────────────────────

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.padEnd(6, "0").slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");
}

/** Linear blend a→b at t∈[0,1]. */
function blendHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const u = Math.max(0, Math.min(1, t));
  return `#${toHex(ar + (br - ar) * u)}${toHex(ag + (bg - ag) * u)}${toHex(ab + (bb - ab) * u)}`;
}

/** Black or white text, whichever has more contrast on `bg` (rec601 luma). */
function readableText(bg: string): string {
  const [r, g, b] = parseHex(bg);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? "#111827" : "#ffffff";
}

// ── per-type renderers ────────────────────────────────────────────────────────

function renderBar(spec: BarChartSpec, theme: ResolvedChartTheme, width: number): string {
  const labelW = 140;
  const valueW = 56;
  const trackPx = Math.max(40, width - labelW - valueW - 16);
  const max = spec.data.reduce((m, d) => Math.max(m, d.value), 0);
  const unit = spec.unit ? esc(spec.unit) : "";

  const rows = spec.data
    .map((d) => {
      const frac = max > 0 ? d.value / max : 0;
      const barPx = d.value > 0 ? Math.max(2, Math.round(frac * trackPx)) : 0;
      const fill = d.color ? esc(d.color) : theme.accent;
      return [
        "<tr>",
        `<td style="width:${labelW}px;padding:4px 8px 4px 0;font-size:13px;color:${theme.primary};text-align:right;vertical-align:middle;">${esc(d.label)}</td>`,
        '<td style="padding:4px 0;vertical-align:middle;">',
        `<div style="background:${TRACK_BG};width:${trackPx}px;height:16px;border-radius:3px;font-size:0;line-height:0;">`,
        `<div style="background:${fill};width:${barPx}px;height:16px;border-radius:3px;font-size:0;line-height:0;">&nbsp;</div>`,
        "</div></td>",
        `<td style="width:${valueW}px;padding:4px 0 4px 8px;font-size:13px;font-weight:bold;color:${theme.primary};text-align:left;vertical-align:middle;">${esc(d.value)}${unit}</td>`,
        "</tr>",
      ].join("");
    })
    .join("");

  const body = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:${width}px;">${rows}</table>`;
  return wrap(width, theme, body, spec.title, spec.subtitle);
}

function renderSparkline(spec: SparklineSpec, theme: ResolvedChartTheme, width: number): string {
  const height = 60;
  const padX = 4;
  const padY = 8;
  const stroke = spec.color ? esc(spec.color) : theme.accent;
  const n = spec.data.length;

  let body: string;
  if (n === 0) {
    body = `<div style="font-size:12px;color:${theme.neutral};">No data</div>`;
  } else {
    const ys = spec.data.map((d) => d.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanY = maxY - minY || 1;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    const pts = spec.data.map((d, i) => {
      const px = n === 1 ? width / 2 : padX + (i / (n - 1)) * innerW;
      const py = padY + (1 - (d.y - minY) / spanY) * innerH;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    });
    const last = pts[pts.length - 1].split(",");
    body = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;">`,
      `<polyline points="${pts.join(" ")}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`,
      `<circle cx="${last[0]}" cy="${last[1]}" r="3" fill="${stroke}" />`,
      "</svg>",
    ].join("");
  }
  return wrap(width, theme, body, spec.title, spec.subtitle);
}

function renderGauge(spec: GaugeSpec, theme: ResolvedChartTheme, width: number): string {
  const value = Math.max(0, Math.min(100, spec.value));
  const fill = spec.color ? esc(spec.color) : theme.accent;
  const w = Math.min(width, 220);
  const cx = w / 2;
  const cy = w / 2;
  const r = w / 2 - 18;
  const stroke = 16;

  // Semicircle 180°→0°. Endpoint angle for the value arc.
  const theta = Math.PI * (1 - value / 100);
  const ex = cx + r * Math.cos(theta);
  const ey = cy - r * Math.sin(theta);
  const startX = cx - r;
  const startY = cy;
  const endX = cx + r;

  const track = `M ${startX.toFixed(1)} ${startY.toFixed(1)} A ${r} ${r} 0 0 1 ${endX.toFixed(1)} ${startY.toFixed(1)}`;
  const arc = `M ${startX.toFixed(1)} ${startY.toFixed(1)} A ${r} ${r} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  const svgH = Math.round(cy + stroke);

  const body = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${svgH}" viewBox="0 0 ${w} ${svgH}" style="display:block;">`,
    `<path d="${track}" fill="none" stroke="${TRACK_BG}" stroke-width="${stroke}" stroke-linecap="round" />`,
    `<path d="${arc}" fill="none" stroke="${fill}" stroke-width="${stroke}" stroke-linecap="round" />`,
    `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-family="${theme.font}" font-size="22" font-weight="bold" fill="${theme.primary}">${value}</text>`,
    spec.label
      ? `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-family="${theme.font}" font-size="11" fill="${theme.neutral}">${esc(spec.label)}</text>`
      : "",
    "</svg>",
  ].join("");
  return wrap(width, theme, body, spec.title, spec.subtitle);
}

function renderStackedBar(spec: StackedBarSpec, theme: ResolvedChartTheme, width: number): string {
  const sum = spec.segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const total = spec.total && spec.total > 0 ? spec.total : sum || 1;

  // Pixel widths that sum exactly to `width` (remainder to the last segment).
  let used = 0;
  const pieces = spec.segments.map((seg, i) => {
    const isLast = i === spec.segments.length - 1;
    const px = isLast
      ? Math.max(0, width - used)
      : Math.round((Math.max(0, seg.value) / total) * width);
    used += px;
    const first = i === 0;
    const radius = `${first ? "4px 0 0 4px" : isLast ? "0 4px 4px 0" : "0"}`;
    return `<td style="width:${px}px;background:${esc(seg.color)};height:22px;border-radius:${radius};font-size:0;line-height:0;">&nbsp;</td>`;
  });

  const bar = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:${width}px;table-layout:fixed;"><tr>${pieces.join("")}</tr></table>`;

  const legend = spec.segments
    .map((seg) => {
      const pct = Math.round((Math.max(0, seg.value) / total) * 100);
      return [
        `<span style="display:inline-block;margin:6px 14px 0 0;font-size:12px;color:${theme.primary};white-space:nowrap;">`,
        `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${esc(seg.color)};margin-right:5px;"></span>`,
        `${esc(seg.label)} <strong>${esc(seg.value)}</strong> (${pct}%)`,
        "</span>",
      ].join("");
    })
    .join("");

  const body = `${bar}<div style="margin-top:2px;">${legend}</div>`;
  return wrap(width, theme, body, spec.title, spec.subtitle);
}

function renderHeatRow(spec: HeatRowSpec, theme: ResolvedChartTheme, width: number): string {
  const allValues = spec.rows.flatMap((r) => r.cells.map((c) => c.value));
  const min = allValues.length ? Math.min(...allValues) : 0;
  const max = allValues.length ? Math.max(...allValues) : 1;
  const span = max - min || 1;
  const labelW = 110;

  const header = [
    "<tr>",
    `<th style="width:${labelW}px;padding:4px 6px;font-size:11px;color:${theme.neutral};text-align:left;border:0;"></th>`,
    ...spec.columnLabels.map(
      (c) =>
        `<th style="padding:4px 6px;font-size:11px;font-weight:bold;color:${theme.neutral};text-align:center;border:0;">${esc(c)}</th>`,
    ),
    "</tr>",
  ].join("");

  const rows = spec.rows
    .map((row) => {
      const cells = row.cells
        .map((cell) => {
          const bg = cell.color
            ? esc(cell.color)
            : blendHex("#EAF7F9", theme.accent, (cell.value - min) / span);
          const fg = cell.color ? readableText(cell.color) : readableText(bg);
          return `<td style="padding:8px 6px;background:${bg};color:${fg};font-size:12px;font-weight:bold;text-align:center;border:1px solid #ffffff;">${esc(cell.value)}</td>`;
        })
        .join("");
      return `<tr><td style="width:${labelW}px;padding:8px 6px;font-size:12px;color:${theme.primary};text-align:left;border:1px solid #ffffff;">${esc(row.label)}</td>${cells}</tr>`;
    })
    .join("");

  const body = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:${width}px;">${header}${rows}</table>`;
  return wrap(width, theme, body, spec.title, spec.subtitle);
}

// ── dispatch ──────────────────────────────────────────────────────────────────

/**
 * Render an email-safe chart to an inline HTML/SVG string. The output drops
 * straight into renderEmailTemplate()'s `data.chart` field (the [ CHART ] slot).
 */
export function renderChart(spec: EmailChartSpec, theme?: Partial<EmailChartTheme>): string {
  const resolved = resolveChartTheme(theme);
  const width = resolveWidth(spec.width);

  switch (spec.type) {
    case "bar":
      return renderBar(spec, resolved, width);
    case "sparkline":
      return renderSparkline(spec, resolved, width);
    case "gauge":
      return renderGauge(spec, resolved, width);
    case "stacked-bar":
      return renderStackedBar(spec, resolved, width);
    case "heat-row":
      return renderHeatRow(spec, resolved, width);
    default: {
      // Exhaustiveness guard — a new spec type must add a case above.
      const _never: never = spec;
      throw new Error(`Unknown chart type: ${JSON.stringify(_never)}`);
    }
  }
}
