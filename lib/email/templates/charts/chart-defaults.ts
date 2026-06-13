import { SWFL_THEME } from "@/scripts/email/types";

// Section 2 (S2) — SWFL chart palette + email-safe font default.
//
// primary/accent derive from SWFL_THEME — never re-hardcode those hex values
// (same single-source rule as SWFL_TOKEN_DEFAULTS in token-defaults.ts).
export const SWFL_CHART_DEFAULTS = {
  primary: SWFL_THEME.primary, // #0F2035
  accent: SWFL_THEME.accent, // #1BB8C9
  neutral: "#6B7280",
  danger: "#EF4444",
  // Arial, not Inter: web fonts are unavailable in email clients, so the chart
  // layer falls back to a universally-installed family.
  font: "Arial, sans-serif",
  maxWidth: 560,
} as const;

export interface EmailChartTheme {
  primary?: string;
  accent?: string;
  neutral?: string;
  danger?: string;
  font?: string;
}

export interface ResolvedChartTheme {
  primary: string;
  accent: string;
  neutral: string;
  danger: string;
  font: string;
}

/**
 * Merge a partial theme over SWFL_CHART_DEFAULTS, skipping undefined overrides
 * so an absent field never blanks out a default (same intent as resolveTheme()).
 */
export function resolveChartTheme(theme?: Partial<EmailChartTheme>): ResolvedChartTheme {
  return {
    primary: theme?.primary ?? SWFL_CHART_DEFAULTS.primary,
    accent: theme?.accent ?? SWFL_CHART_DEFAULTS.accent,
    neutral: theme?.neutral ?? SWFL_CHART_DEFAULTS.neutral,
    danger: theme?.danger ?? SWFL_CHART_DEFAULTS.danger,
    font: theme?.font ?? SWFL_CHART_DEFAULTS.font,
  };
}
