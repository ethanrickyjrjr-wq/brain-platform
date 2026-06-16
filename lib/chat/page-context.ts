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

/** Normalize: strip a single trailing slash (except root); empty → "/". */
function norm(pathname: string): string {
  const p = (pathname || "/").split("?")[0].split("#")[0];
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p || "/";
}

const CHARTS_DESC =
  "the Market Trends charts page (median home value, median rent, RSW airport " +
  "passenger volume, home-value year-over-year growth, and a luxury-vs-starter " +
  "price index across Cape Coral, Fort Myers, and Naples)";

export function describePage(pathname: string): string {
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

  // Projects — list vs. a single project workspace.
  if (p === "/project") return "their projects list";
  if (p.startsWith("/project/")) return "one of their projects";

  // Fallback: still place the user by path so no page is blind.
  return `the ${p} page`;
}
