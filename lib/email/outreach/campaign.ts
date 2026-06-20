// lib/email/outreach/campaign.ts
//
// Orchestrate one cold-outreach campaign run over a list of targets: per recipient,
// scrape their brand, gate it on confidence, build the per-recipient chart + copy,
// and render their branded drip email. Pure/DI — all I/O (brand scrape, market-data
// → chart/copy) is injected, so this is unit-testable with zero network/DB. A single
// recipient's failure NEVER throws past its boundary (it lands as an "error" row).
//
// What's intentionally NOT here: the live send. Composing proves the whole per-recipient
// path; sending (CAN-SPAM unsubscribe identity, suppression-on-click, secrets) is the
// CLI's gated next step — same safety posture as scripts/email/enroll-prospect.mts.

import type { BrandEnrichment } from "@/lib/prospects/enrich-brand";
import { buildArrivalUrl } from "@/lib/prospects/build-arrival-url";
import type { ActivationBrand } from "@/lib/email/activation/types";
import type { EmailChartSpec } from "@/lib/email/templates/charts/chart-types";
import { renderDripEmail } from "./drip-email";
import type { OutreachTarget } from "./targets";

/** The per-recipient market content the campaign renders (built from their ZIP). */
export interface CampaignContent {
  kicker: string;
  title: string;
  chart: EmailChartSpec;
  explanation: string;
  subject: string;
  freshness: string;
}

/**
 * Build the per-recipient content (chart + copy) from the target's market scope.
 * Returns null when the target is out of scope / has no data to show (the recipient
 * is then skipped, never sent an empty report). Injected so the heavy report assembly
 * (assembleActivationReport, etc.) lives in the CLI, not in this testable core.
 */
export type ContentBuilder = (target: OutreachTarget) => Promise<CampaignContent | null>;

export interface CampaignDeps {
  /** Scrape the recipient brand from their domain. Defaults to enrichBrand in the CLI. */
  enrich: (domain: string) => Promise<BrandEnrichment>;
  /** Build the per-recipient chart + copy from their market scope. */
  buildContent: ContentBuilder;
  /** Absolute site origin for the click-back arrival URL. */
  siteOrigin: string;
  /** Min scrape confidence to use the recipient's brand; below → SWFL house brand. Default 0.5. */
  confidenceThreshold?: number;
}

export type ComposedStatus = "ready" | "out_of_scope" | "error";

export interface ComposedMessage {
  email: string;
  name?: string;
  zip?: string;
  domain?: string;
  status: ComposedStatus;
  /** "house" when the scrape fell back / was too low-confidence; else the scrape source. */
  brandSource: string;
  brandConfidence: number;
  usedHouseBrand: boolean;
  primary: string | null;
  /** The branded click-back URL (their colors auto-populate the arrival). */
  arrivalUrl: string;
  subject: string;
  /** Rendered email HTML — present only when status === "ready". */
  html?: string;
  /** Why this row is out_of_scope / error. */
  reason?: string;
}

export interface CampaignResult {
  messages: ComposedMessage[];
  summary: {
    total: number;
    ready: number;
    out_of_scope: number;
    error: number;
    used_house_brand: number;
  };
}

/** Compose (render, do not send) the whole campaign. */
export async function composeCampaign(
  targets: OutreachTarget[],
  deps: CampaignDeps,
): Promise<CampaignResult> {
  const threshold = deps.confidenceThreshold ?? 0.5;
  const messages: ComposedMessage[] = [];

  for (const target of targets) {
    try {
      // 1. Brand scrape (never throws) + confidence gate.
      const enriched = target.domain
        ? await deps.enrich(target.domain)
        : { primary: null, secondary: null, logo_url: null, company_name: null, confidence: 0, source: "none" as const };
      const trustBrand = enriched.confidence >= threshold && !!enriched.primary;
      const usedHouseBrand = !trustBrand;

      const brand: ActivationBrand = trustBrand
        ? {
            primary: enriched.primary,
            accent: enriched.secondary,
            logoUrl: enriched.logo_url,
            companyName: target.name ?? enriched.company_name,
          }
        : { primary: null, accent: null, logoUrl: null, companyName: target.name ?? null };

      // 2. The branded click-back arrival (only pass scraped colors when trusted).
      const arrivalUrl = buildArrivalUrl({
        name: target.name ?? enriched.company_name ?? undefined,
        brand: trustBrand ? enriched : null,
        zip: target.zip,
        base: deps.siteOrigin,
      });

      // 3. Per-recipient market content (chart + copy). null → nothing to show.
      const content = await deps.buildContent(target);
      if (!content) {
        messages.push({
          email: target.email,
          ...(target.name ? { name: target.name } : {}),
          ...(target.zip ? { zip: target.zip } : {}),
          ...(target.domain ? { domain: target.domain } : {}),
          status: "out_of_scope",
          brandSource: usedHouseBrand ? "house" : enriched.source,
          brandConfidence: enriched.confidence,
          usedHouseBrand,
          primary: trustBrand ? enriched.primary : null,
          arrivalUrl,
          subject: "",
          reason: "no in-scope market content for this target",
        });
        continue;
      }

      // 4. Render the branded drip email.
      const { html, subject } = await renderDripEmail({
        brand,
        kicker: content.kicker,
        title: content.title,
        chart: content.chart,
        explanation: content.explanation,
        ctaUrl: arrivalUrl,
        freshness: content.freshness,
        subject: content.subject,
      });

      messages.push({
        email: target.email,
        ...(target.name ? { name: target.name } : {}),
        ...(target.zip ? { zip: target.zip } : {}),
        ...(target.domain ? { domain: target.domain } : {}),
        status: "ready",
        brandSource: usedHouseBrand ? "house" : enriched.source,
        brandConfidence: enriched.confidence,
        usedHouseBrand,
        primary: trustBrand ? enriched.primary : null,
        arrivalUrl,
        subject,
        html,
      });
    } catch (err) {
      messages.push({
        email: target.email,
        ...(target.name ? { name: target.name } : {}),
        ...(target.zip ? { zip: target.zip } : {}),
        ...(target.domain ? { domain: target.domain } : {}),
        status: "error",
        brandSource: "unknown",
        brandConfidence: 0,
        usedHouseBrand: true,
        primary: null,
        arrivalUrl: "",
        subject: "",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary = {
    total: messages.length,
    ready: messages.filter((m) => m.status === "ready").length,
    out_of_scope: messages.filter((m) => m.status === "out_of_scope").length,
    error: messages.filter((m) => m.status === "error").length,
    used_house_brand: messages.filter((m) => m.usedHouseBrand).length,
  };

  return { messages, summary };
}
