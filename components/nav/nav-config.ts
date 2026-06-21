import type { User } from "@supabase/supabase-js";

/**
 * Pure nav data + helpers for the unified SiteShell (B1). No "use client" — these
 * are plain functions/constants so they unit-test deterministically and so the
 * downstream waves can extend them WITHOUT touching the big client shell component:
 * B2 turns NAV_GROUPS into the grouped `Explore ▾`, B5 appends a Social/Send entry,
 * B4 repoints homeHref. They are re-exported from SiteShell.tsx so the README
 * cross-build seam ("B1 exposes NAV_GROUPS, homeHref, SHELL_HIDDEN_PREFIXES")
 * resolves from `@/components/nav/SiteShell` as written.
 */

export interface NavItem {
  label: string;
  /** Present on a leaf (a real destination) and on simple top-level tabs. A pure
   *  group HEADER (Explore) has no href of its own — it only opens its children. */
  href?: string;
  /** Present on a GROUP (Explore). The disclosure renders these as the dropdown. */
  children?: NavItem[];
}

/**
 * Primary app nav — shown in the solid app-variant bar, and to logged-out visitors
 * as proof-of-product (every route here is public per middleware.ts; only /project*
 * is auth-gated, and its page handles the redirect). Labels are plain verbs/nouns
 * (NN/g: unfamiliar nomenclature is a top cause of navigation cognitive strain).
 *
 * B2 grouped the flat tail under `Explore ▾` so the bar stays compact, not a flat
 * row of every surface. Current layout (after the nav+map follow-ups, commits
 * 7a37725 + b013ad2): the marquees Charts, Maps, Showcase, Projects, Alerts stay
 * top-level; Explore holds only Search (`/r`). Maps was PROMOTED out of the Explore
 * dropdown to a static top-level tab, and the old ZIP Reports entry (`/r/search`)
 * was retired. `/data-intel` is deliberately NOT here (internal-only — B6).
 *
 * The deterministic guards in `nav-config.test.ts` encode this exact shape — change
 * NAV_GROUPS and update that test in the SAME commit, or CI goes red.
 */
export const NAV_GROUPS: NavItem[] = [
  {
    label: "Explore",
    children: [{ label: "Search", href: "/r" }],
  },
  { label: "Charts", href: "/charts" },
  { label: "Maps", href: "/map" },
  { label: "Showcase", href: "/showcase" },
  { label: "Projects", href: "/project" },
  { label: "Alerts", href: "/alerts" },
];

/**
 * Prefixes where NO chrome renders — the shell AND the global footer both suppress
 * here. `/p/` (trailing slash so it can't match `/privacy` or `/project`) + `/embed/`
 * stay white-label clean (a finished deliverable may carry a broker's brand, not SWFL
 * chrome); `/login` + `/auth` are focused auth screens.
 *
 * The `/p/` rule is the PARITY TWIN of `lib/briefcase/pill-mount.ts`
 * (`shouldRenderStandalone`, which suppresses the floating pill on `/p/*`). Change one,
 * change both — or a stray footer/pill leaks into a client-facing deliverable.
 *
 * `/login` and `/auth` carry no trailing slash on purpose: there is no bare `/auth`
 * page, so `/auth` must prefix-match the real sub-routes (`/auth/callback`,
 * `/auth/auth-code-error`). `/p/` and `/embed/` keep the slash to avoid collisions
 * (`/p/` vs `/privacy`/`/project`).
 *
 * NOTE: `/` is intentionally NOT hidden. Home now renders the shell's home variant
 * (the old GlobalNav hid on `/`; the old Header was home-only — B1 unifies them).
 */
export const SHELL_HIDDEN_PREFIXES = ["/login", "/auth", "/embed/", "/p/"] as const;

export function isHiddenPath(pathname: string | null): boolean {
  if (!pathname) return true;
  return SHELL_HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Home target for the logo. Logged-OUT → `/` (the marketing funnel, untouched).
 * Signed-IN → `/project`, the de-facto home base — its header carries quick links to
 * Charts / Search / Alerts / Contacts (B4), so a logged-in user's logo lands them on
 * their toolset, never back on the funnel. Both SiteShell variants link their logo
 * here, so this one branch repoints both.
 */
export function homeHref(user: User | null): string {
  return user ? "/project" : "/";
}

/**
 * Active-tab test: a tab is active when the path IS its href or sits under it.
 * `/` is special-cased to exact-match (else it would match every path). Anchored on
 * a segment boundary so `/r` does NOT light up on `/report` or `/rsomething`.
 */
export function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Active test for a nav ITEM (leaf or group). A group (Explore) is active when the
 * path sits under ANY of its children — so standing on `/map` lights the `Explore ▾`
 * marker even though Maps lives inside the dropdown. A leaf falls back to `isActive`.
 */
export function isItemActive(pathname: string | null, item: NavItem): boolean {
  if (item.children?.length) return item.children.some((c) => isItemActive(pathname, c));
  return item.href ? isActive(pathname, item.href) : false;
}

/**
 * Inside an open group dropdown, return the single child href that should read as
 * active — the LONGEST matching href wins. Without this, `/r/search` would light both
 * "Search" (`/r`) and "ZIP Reports" (`/r/search`), since the former is a prefix of
 * the latter. Returns null when no child matches.
 */
export function activeChildHref(pathname: string | null, children: NavItem[]): string | null {
  let best: string | null = null;
  for (const c of children) {
    if (c.href && isActive(pathname, c.href) && (!best || c.href.length > best.length)) {
      best = c.href;
    }
  }
  return best;
}
