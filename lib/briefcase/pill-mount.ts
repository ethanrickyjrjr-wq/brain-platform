import type { PillPage } from "./visits";
import { isHiddenPath } from "@/components/nav/nav-config";

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
 * Public marketing/landing pages that keep the site nav + footer but show NO AI
 * surfaces — no floating pill (so no first-visit auto-open) and no highlighter (no
 * coachmark/ticker). `/for-agents` is the MLS/Bridge reviewer landing page: it must
 * read as a clean product page and must NEVER pop the consumer AI funnel at someone
 * evaluating our data license. This is DISTINCT from SHELL_HIDDEN_PREFIXES (which also
 * drops nav + footer) — here the page chrome stays, only the AI chrome is suppressed.
 * Both AI surfaces read this one predicate so they can never drift apart.
 */
export const AI_CHROME_FREE_PREFIXES = ["/for-agents"] as const;

export function isAiChromeFree(pathname: string | null): boolean {
  if (!pathname) return false;
  return AI_CHROME_FREE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * The root standalone pill renders everywhere EXCEPT on /r/* while the highlighter
 * is enabled — there the BRIDGED pill (AppShell renders it when the /r/* page's
 * ReportHighlightBridge has published a report context, bridging the report thread)
 * takes over, so the standalone one suppresses to keep exactly ONE visible pill. When
 * the highlighter flag is OFF, no bridge mounts → no report context → the standalone
 * pill shows on /r/* as the fallback (closes the zero-pill edge).
 */
export function shouldRenderStandalone(pathname: string, highlighterEnabled: boolean): boolean {
  // Finished deliverables (/p/*) AND iframe fragments (/embed/*) stay client-clean —
  // they may be white-labeled and embedded in a broker's own site, so no SWFL chrome.
  // This is the parity twin of SHELL_HIDDEN_PREFIXES in components/nav/nav-config.ts
  // (SiteShell + SiteFooter suppress on the same prefixes) — change one, change both.
  // It also keeps the Piece 1 §D "open big" modal — an <iframe src="/p/[id]"> — free
  // of a stray floating pill inside the overlay.
  if (pathname.startsWith("/p/") || pathname.startsWith("/embed/")) return false;
  // Clean reviewer/marketing pages keep nav + footer but no AI pill (no funnel pop).
  if (isAiChromeFree(pathname)) return false;
  const onReport = pathname.startsWith("/r/");
  return !(onReport && highlighterEnabled);
}

/**
 * Mount gate for the unified Highlighter (`GlobalHighlighter`), the SELECTION-triggered
 * twin of the click-triggered pill. It mounts wherever SWFL chrome renders — i.e.
 * everywhere EXCEPT the white-label/auth prefixes (`/p/`, `/embed/`, `/login`, `/auth`),
 * via the shared `isHiddenPath` so the clean set never drifts from the shell/footer.
 *
 * This is deliberately the BROADER of the two mount rules and is NOT a parity twin of
 * `shouldRenderStandalone`:
 *  - the PILL (`shouldRenderStandalone`) only hides on `/p/` + `/embed/` and still shows
 *    on `/login`/`/auth` (a logged-out visitor can pop the funnel there);
 *  - the HIGHLIGHTER also suppresses `/login` + `/auth` — there is nothing to highlight on
 *    an auth form.
 * It does NOT suppress `/r/*` — that is the highlighter's home, report-grounded.
 */
export function shouldMountHighlighter(pathname: string | null): boolean {
  // Clean reviewer/marketing pages (/for-agents) suppress the highlighter too, so the
  // first-touch coachmark + discovery ticker never appear on a data-license landing page.
  if (isAiChromeFree(pathname)) return false;
  return !isHiddenPath(pathname);
}

/**
 * One-shot auto-open gate for the standalone pill — the new-visitor funnel hook. The
 * pill pops itself open exactly once, only when ALL hold:
 *  - `firstVisit`  the anonymous visit counter is still 0 (it bumps to 1 the first time
 *                  the panel mounts), so this can fire at most once per browser, ever.
 *  - NOT `authed`  logged-in users are already past signup — never pop for them.
 *  - NOT `bridged` the bridged /r/* report dock keeps its manual-open behavior; this is
 *                  only the standalone prompts+examples panel.
 * Pure (no React, no DOM) so it's unit-tested directly. The caller passes RESOLVED auth
 * (it holds off while `useSession()` is still loading) and a freshly read visit flag.
 */
export function shouldAutoOpenPill(opts: {
  firstVisit: boolean;
  authed: boolean;
  bridged: boolean;
}): boolean {
  return opts.firstVisit && !opts.authed && !opts.bridged;
}
