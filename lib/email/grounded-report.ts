/**
 * lib/email/grounded-report.ts — the convergence spine.
 *
 * `GroundedReportModel` is the ONE grounded data shape every deliverable lane
 * (activation email, recurring digest, briefcase email/PDF) produces and consumes.
 * It EXTENDS `AssembledReport` (the activation ZIP report, `activation/snapshot.ts`)
 * with the fields the other lanes already carry separately: the computed `delta`, a
 * general `scope` (so a county/region/topic report isn't ZIP-hardcoded), and the
 * CTA/origin that used to live only in `RenderReportOptions`.
 *
 * `renderGroundedReport(model, { skin, brand })` is the ONE skinnable render: it builds
 * the structured tokens + hero/metrics/reads repeats + the dark `[ DELTA ]` block and
 * fills the chosen skin's shell. NO LLM, NO fabrication — every value comes from a model
 * field (Brain-Factory rule #2). It EXTENDS the existing `renderEmailTemplate` /
 * `renderHtmlTemplate` seam (RULE 3 C2 — no new mandatory gate).
 *
 * The activation `reportToEmailHtml` is now a thin wrapper over this primitive; the
 * email output is byte-identical to the Phase-1 green render (golden-equivalence test in
 * `grounded-report.test.ts`). The body-building logic below was ported verbatim from the
 * pre-refactor `activation/render.ts`.
 */

import { renderEmailTemplate, brandThemeToTokens } from "@/lib/email/templates/render-template";
import { SWFL_TOKEN_DEFAULTS } from "@/lib/email/templates/token-defaults";
import type { AssembledReport } from "./activation/snapshot";
import type { ActivationBrand, ReportDelta, MetricChange } from "./activation/types";

/**
 * General report scope — replaces the ZIP-hardcoded `primaryPlace/countyName/zip` triple
 * for downstream lanes. The activation lane maps its ZIP into `{ kind:"zip", … }`; the
 * recurring lane carries `scope_kind/value/topic`, which folds straight into this.
 */
export interface GroundedReportScope {
  kind: "zip" | "place" | "county" | "region";
  /** The scope's identifying value (a ZIP string, a place name, a county name…). */
  value: string;
  /** The data grain held, e.g. "zip", "county", "region". */
  grain: string;
  /** Optional topical focus (e.g. "flood", "permits") when the report is narrowed. */
  topic?: string;
}

/** The ONE grounded report shape every lane produces/consumes (extends `AssembledReport`). */
export interface GroundedReportModel extends AssembledReport {
  /** The computed snapshot→now diff (today passed separately as `opts.delta`). */
  delta?: ReportDelta | null;
  /** General scope; the activation lane maps its ZIP fields into this. */
  scope: GroundedReportScope;
  /** Single CTA target (was `RenderReportOptions.ctaUrl`). */
  cta_url?: string;
  /** Absolute site origin for the "view full report" link (was `RenderReportOptions.siteOrigin`). */
  site_origin?: string;
}

/** What `renderGroundedReport` needs that is NOT part of the grounded data itself. */
export interface RenderGroundedOptions {
  /** Which shell to fill. The email skin is live; the pdf/doc skin lands in Task 4. */
  skin: "email" | "pdf";
  /** White-label brand (null = SWFL house brand). */
  brand?: ActivationBrand | null;
}

const MAX_METRIC_ROWS = 6;
const MAX_LINES = 5;

const GOOD = "#5bc97a"; // mangrove — favorable change (reads on the dark shell)
const BAD = "#e08158"; // coral — unfavorable change
const NEUTRAL = "#b8b4a8"; // warm dim — flat / unknown

