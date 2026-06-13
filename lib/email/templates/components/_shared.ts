import { SWFL_THEME } from "@/scripts/email/types";
import { SWFL_TOKEN_DEFAULTS } from "../token-defaults";

// Section 3 (S3) — shared helpers for the email-safe visual components.
//
// Colors derive from SWFL_THEME / SWFL_TOKEN_DEFAULTS — never re-hardcode those
// hex values (same single-source rule the chart layer follows). Every component
// emits a self-contained HTML string: inline styles only, no <script>/<canvas>/
// <style>, ≤600px wide, all data escaped.

export const COMPONENT_DEFAULTS = {
  primary: SWFL_THEME.primary, // #0F2035 — headings, value text
  accent: SWFL_THEME.accent, // #1BB8C9 — badges, info callouts
  surface: SWFL_TOKEN_DEFAULTS.SURFACE, // #ffffff — stat-row background
  text: SWFL_TOKEN_DEFAULTS.TEXT, // #111827 — body copy
  neutral: "#6B7280", // muted labels / flat delta
  warn: "#F59E0B", // amber — warn callout
  positive: "#16A34A", // green — delta up
  negative: "#DC2626", // red — delta down
  // Web fonts are unavailable in email clients, so components fall back to a
  // universally-installed family — matches the chart layer for visual coherence.
  font: "Arial, sans-serif",
} as const;

/** HTML-escape so data-derived content can never break markup or an attribute. */
export function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace(/^#/, "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Black (#111827) or white (#ffffff) text, whichever reads better on `bg`
 * (rec601 luma). Non-hex colors (named/rgb()) are assumed saturated → white.
 */
export function readableText(bg: string): string {
  const rgb = parseHex(bg);
  if (!rgb) return "#ffffff";
  const [r, g, b] = rgb;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? "#111827" : "#ffffff";
}
