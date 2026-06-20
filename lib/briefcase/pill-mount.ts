import type { PillPage } from "./visits";

/**
 * THE single root for the /project/[id] id-extraction regex (Piece 2). Both the
 * pill's page context (below) and `BriefcaseChat`'s schedule card read it — keep it
 * one place so the pattern can never drift between the two. `/project` (the list,
 * no id) returns null and stays generic; only `/project/[id]` is a project page.
 */
export function projectIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/project\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Map a pathname to the pill's page context (drives A-7 context-aware prompts). */
export function pageFromPath(pathname: string): PillPage {
  if (pathname === "/") return { kind: "home" };
  if (pathname === "/charts" || pathname.startsWith("/charts/")) return { kind: "charts" };
  if (pathname.startsWith("/r/")) return { kind: "report" };
  const projectId = projectIdFromPath(pathname);
  if (projectId) return { kind: "project", projectId };
  return { kind: "generic" };
}

/**
 * The root standalone pill renders everywhere EXCEPT on /r/* while the highlighter
 * is enabled — there the per-page BRIDGED pill (rendered inside HighlighterLayer,
 * which knows the reportId and bridges the report thread) takes over, so the
 * standalone one suppresses to keep exactly ONE visible pill. When the highlighter
 * flag is OFF, no bridged pill mounts, so the standalone one shows on /r/* as the
 * fallback (closes the zero-pill edge).
 */
export function shouldRenderStandalone(pathname: string, highlighterEnabled: boolean): boolean {
  // Finished deliverables (/p/*) AND iframe fragments (/embed/*) stay client-clean —
  // they may be white-labeled and embedded in a broker's own site, so no SWFL chrome.
  // This is the parity twin of SHELL_HIDDEN_PREFIXES in components/nav/nav-config.ts
  // (SiteShell + SiteFooter suppress on the same prefixes) — change one, change both.
  // It also keeps the Piece 1 §D "open big" modal — an <iframe src="/p/[id]"> — free
  // of a stray floating pill inside the overlay.
  if (pathname.startsWith("/p/") || pathname.startsWith("/embed/")) return false;
  const onReport = pathname.startsWith("/r/");
  return !(onReport && highlighterEnabled);
}
