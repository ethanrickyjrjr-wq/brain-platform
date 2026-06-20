# B1 — Unified SiteShell + global SiteFooter (design-of-record)

**Date:** 2026-06-20 · **Brief:** `SITE FLOW BUILD/B1-unified-site-shell-and-footer.md` · **Wave:** 1 (spine)
**Brainstorm decision:** home-bar treatment = **Option A — premium home variant** (operator, 2026-06-20).
**Research:** crawl4ai pass (NN/g, web.dev, MDN, Moz, live Linear/Vercel) found **zero contradictions** with this plan
and added one mandate folded in below (nav landmark + `aria-current`).

## Goal
Kill Root-cause R1 (two bars that share zero destinations → home is a sealed island) and R3 (footer is home-only →
no orphan safety-net, no legal link on app pages). ONE auth-aware nav shell on **every** page incl. home + a global
footer sitemap. Reconnects the long tail (`/map`,`/showcase`,`/support`,`/demo`,`/ask`) at once.

## Approach (chosen)
One component, internal variant branch — **not** two components (that split *is* the bug) and not a wrapper-that-picks
(a layer for no gain). Single mount in `app/layout.tsx`, single client auth read, single set of exported seams.

## Units
1. **`components/nav/nav-config.ts`** — pure, no `"use client"`, **unit-tested**. Exports the cross-build seams so
   B2/B5 extend a small data file (not the big client component) and B4 repoints one helper:
   - `NAV_GROUPS: NavItem[]` = `Search /r · Charts /charts · Showcase /showcase · Projects /project` (flat in B1; B2 turns these into the grouped `Explore ▾`; B5 appends Social/Send).
   - `SHELL_HIDDEN_PREFIXES = ['/login','/auth','/embed/','/p/']` — shell **and** footer suppress here. `/p/` (trailing slash, can't match `/privacy`/`/project`) is the **parity twin of `lib/briefcase/pill-mount.ts` `shouldRenderStandalone`** — change one, change both. NOTE: `/` is NOT hidden (home renders the home variant).
   - `homeHref(user)` → `/` (B4 repoints to a signed-in home base).
   - `isActive(pathname, href)`, `isHiddenPath(pathname)`.
2. **`components/nav/SiteShell.tsx`** (`"use client"`, replaces `<GlobalNav/>`): reads session client-side (same pattern as the old GlobalNav/Header), returns null on `isHiddenPath`, else branches `pathname === "/"`:
   - **Home variant** — `fixed`, transparent→solid-on-scroll, motion intro; marketing anchors (How It Works `#comparison` · Install `#install` · Live Data `#data`) + **one app door "Explore the Data" → `/r`**; logged-out → `Log In` (modal) + loud `Get Access` (`#waitlist`); logged-in → My Projects + Sign out. Logo → `homeHref`.
   - **App variant** — solid sticky bar; `NAV_GROUPS` tabs with `isActive` + **`aria-current="page"`**; logged-out → tabs + Log In + Get Access; logged-in → account disclosure (My Projects/Contacts/Billing/Sign out).
   - Re-exports the four seams from `nav-config` so the README contract resolves from `@/components/nav/SiteShell`.
3. **`components/nav/SiteFooter.tsx`** (`"use client"`): global "doormat" sitemap, suppressed on `SHELL_HIDDEN_PREFIXES`. Columns — **Explore** (Search/Maps/Charts/ZIP Reports→`/r/search`/Showcase/Demo/Projects/Alerts/Ask AI) · **Company** (Support, Install MCP→`/#install`, API→`/api/b/master`) · **Legal** (Privacy/Terms). Keeps `DigestSubscribe`. No `/data-intel`, no `/ops/*` (internal). *(ZIP Reports → `/r/search`, not bare `/r/zip-report` which has no index.)*
4. **Retire the split:** `app/page.tsx` drops its own `<Header/>`+`<Footer/>`; **delete** `components/landing/Header.tsx`, `components/landing/Footer.tsx`, `components/nav/GlobalNav.tsx`. Fold their unique bits (marketing anchors, motion intro, LoginModal reuse, `DigestSubscribe` import) into the new components. No new dep (`motion` already present) → no lockfile change.

## Accessibility (research mandate — MDN Mar 2026, web.dev)
Primary tabs as `<nav aria-label="Main">` (footer nav `aria-label="Footer"`); **`aria-current="page"`** on the active tab
(not a CSS class alone); account dropdown as a disclosure (`aria-expanded`/`aria-haspopup`, Escape-to-close, outside-click-close) —
**not** `role="menu"/menuitem"` (that ARIA pattern is for app command menus, not nav links).

## Preserve / DO NOT break
`/p/*`+`/embed/*` render no shell, no footer, no pill (white-label); `Get Access` funnel stays primary; the `AppShell`
pill still mounts and coexists; `isActive` carries across the whole shell incl. home.

## Gates / acceptance
`bun:test` on `nav-config` (homeHref default · isActive incl. `/`-exact and `/r` not matching `/rsomething` · isHiddenPath
incl. `/p/`-not-`/privacy`/`/project` · NAV_GROUPS shape) · `tsc --noEmit` 0 (alone) · eslint clean · `next build` ✓ ·
full `bun test` · re-run `python runs/connectivity-map.py` + `node scripts/check-orphans.mjs` → non-allowlisted orphans
drop to just `/data-intel` (B6's call). Verify B0's push-hook blocks only on **newly-introduced** orphans so the
pre-existing `/data-intel` doesn't wedge the push. **No autonomous push — operator reviews the diff.**
