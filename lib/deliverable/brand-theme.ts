import type { ChartTheme } from "@/components/charts/registry/chart-spec";

/**
 * Brand theming — Phase 6.
 *
 * The project stores branding as a free-form blob; brand-theme.ts is the
 * single place that defines which keys mean "primary color", "accent", and
 * "logo". Keeping this pure and separate means the page, the frame renderer,
 * and the print layer all read from one source without coupling each other.
 */

/** Canonical brand fields on `projects.branding` / `deliverables.branding`. */
export interface BrandTheme {
  primary: string | null;
  accent: string | null;
  logoUrl: string | null;
}

/**
 * Extract brand theme fields from the branding blob stored on a project or
 * deliverable. Returns `null` when no theme fields are present so callers can
 * skip the theme injection path cheaply.
 */
export function extractBrandTheme(
  branding: Record<string, unknown> | null | undefined,
): BrandTheme | null {
  if (!branding) return null;
  const primary = typeof branding.primary_color === "string" ? branding.primary_color : null;
  const accent = typeof branding.accent_color === "string" ? branding.accent_color : null;
  const logoUrl = typeof branding.logo_url === "string" ? branding.logo_url : null;
  if (!primary && !accent && !logoUrl) return null;
  return { primary, accent, logoUrl };
}

/**
 * Convert a `BrandTheme` to the `ChartTheme` token used on `ChartSpec.theme`.
 * Only populated fields are included so frames can distinguish "not set" from
 * "set to empty string".
 */
export function toChartTheme(brand: BrandTheme): ChartTheme {
  const theme: ChartTheme = {};
  if (brand.primary) theme.primary = brand.primary;
  if (brand.accent) theme.accent = brand.accent;
  if (brand.logoUrl) theme.logoUrl = brand.logoUrl;
  return theme;
}
