# WAVE 2 — HANDOFF (B2 grouped nav + breadcrumbs → B4 signed-in home base) — probe-verified

> ### 🎯 READ THIS FIRST.
> Wave 1 is **on `main`** (B0 orphan guard ‖ B1 unified SiteShell/SiteFooter ‖ B3 close-the-loops). This handoff
> records the **actual seams B1 shipped** — which differ from the B2/B4 briefs in a few load-bearing ways. The
> briefs say "SiteShell exports NAV_GROUPS / isActive"; that's true via re-export, but the **source of truth is
> `components/nav/nav-config.ts`** (pure, tested). Edit the data there, render in the component. Read B1's
> design-of-record first: `docs/superpowers/specs/2026-06-20-b1-unified-siteshell-design.md`.
>
> **Sequence is hard: B2 → B4.** Both edit `nav-config.ts` + `SiteShell.tsx`; running them together collides.

## The seams B1 actually exposed (re-read the files — RULE 0.5)

All in **`components/nav/nav-config.ts`** (pure, no `"use client"`, unit-tested in `nav-config.test.ts`), **re-exported
from `components/nav/SiteShell.tsx`** so either import path resolves:

- `NAV_GROUPS: NavItem[]` where `NavItem = { label: string; href: string }`. **Currently FLAT:** `Search /r · Charts /charts · Showcase /showcase · Projects /project`. Rendered as `<nav aria-label="Main"><ul><li><a>` in both the desktop bar and the mobile drawer of `SiteShell`'s **AppBar** (the solid app variant). The home variant uses marketing anchors, not NAV_GROUPS.
- `isActive(pathname, href): boolean` — **TWO args now** (the old GlobalNav's was a 1-arg closure). Segment-anchored (`/r` does NOT match `/report`); `/` matches exactly. Already wired with `aria-current="page"` on the active tab.
- `homeHref(user): string` — returns `"/"` today (`void user` no-op inside). Both shell variants' logos link to it.
- `SHELL_HIDDEN_PREFIXES = ['/login','/auth','/embed/','/p/']` + `isHiddenPath(pathname)` — the shell **and** `SiteFooter` return null on these. Parity twin of `lib/briefcase/pill-mount.ts` (now also suppresses the pill on `/p/`+`/embed/`).

## ⚠️ The gaps that WILL bite B2

### Gap 1 — `NAV_GROUPS` is FLAT; grouping it is a TYPE change, and the test asserts the flat shape
The Explore ▾ group needs nesting. `NavItem` has no `children`. **DO:** evolve the type in `nav-config.ts` (e.g. `NavItem { label; href?; children?: NavItem[] }` — `href` optional for a group header), keep the four flat items grouping under `Explore`, and **update `nav-config.test.ts`** — it currently asserts `NAV_GROUPS.map(n => n.href) === ["/r","/charts","/showcase","/project"]`, which your change breaks by design. Don't add a parallel constant; evolve the one B2/B4/B5 all read.

### Gap 2 — clone the account disclosure, don't invent one
`SiteShell`'s AppBar already has a working disclosure: `accountOpen` state + a `useEffect` that closes on outside-`pointerdown` and `Escape`, with `aria-expanded`/`aria-controls` on the button. **Reuse that exact mechanism for `Explore ▾`** (the research mandate: `<nav>`+`<ul>`+`<button aria-expanded aria-controls>`, Escape-to-close, NOT `role="menu"`). The a11y pattern (nav landmark, `aria-current`, ul/li) is already in place — match it.

### Gap 3 — `/r/zip-report` has NO index route (it's `/r/zip-report/[zip]` only)
The footer already points "ZIP Reports" → **`/r/search`** for this reason. B2's Explore ▾ and the ZIP-Reports breadcrumb crumb must do the same — bare `/r/zip-report` 404s.

### Gap 4 — do NOT promote `/data-intel` into Explore ▾
The brief offers it conditionally. The operator's standing call (README decision 1) is **keep it out of customer nav** (noindex/relocate, B6). It is currently **allowlisted** in `scripts/check-orphans.mjs` as a known-pending orphan. Adding it to nav would reverse that — don't, unless the operator says so.

## B2 build notes (against the real shell)
- **Grouped nav:** evolve `NAV_GROUPS` → `Explore ▾ (Search /r · Maps /map · ZIP Reports /r/search) · Charts · Showcase · Projects` (+ Alerts if promoted). Render the dropdown in `SiteShell`'s AppBar; mobile drawer mirrors the groups. Keep all chrome links **inside `SiteShell.tsx`** so B0's `CHROME_FILES` (already pointed at SiteShell + SiteFooter) needs no change — if you extract a `NavGroups.tsx`, add it to `CHROME_FILES` in `scripts/check-orphans.mjs` **and** `runs/connectivity-map.py` in the same commit.
- **`components/nav/Breadcrumbs.tsx`** (new): mount in `app/layout.tsx` after `<SiteShell/>`, gated to `/r/*` + `/project/*` only (exclude `/p/*` — white-label — and home). Location-based (reflect IA, not history). It sits under the **sticky** app bar (the home bar is `fixed`, but breadcrumbs never render on home).
- **Active state:** `isActive(pathname, item.href)` + `aria-current="page"` are already there — you're enriching the *visual* (pill/underline) over today's `text-white` vs `text-gray-300`. Reads correctly on home too (home variant has no NAV_GROUPS tabs, so nothing to mis-highlight).
- **Acceptance carry-over:** `node scripts/check-orphans.mjs` must stay exit 0 (promoting `/map` into Explore keeps it in-chrome — it's already footer-linked, so no regression).

## B4 build notes (after B2)
- **Minimal (rec, ~½ day):** repoint `homeHref(user)` in `nav-config.ts` → `return user ? "/project" : "/"` (drop the `void user` no-op). That one line repoints BOTH shell variants' logos. Then enrich `app/project/page.tsx`'s header with quick links to Charts / Search / Alerts / Contacts. **Preserve:** logged-OUT logo still → `/` (funnel). No new route, no middleware change.
- **Full (`/home` dashboard, ~1–2 days):** new `app/home/page.tsx`, auth-gate it in `middleware.ts` (copy the `/project*` gate at ~:121-132), `homeHref(user)` → `/home`, promote `/home` into `NAV_GROUPS`. **`superpowers:brainstorming` required** for the full dashboard. New `app/home/page.tsx` is a new route → the orphan guard fires; it's reachable via the logo + nav, so it won't trip, but run `node scripts/check-orphans.mjs` before pushing.

## Gates (both)
`tsc` 0 · eslint clean · `next build` ✓ · relevant `bun test` (update `nav-config.test.ts` for the shape change) · `node scripts/check-orphans.mjs` exit 0 · `SESSION_LOG.md` entry · explicit-path staging.
