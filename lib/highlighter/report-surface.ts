// The report-surface contract — the ONE place that says what kinds of report a
// page may mount the Ask-AI dock on, and how each kind's id is encoded into the
// single `reportId` string the dock carries to `/api/converse`.
//
// WHY THIS EXISTS (the 404 class): `reportId` used to be a bare free-form string.
// Plain `/r/[slug]` pages pass a brain slug (resolves to `brains/{slug}.md`), but
// the four SYNTHETIC report pages (`/r/zip-report`, `/r/cre-swfl/[corridor]`,
// `/r/method/[metric]`, `/r/source/[table]`) passed ids that map to NO brain file
// — so every dock question on them returned `Request failed (404)` from
// `fetchBrain` (BrainNotFoundError). Worse, those ids were mutually ambiguous
// (a corridor slug and a brain slug are both `[a-z0-9-]+`), so converse could not
// even tell which surface it was looking at.
//
// The fix is a CONTRACT: a page declares its surface KIND via `buildReportId`,
// converse decodes it via `parseReportId`, and a CI guard (report-surface.test.ts)
// asserts (a) every dock-mounting page uses `buildReportId` and (b) every kind is
// handled by the grounding resolver. A new page that mounts the dock with a raw
// id fails CI before it can 404 in prod.

/** The surfaces the Ask-AI dock may be mounted on. Extend here (one line) AND add
 *  a branch in `resolveReportGrounding` — the guard test fails if they drift. */
export const REPORT_SURFACE_KINDS = ["brain", "zip", "corridor", "method", "source"] as const;
export type ReportSurfaceKind = (typeof REPORT_SURFACE_KINDS)[number];

export interface ReportSurface {
  kind: ReportSurfaceKind;
  /** The kind-specific id: a brain slug, a 5-digit ZIP, a corridor slug, a metric
   *  slug, or a source-table name. */
  id: string;
}

// Namespace delimiter. A colon never appears in a brain slug, a ZIP, a corridor
// key (`corridorKey` → `[a-z0-9-]`), a metric slug (`[a-z0-9_]`), or a source
// table name, so it unambiguously separates the kind prefix from the id.
const NS = ":";

/**
 * Encode a surface into the `reportId` the page hands to `HighlighterLayer`.
 *
 * - `brain` stays BARE (`master`, `home-values-swfl`) — backward compatible with
 *   every existing `/r/[slug]` page and with `fetchBrain` callers that pass a slug.
 * - every other kind is namespaced (`zip:33931`, `corridor:us-41-fort-myers`,
 *   `method:cap_rate_median`, `source:rsw_passengers`).
 */
export function buildReportId(kind: ReportSurfaceKind, id: string): string {
  return kind === "brain" ? id : `${kind}${NS}${id}`;
}

/**
 * Decode a `reportId` back into its surface. The inverse of `buildReportId`.
 *
 * A string with no recognized `kind:` prefix is treated as a bare brain slug —
 * this is what keeps the plain `/r/[slug]` reports (and the MCP/email callers
 * that pass `"master"`) working unchanged.
 */
export function parseReportId(reportId: string): ReportSurface {
  const idx = reportId.indexOf(NS);
  if (idx !== -1) {
    const prefix = reportId.slice(0, idx);
    if ((REPORT_SURFACE_KINDS as readonly string[]).includes(prefix) && prefix !== "brain") {
      return { kind: prefix as ReportSurfaceKind, id: reportId.slice(idx + NS.length) };
    }
  }
  return { kind: "brain", id: reportId };
}
