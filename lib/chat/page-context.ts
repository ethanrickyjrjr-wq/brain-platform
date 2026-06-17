/**
 * describePage — map the current pathname to a plain-English "where the user is"
 * clause. Sent to the chat backend (alongside the messages) so the assistant
 * knows what the user is looking at on EVERY page, not just /r/*. Pure: no DOM,
 * no router, no Date — directly unit-testable.
 *
 * The return slots into "The user is currently on {clause}." so each value reads
 * as a place. Every route returns a non-empty clause; an unknown route still
 * places the user by its path (no page is blind). This is page-LEVEL context —
 * per-page-type depth (which chart, which toggles) is a deferred follow-up.
 */

import { asOfFromToken } from "@/lib/project/as-of";
import { projectIdFromPath } from "@/lib/briefcase/pill-mount";
import type { ProjectDigest } from "@/lib/project/digest";

/** Normalize: strip a single trailing slash (except root); empty → "/". */
function norm(pathname: string): string {
  const p = (pathname || "/").split("?")[0].split("#")[0];
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p || "/";
}

/**
 * Compact project context (Piece 2 §D) — what the open project IS, so the analyst
 * answers at the project's place/grain and can reference what's already filed. A small
 * shape (not the full digest) so this module stays decoupled + plainly testable; the pill
 * maps the live digest into it at send time. Rides the existing `pageContext` field
 * (framed as DATA, clamped to 600 chars by the route) — no new request field, no route or
 * system-prompt change.
 */
export interface ProjectPageContext {
  title: string;
  scope?: { zip?: string; place?: string; topic?: string };
  itemCount?: number;
  kindCounts?: Record<string, number>;
  freshnessToken?: string;
  hasEmailSchedule?: boolean;
}

/** Singular kind → display noun (Piece 2 §D contents summary). */
const KIND_NOUN: Record<string, string> = {
  metric: "metric",
  chart: "chart",
  report: "report",
  qa: "answer",
  source: "source",
  note: "note",
  table_slice: "table",
  file: "file",
  frame: "chart",
};

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "3 metrics, 1 report" from kindCounts (frame folds into chart), in a stable order. */
function describeContents(kindCounts: Record<string, number>): string {
  const merged: Record<string, number> = {};
  for (const [kind, n] of Object.entries(kindCounts)) {
    const noun = KIND_NOUN[kind] ?? kind;
    merged[noun] = (merged[noun] ?? 0) + n;
  }
  return Object.entries(merged)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([noun, n]) => plural(n, noun))
    .join(", ");
}

function describeProject(p: ProjectPageContext): string {
  let s = `their project "${p.title}"`;
  const place = p.scope?.place;
  const zip = p.scope?.zip;
  if (place) s += ` about ${place}${zip ? ` (ZIP ${zip})` : ""}`;
  else if (zip) s += ` about ZIP ${zip}`;
  if (p.scope?.topic) s += `, focused on ${p.scope.topic}`;

  if (p.itemCount && p.kindCounts)
    s += ` — it holds ${plural(p.itemCount, "filed item")} (${describeContents(p.kindCounts)})`;
  else if (p.itemCount) s += ` — it holds ${plural(p.itemCount, "filed item")}`;
  else s += " — nothing filed in it yet";

  // Status-neutral: the digest's schedules include active AND paused (only "stopped" is
  // excluded upstream), so don't claim "active" for what might be paused.
  if (p.hasEmailSchedule) s += "; it has an email schedule";
  const asOf = asOfFromToken(p.freshnessToken);
  if (asOf) s += ` (filed data as of ${asOf})`;
  return s;
}

const CHARTS_DESC =
  "the Market Trends charts page (median home value, median rent, RSW airport " +
  "passenger volume, home-value year-over-year growth, and a luxury-vs-starter " +
  "price index across Cape Coral, Fort Myers, and Naples)";

export function describePage(pathname: string, project?: ProjectPageContext): string {
  const p = norm(pathname);

  if (p === "/") return "the SWFL Data Gulf home page";
  if (p === "/charts" || p.startsWith("/charts/")) return CHARTS_DESC;
  if (p === "/welcome")
    return "the welcome overview page (arrived from a branded market-data email)";
  if (p === "/ask") return "the Ask page";
  if (p === "/map") return "the SWFL map page";
  if (p === "/showcase") return "the template showcase page";
  if (p === "/billing") return "the pricing & billing page";
  if (p === "/data-intel") return "the data-intelligence page";
  if (p === "/alerts" || p.startsWith("/alerts/")) return "their alerts";

  // Reports under /r/* — pull the meaningful identifier out of the path.
  if (p.startsWith("/r/")) {
    const rest = p.slice("/r/".length);
    const [section, param] = rest.split("/");
    if (section === "zip-report")
      return param ? `the ZIP ${param} market report` : "a ZIP market report";
    if (section === "cre-swfl")
      return param ? `the ${param} commercial-corridor report` : "a commercial-corridor report";
    if (section === "source") return "a data-source / provenance page";
    if (section === "method") return "a methodology page";
    if (section === "search") return "the report search page";
    // /r/<slug> (e.g. master) — the slug IS the report.
    return section ? `the ${section} report` : "a report";
  }

  // Built deliverable (public share) vs. a saved card/chart.
  if (p.startsWith("/p/")) return "a built deliverable they're viewing";
  if (p.startsWith("/c/")) return "a saved card / chart they're viewing";

  // Projects — list vs. a single project workspace. On a single project, name it +
  // its scope + what's filed (Piece 2 §D) so the analyst answers at the project's grain.
  if (p === "/project") return "their projects list";
  if (p.startsWith("/project/"))
    return project ? describeProject(project) : "one of their projects";

  // Fallback: still place the user by path so no page is blind.
  return `the ${p} page`;
}

/**
 * Map the live context-bus digest to the compact ProjectPageContext for §D — but ONLY
 * when the digest is for the project the path currently names. The projectId guard is the
 * stale-leak defense: the module store persists across route changes, so during an A→B
 * switch `getAiContext()` can still hold A's digest while the path is already B; returning
 * undefined then keeps A's context out of B's chat. Pure → directly unit-testable.
 */
export function projectPageContextForPath(
  path: string,
  digest: ProjectDigest | null,
): ProjectPageContext | undefined {
  const pid = projectIdFromPath(path);
  if (!pid || !digest || digest.projectId !== pid) return undefined;
  return {
    title: digest.title,
    scope: digest.scope,
    itemCount: digest.itemCount,
    kindCounts: digest.kindCounts,
    freshnessToken: digest.freshnessToken,
    hasEmailSchedule: digest.schedules.length > 0,
  };
}
