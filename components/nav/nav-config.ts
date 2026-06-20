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
  href: string;
}

/**
 * Primary app tabs — shown in the solid app-variant bar, and to logged-out
 * visitors as proof-of-product (every route here is public per middleware.ts; only
 * /project* is auth-gated, and its page handles the redirect). B1 ships these FLAT;
 * B2 turns them into the grouped `Explore ▾` disclosure. Labels are plain verbs/nouns
 * (NN/g: unfamiliar nomenclature is a top cause of navigation cognitive strain).
 */
export const NAV_GROUPS: NavItem[] = [
  { label: "Search", href: "/r" },
  { label: "Charts", href: "/charts" },
  { label: "Showcase", href: "/showcase" },
  { label: "Projects", href: "/project" },
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
 * Home target for the logo. Default `/`; B4 repoints (e.g. a signed-in user → a
 * `/home` dashboard or `/project`). Kept as a helper now so B4 is a one-line change
 * here, not a hunt through the shell markup.
 */
export function homeHref(user: User | null): string {
  void user; // B4 will branch on the signed-in user; until then everyone goes to "/".
  return "/";
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
