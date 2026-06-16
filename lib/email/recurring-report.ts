/**
 * lib/email/recurring-report.ts — the recurring lane's adoption of the convergence
 * spine (Task 3).
 *
 * A `template_id:"report"` schedule renders the GROUNDED report (`renderGroundedReport`,
 * the Task-2 spine) with FRESH data every run — not the digest body, and never the
 * body-less report shell Phase 1 left behind when it removed the `[ BODY TEXT ]` slot
 * from `email/email-report.html`.
 *
 * Fresh data each run = `assembleActivationReport(scope)` (`activation/snapshot.ts`),
 * which re-pulls the per-ZIP housing/flood/dossier from the brains on every call; its
 * `AssembledReport` is mapped into the spine's `GroundedReportModel` via
 * `assembledReportToModel`. Pure + dependency-injected so it unit-tests with no DB,
 * no network, no disk — the runner (`scripts/email/run-schedules.mts`) binds the real
 * assembler + renderers.
 *
 * GRAIN: a "report" is ZIP-grain by construction (the assembler is ZIP-keyed; the
 * build→schedule bridge writes `scope_kind:"zip"`). A non-ZIP / out-of-footprint /
 * empty scope returns `null` → the caller falls back to the global digest. We never
 * invent a sub-grain number for a place/county (the no-invention floor).
 */

import type { ScheduleRow } from "./scheduler";
import type { GroundedReportModel } from "./grounded-report";
import { assembledReportToModel } from "./grounded-report";
import type { AssembledReport } from "./activation/snapshot";
import type { ActivationScope } from "./activation/types";
import type { TemplateSlug } from "./templates/template-registry";
import { brandThemeToTokens } from "./templates/render-template";
import type { BrandTheme } from "@/lib/deliverable/brand-theme";

/** I/O seam for `buildReportModel` — the runner binds `assembleActivationReport`. */
export interface ReportContentDeps {
  /** Fresh grounded assembly for a ZIP scope (binds to `assembleActivationReport`). */
  assembleReport: (scope: ActivationScope) => Promise<AssembledReport>;
  log: (line: string) => void;
}

/**
 * The shared ZIP-only scope guard for the grounded-report lanes (recurring digest +
 * briefcase email/PDF). Normalizes EXACTLY as the recurring lane always has — trim +
 * lowercase the kind, trim the value — so the two lanes can never diverge on a
 * `"ZIP"` / `" 33901 "` scope. Returns the trimmed ZIP, or null for any non-ZIP /
 * blank scope. The ONE place this rule lives; both lanes import it (no reimplementation).
 */
export function resolveReportZip(
  kind: string | null | undefined,
  value: string | null | undefined,
): string | null {
  const k = (kind ?? "").trim().toLowerCase();
  const z = (value ?? "").trim();
  if (k !== "zip" || !z) return null;
  return z;
}

/**
 * Build a FRESH `GroundedReportModel` for a `template_id:"report"` row, or `null` to
 * fall back to the global digest. ZIP scope only; a non-ZIP scope, a blank value, an
 * out-of-footprint ZIP, or an in-scope ZIP with no grounded content (zero metrics AND
 * zero lines) all return `null` — never invent below grain.
 */
export async function buildReportModel(
  row: ScheduleRow,
  deps: ReportContentDeps,
): Promise<GroundedReportModel | null> {
  const zip = resolveReportZip(row.scope_kind, row.scope_value);

  // A "report" is ZIP-grain. A place/county/region/blank scope has no honest
  // single-ZIP report → fall back to the global digest (never resolve to a
  // "representative" ZIP, which would invent precision).
  if (!zip) {
    deps.log(
      `[recurring-report] schedule ${row.id}: non-ZIP report scope (${row.scope_kind}:${row.scope_value}) → global digest fallback`,
    );
    return null;
  }

  const report = await deps.assembleReport({ zip });

  // Out-of-footprint (the 6-county MOAT gate, enforced inside the assembler) or an
  // in-scope ZIP that held no grounded content this run → fall back, never render an
  // empty report shell.
  if (!report.in_scope || (report.metrics.length === 0 && report.lines.length === 0)) {
    deps.log(
      `[recurring-report] schedule ${row.id}: ZIP ${zip} ${report.in_scope ? "held no grounded content" : "out of footprint"} → global digest fallback`,
    );
    return null;
  }

  // delta defaults to null inside assembledReportToModel: a recurring send stores no
  // prior snapshot, so it has nothing honest to diff against (no manufactured change).
  return assembledReportToModel(report);
}

/**
 * Customer-clean subject for a grounded report send, derived from the model (no LLM,
 * no jargon, no internal ids). Prefers the resolved place name; falls back to the ZIP.
 */
export function reportSubject(model: GroundedReportModel): string {
  const place = model.primaryPlace ?? `ZIP ${model.zip}`;
  return `${place} — your area report`;
}

/** Render seam for `renderRecurringHtml` — the runner binds the spine + template lane. */
export interface RecurringRenderDeps {
  /** The Task-2 spine: `renderGroundedReport(model, {skin:"email", brand})`. */
  renderGrounded: (model: GroundedReportModel, brand: BrandTheme | null) => Promise<string>;
  /** The plain template lane: `renderEmailTemplate(slug, tokens, {body, chart})`. */
  renderTemplate: (
    slug: TemplateSlug,
    body: string,
    chart?: string,
    tokens?: Record<string, string | number>,
  ) => Promise<string>;
  /** Slug to use when a "report" row fell back (the report shell has no body slot). */
  defaultSlug: TemplateSlug;
}

/**
 * Route a built content to HTML. A grounded `model` → the spine. Otherwise the plain
 * template lane — EXCEPT a `"report"` slug WITHOUT a model means the report fell back
 * to the digest body, and the report shell has no `[ BODY TEXT ]` slot (Phase 1 removed
 * it), so rendering through it would emit an empty masthead+footer. Use `defaultSlug`
 * instead. This is the slot-break guard Task 3 exists for. `tokens` (the data-driven
 * digest-hero values) flow to the plain template lane unchanged.
 *
 * `brand` (the schedule owner's white-label theme, or null for the SWFL house brand)
 * is applied uniformly: the grounded renderer takes it directly; the plain lane gets
 * its `PRIMARY`/`ACCENT`/`LOGO_URL` tokens merged OVER the content tokens (so brand
 * colors + logo win, while content/semantic defaults remain).
 */
export async function renderRecurringHtml(
  args: {
    slug: TemplateSlug;
    body: string;
    chart?: string;
    model?: GroundedReportModel | null;
    tokens?: Record<string, string | number>;
    brand?: BrandTheme | null;
  },
  deps: RecurringRenderDeps,
): Promise<string> {
  const brand = args.brand ?? null;
  if (args.model) return deps.renderGrounded(args.model, brand);
  const slug = args.slug === "report" ? deps.defaultSlug : args.slug;
  const tokens = brand ? { ...args.tokens, ...brandThemeToTokens(brand) } : args.tokens;
  return deps.renderTemplate(slug, args.body, args.chart, tokens);
}
