// lib/email/outreach/drip-email.ts
//
// Compose ONE recurring cold-outreach drip email: a single brand-themed chart + a
// brief professional explanation + a "create your own" CTA, all skinned in the
// RECIPIENT's scraped brand. Deterministic; the chart/explanation/CTA are passed in
// (the campaign layer assembles them per recipient). NO LLM here.
//
// The unsubscribe footer is injected post-render by ensureUnsubscribeToken — the
// {{{RESEND_UNSUBSCRIBE_URL}}} token must NOT be in the shell or renderEmailTemplate's
// unfilled-token assert rejects its inner {{...}} (mirrors lib/email/activation/render.ts).

import { renderEmailTemplate, brandThemeToTokens } from "@/lib/email/templates/render-template";
import { renderChart } from "@/lib/email/templates/charts/chart-renderer";
import type { EmailChartSpec } from "@/lib/email/templates/charts/chart-types";
import { ensureUnsubscribeToken } from "@/lib/email/scheduler";
import type { ActivationBrand } from "@/lib/email/activation/types";

export interface DripEmailInput {
  /** The recipient's brand (scraped via enrichBrand, or the SWFL house brand on low confidence). */
  brand: ActivationBrand;
  /** Short uppercase eyebrow, e.g. "FORT MYERS BEACH · MARKET PULSE". */
  kicker: string;
  /** The takeaway headline, in plain English (the chart's spoken summary). */
  title: string;
  /** The one chart for this send (already built from the recipient's market data). */
  chart: EmailChartSpec;
  /** 1–3 sentences of professional "what this means" prose (plain text or simple HTML). */
  explanation: string;
  /** The "create your own" destination — the branded /welcome arrival (buildArrivalUrl). */
  ctaUrl: string;
  /** Freshness line shown under the CTA, e.g. "Live data token: SWFL-7421-v5-20260620". */
  freshness: string;
  /** Email subject line. */
  subject: string;
}

export interface DripEmail {
  html: string;
  subject: string;
}

/** Map the recipient brand → the chart renderer's theme (series in their accent). */
function chartThemeFromBrand(brand: ActivationBrand) {
  const theme: { primary?: string; accent?: string } = {};
  if (brand.primary) theme.primary = brand.primary;
  if (brand.accent) theme.accent = brand.accent;
  return theme;
}

/**
 * Render the branded drip email HTML + subject. The chart is themed with the
 * recipient's accent so the data series shows in THEIR color; the masthead/CTA use
 * brandThemeToTokens (PRIMARY/ACCENT/LOGO_URL). Absent brand fields fall back to the
 * shell's SWFL defaults — the caller decides whether a low-confidence scrape should
 * pass the SWFL house brand instead of guessed colors.
 */
export async function renderDripEmail(input: DripEmailInput): Promise<DripEmail> {
  const brandTokens = brandThemeToTokens({
    primary: input.brand.primary ?? null,
    accent: input.brand.accent ?? null,
    logoUrl: input.brand.logoUrl ?? null,
  });

  const tokens: Record<string, string | number> = {
    ...brandTokens,
    KICKER: input.kicker,
    TITLE: input.title,
    CTA_URL: input.ctaUrl,
    FRESHNESS: input.freshness,
    ...(input.brand.companyName ? { COMPANY_NAME: input.brand.companyName } : {}),
  };

  const chartHtml = renderChart(input.chart, chartThemeFromBrand(input.brand));

  const rendered = await renderEmailTemplate("outreach", tokens, {
    chart: chartHtml,
    body: input.explanation,
  });

  // Inject the per-recipient unsubscribe footer (CAN-SPAM); idempotent.
  const html = ensureUnsubscribeToken(rendered);
  return { html, subject: input.subject };
}
