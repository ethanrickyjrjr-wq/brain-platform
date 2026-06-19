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
import type { SignificantChange } from "@/lib/signals/types";

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
  /** True when the newest item freshness token is newer than what the user last saw. */
  freshnessIsNew?: boolean;
  hasEmailSchedule?: boolean;
  /** Live branding — always re-read from projects.branding, never a stale snapshot. */
  branding?: { agentName?: string; brokerage?: string; license?: string };
  /** Recent significant activity (last 30d, sig ≥ 5), pre-formatted for the AI. */
  recentActivity?: string[];
  /** Metric changes that cleared the significance threshold since the snapshot was filed.
   *  Top 3 by priority. The AI leads with these when present. */
  significantChanges?: SignificantChange[];
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
  if (asOf) {
    if (p.freshnessIsNew) s += ` (NEW data since your last visit, as of ${asOf})`;
    else s += ` (filed data as of ${asOf})`;
  }

  // Live branding — always current, never a snapshot. If the agent name changed an hour
  // ago, the AI sees the new name on the next message. Never omit if present.
  const b = p.branding;
  if (b?.agentName) {
    const parts = [b.agentName, b.brokerage, b.license].filter(Boolean);
    s += `. Agent: ${parts.join(" · ")}`;
  }

  // Recent significant activity — gives the AI a "what happened since you were last here"
  // without requiring it to ask. Capped at 3 so it doesn't crowd the context.
  const activity = p.recentActivity?.slice(0, 3) ?? [];
  if (activity.length > 0) s += `. Recent: ${activity.join("; ")}`;

  // Significant metric changes — pre-written delta descriptions so the AI can lead
  // with specifics ("median sale prices dropped 4.2%") not generics ("new data landed").
  const changes = p.significantChanges ?? [];
  if (changes.length > 0) {
    const descriptions = changes.map((c) => `${c.label} ${c.delta_description}`).join("; ");
    s += `. Changes since last visit: ${descriptions}`;
  }

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
    freshnessIsNew: digest.freshnessChangedSinceSeen || undefined,
    hasEmailSchedule: digest.schedules.length > 0,
    branding:
      digest.branding && Object.keys(digest.branding).length > 0 ? digest.branding : undefined,
    recentActivity: digest.recentActivity?.length > 0 ? digest.recentActivity : undefined,
    significantChanges:
      digest.significantChanges?.length > 0 ? digest.significantChanges.slice(0, 3) : undefined,
  };
}