const DEFAULT_CTA_URL = "https://www.swfldatagulf.com/pricing";
const DEFAULT_SITE_ORIGIN = "https://www.swfldatagulf.com";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// NOTE: This render path is currently URL-free (no citation hrefs emitted).
// If source links are added in future, route them through lib/citations/clean-url.ts
// cleanCitation() — do NOT render raw source_url directly in email HTML.
/** Light markdown → email-safe HTML for a scrubbed dossier line. */
function lineToHtml(text: string, primary: string): string {
  const paras = text.split(/\n\n+/).map((block) => {
    let h = esc(block.trim());
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/`([^`]+?)`/g, `<code style="font-size:11px;color:${primary};">$1</code>`);
    h = h.replace(/_(.+?)_/g, "<em>$1</em>");
    h = h.replace(/\n/g, "<br/>");
    return `<p style="margin:0 0 8px 0;font-size:13px;line-height:1.55;">${h}</p>`;
  });
  return paras.join("");
}

/** YYYYMMDD inside a freshness token → "Jun 10" (null when unparseable). */
function tokenDate(token: string | null): string | null {
  if (!token) return null;
  const m = token.match(/(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatChangeValue(v: number | null, unit: string | undefined): string {
  if (v === null) return "—";
  // Heuristic: the metric's own display string is the source of truth, but the delta
  // works on raw numbers, so format minimally here.
  return `${v.toLocaleString("en-US")}${unit ?? ""}`;
}

function metricChangeRow(c: MetricChange): string {
  let color = NEUTRAL;
  if (c.favorable === true) color = GOOD;
  else if (c.favorable === false) color = BAD;

  let detail: string;
  if (c.direction === "appeared") detail = `now reported: ${formatChangeValue(c.to, c.unit)}`;
  else if (c.direction === "disappeared") detail = `no longer reported`;
  else {
    const arrow = c.direction === "up" ? "▲" : "▼";
    detail = `${formatChangeValue(c.from, c.unit)} → ${formatChangeValue(c.to, c.unit)} <span style="color:${color};">${arrow}</span>`;
  }
  return `<tr><td style="padding:4px 0;font-size:13px;color:#f0ede6;"><strong>${esc(c.label)}</strong></td><td align="right" style="padding:4px 0;font-size:13px;color:#f0ede6;">${detail}</td></tr>`;
}

function deltaBlock(delta: ReportDelta, accent: string): string {
  const surface = "rgba(255,255,255,0.06)";
  const since = tokenDate(delta.freshness_token_prev);
  const sincePhrase = since ? ` since ${esc(since)}` : "";

  if (!delta.has_change) {
    // No-change is first-class: lead with the moved freshness token, never a fake change.
    const reVerified = tokenDate(delta.freshness_token_current);
    return (
      `<div style="background-color:${surface};border-left:3px solid ${accent};padding:12px 16px;border-radius:4px;">` +
      `<p style="margin:0;font-size:13px;line-height:1.55;color:#f0ede6;">` +
      `<strong>Re-verified${reVerified ? ` ${esc(reVerified)}` : ""}.</strong> ` +
      `We re-pulled every figure for your area and nothing material moved this cycle — here's where it stands.` +
      `</p></div>`
    );
  }

  const rows: string[] = [];
  for (const c of delta.metric_changes) rows.push(metricChangeRow(c));
  const signals = delta.signal_changes
    .map(
      (s) =>
        `<li style="font-size:13px;line-height:1.55;margin:0 0 4px 0;color:#f0ede6;">New activity: <strong>${esc(s.label)}</strong></li>`,
    )
    .join("");

  return (
    `<div style="background-color:${surface};border-left:3px solid ${accent};padding:14px 16px;border-radius:4px;">` +
    `<p style="margin:0 0 8px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${accent};">What changed${sincePhrase}</p>` +
    (rows.length
      ? `<table width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>`
      : "") +
    (signals ? `<ul style="margin:8px 0 0 0;padding-left:18px;">${signals}</ul>` : "") +
    `</div>`
  );
}

/** Options the activation lane folds into the model when adapting an `AssembledReport`. */
export interface AssembledToModelOptions {
  delta?: ReportDelta | null;
  ctaUrl?: string;
  siteOrigin?: string;
}

/**
 * Map an activation `AssembledReport` (+ render opts) into the general grounded model.
 * The ZIP fields become a `kind:"zip"` scope; everything else is carried verbatim, so
 * the email render is byte-identical to the pre-spine output.
 */
export function assembledReportToModel(
  report: AssembledReport,
  opts: AssembledToModelOptions = {},
): GroundedReportModel {
  return {
    ...report,
    delta: opts.delta ?? null,
    scope: { kind: "zip", value: report.zip, grain: "zip" },
    cta_url: opts.ctaUrl,
    site_origin: opts.siteOrigin,
  };
}

/**
 * Render a grounded report into the chosen skin's HTML shell. Deterministic; every
 * value comes from `model`. Does NOT inject the unsubscribe token — that is the
 * email lane's concern (the wrapper adds it; PDF never shows it).
 */
