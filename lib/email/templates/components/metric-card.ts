import { COMPONENT_DEFAULTS, esc } from "./_shared";

// Section 3 (S3) Task 3A — metric card. A self-contained <td> block (≤180px, so
// three fit across a 600px email column). The delta arrow is inline SVG — no icon
// fonts, which email clients strip.

export interface MetricDelta {
  value: number;
  direction: "up" | "down" | "flat";
  label: string;
}

/** A tiny inline-SVG mark for the delta direction, filled in `color`. */
function arrow(direction: MetricDelta["direction"], color: string): string {
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 10 10" style="vertical-align:middle;">`;
  const shape =
    direction === "up"
      ? `<path d="M5 1 L9 8 L1 8 Z" fill="${color}" />`
      : direction === "down"
        ? `<path d="M1 2 L9 2 L5 9 Z" fill="${color}" />`
        : `<rect x="1" y="4.25" width="8" height="1.5" fill="${color}" />`;
  return `${open}${shape}</svg>`;
}

/**
 * Render a single metric card as a composable `<td>`. The caller wraps cards in a
 * `<tr>` / `<table>` (three-up for a full-width strip).
 */
export function renderMetricCard(
  label: string,
  value: string,
  delta?: MetricDelta,
  theme?: { primary?: string; accent?: string },
): string {
  const primary = theme?.primary ?? COMPONENT_DEFAULTS.primary;
  const font = COMPONENT_DEFAULTS.font;

  let deltaHtml = "";
  if (delta) {
    const color =
      delta.direction === "up"
        ? COMPONENT_DEFAULTS.positive
        : delta.direction === "down"
          ? COMPONENT_DEFAULTS.negative
          : COMPONENT_DEFAULTS.neutral;
    deltaHtml =
      `<div style="margin-top:6px;font-family:${font};font-size:12px;font-weight:bold;color:${color};white-space:nowrap;">` +
      `${arrow(delta.direction, color)} ${esc(delta.value)} ${esc(delta.label)}` +
      `</div>`;
  }

  return [
    `<td width="180" style="width:180px;max-width:180px;padding:14px 16px;vertical-align:top;font-family:${font};">`,
    `<div style="font-size:26px;font-weight:bold;color:${primary};line-height:1.1;">${esc(value)}</div>`,
    `<div style="margin-top:4px;font-size:11px;color:${COMPONENT_DEFAULTS.neutral};text-transform:uppercase;letter-spacing:0.5px;">${esc(label)}</div>`,
    deltaHtml,
    `</td>`,
  ].join("");
}
