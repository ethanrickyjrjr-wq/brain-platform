import { COMPONENT_DEFAULTS, esc } from "./_shared";

// Section 3 (S3) Task 3A — stat row. A single-row, full-600px band of evenly
// divided stat cells over the SURFACE token color.

export interface StatItem {
  label: string;
  value: string;
  sub?: string;
}

const FULL_WIDTH = 600;

/** Render a horizontal stat band. Empty input yields an empty (but valid) row. */
export function renderStatRow(stats: StatItem[]): string {
  const font = COMPONENT_DEFAULTS.font;

  const cells = stats
    .map((s, i) => {
      const divider = i < stats.length - 1 ? "border-right:1px solid #E5E7EB;" : "";
      const sub = s.sub
        ? `<div style="margin-top:2px;font-size:11px;color:${COMPONENT_DEFAULTS.neutral};">${esc(s.sub)}</div>`
        : "";
      return [
        `<td align="center" style="padding:14px 10px;vertical-align:top;${divider}">`,
        `<div style="font-size:20px;font-weight:bold;color:${COMPONENT_DEFAULTS.primary};">${esc(s.value)}</div>`,
        `<div style="margin-top:4px;font-size:11px;color:${COMPONENT_DEFAULTS.neutral};text-transform:uppercase;letter-spacing:0.5px;">${esc(s.label)}</div>`,
        sub,
        `</td>`,
      ].join("");
    })
    .join("");

  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${FULL_WIDTH}" ` +
    `style="width:${FULL_WIDTH}px;max-width:${FULL_WIDTH}px;border-collapse:collapse;background:${COMPONENT_DEFAULTS.surface};font-family:${font};">` +
    `<tr>${cells}</tr></table>`
  );
}