export async function renderGroundedReport(
  model: GroundedReportModel,
  opts: RenderGroundedOptions,
): Promise<string> {
  const brand = opts.brand ?? null;
  const accent = brand?.accent || SWFL_TOKEN_DEFAULTS.ACCENT;
  const ctaUrl = model.cta_url ?? DEFAULT_CTA_URL;
  const origin = model.site_origin ?? DEFAULT_SITE_ORIGIN;

  // PLACE/COUNTY derive from the model's display fields. The ZIP lane is byte-identical to
  // the Phase-1 activation render (golden-equivalence); non-ZIP lanes (briefcase email at
  // place/county/region grain) read `model.primaryPlace`/`countyName`/`scope`.
  const isZip = model.scope.kind === "zip";
  const place = model.primaryPlace ?? `ZIP ${model.zip}`;
  // Region de-dupes: PLACE already reads "Southwest Florida", so the subtitle carries a
  // footprint descriptor instead of repeating it.
  const county =
    model.scope.kind === "region"
      ? "6-county region"
      : model.countyName
        ? `${model.countyName} County`
        : "Southwest Florida";

  // Hero = the first key figure, as a 0-or-1 repeat (empty metrics → no hero number).
  const hero = model.metrics.length
    ? [{ HERO_VALUE: esc(model.metrics[0].display), HERO_LABEL: esc(model.metrics[0].label) }]
    : [];

  const metrics = model.metrics.slice(0, MAX_METRIC_ROWS).map((m) => ({
    M_LABEL: esc(m.label),
    M_VALUE: esc(m.display),
  }));

  const reads = model.lines.slice(0, MAX_LINES).map((l) => ({
    READ_HTML: lineToHtml(l.text, accent),
  }));

  // Single-value tokens (content + brand). brandThemeToTokens omits absent keys, so
  // Object.assign keeps every token value a string (no undefined leaks into the map).
  const asOf = tokenDate(model.freshness_token ?? null);
  const tokens: Record<string, string | number> = {
    PLACE: esc(place),
    COUNTY: esc(county),
    // The ZIP lane links to the live ZIP report; any other grain links to the site home so
    // we never emit a broken `/r/zip-report/` URL with no ZIP.
    REPORT_URL: esc(isZip ? `${origin}/r/zip-report/${model.zip}` : origin),
  };
  Object.assign(
    tokens,
    brandThemeToTokens(
      brand
        ? {
            primary: brand.primary ?? null,
            accent: brand.accent ?? null,
            logoUrl: brand.logoUrl ?? null,
          }
        : null,
    ),
  );
  if (brand?.companyName) tokens.COMPANY_NAME = brand.companyName;

  const delta = model.delta ? deltaBlock(model.delta, accent) : "";

  // The "· ZIP nnnnn" subtitle suffix + the "nnnnn" in the report link render ONLY for a
  // true ZIP scope. A 1-row repeat is byte-identical to the pre-change shell (golden test);
  // an empty one drops the suffix cleanly — no dangling "ZIP ", no broken link.
  const zipsuffix = isZip ? [{ ZIP: esc(model.zip) }] : [];

  // freshness: shown only when we have a parseable date (hides ugly empty line otherwise)
  const freshness = asOf ? [{ AS_OF_DATE: asOf }] : [];
  // cta: shown only when a real URL is provided; empty string = no button
  const cta = ctaUrl ? [{ CTA_URL: esc(ctaUrl) }] : [];

  return renderSkin(opts.skin, tokens, { hero, metrics, reads, zipsuffix, freshness, cta }, delta);
}

/**
 * Fill the skin's shell. The email skin is the live target. The pdf/doc skin (the
 * `window.print()` path) lands in Task 4 with its own `doc/doc-report` shell + a
 * doc-render wrapper; until then it renders the email shell so upstream lanes can
 * integrate against the final signature.
 */
async function renderSkin(
  skin: "email" | "pdf",
  tokens: Record<string, string | number>,
  repeats: Record<string, Array<Record<string, string | number>>>,
  delta: string,
): Promise<string> {
  // The pdf/doc skin fills the letter-size `doc-report` shell (no CTA, print CSS); the
  // email skin fills the live `report` shell. Both share these exact tokens + repeats.
  const slug = skin === "pdf" ? "doc-report" : "report";
  return renderEmailTemplate(slug, tokens, { repeats, delta });
}
