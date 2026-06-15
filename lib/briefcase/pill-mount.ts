import type { PillPage } from "./visits";

/** Map a pathname to the pill's page context (drives A-7 context-aware prompts). */
export function pageFromPath(pathname: string): PillPage {
  if (pathname === "/") return { kind: "home" };
  if (pathname === "/charts" || pathname.startsWith("/charts/")) return { kind: "charts" };
  if (pathname.startsWith("/r/")) return { kind: "report" };
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
  const onReport = pathname.startsWith("/r/");
  return !(onReport && highlighterEnabled);
}
