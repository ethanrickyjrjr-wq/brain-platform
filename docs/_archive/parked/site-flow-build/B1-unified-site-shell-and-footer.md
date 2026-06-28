# B1 — Unified SiteShell + global footer (THE SPINE) · **Opus** · WAVE 1 · owns nav/layout/footer

> **BRAINSTORM REQUIRED (RULE 3.5)** before coding — run `superpowers:brainstorming` on the shell variant
> model (one component, two contexts) first. This is the highest-leverage change: it kills **R1 + R3** and
> reconnects ~13 orphans at once.

**Goal:** ONE auth-aware navigation shell on **every** page (including home), plus a global footer sitemap on
every page. Kill the two-bar split (`Header` vs `GlobalNav`) that makes home an island.

## What exists (read in full first — RULE 0.5)
- `components/nav/GlobalNav.tsx` — the app bar. Tabs Search→`/r`, Projects→`/project`, Charts→`/charts`; account menu (My Projects/Contacts/Billing/Sign out); logged-out Log In modal + Get Access→`/#waitlist`. **Self-hides on `/`, `/login`, `/auth`, `/embed/*`, `/p/*`** (`isHiddenPath`, ~:28-37). Has `isActive()` (~:95).
- `components/landing/Header.tsx` — home-only fixed bar. `#comparison`/`#install`/`#data` anchors + Log In modal + Get Access→`#waitlist`; "My Projects"→`/project` when logged in. **Links to no app surface.**
- `components/landing/Footer.tsx` — rendered **only** in `app/page.tsx:25`. `footerLinks` = `#comparison/#install/#data` + `/api/b/master` + `/privacy`/`/terms` (NOT a sitemap). Has `DigestSubscribe`.
- `app/layout.tsx` — mounts `<GlobalNav/>` (:48) + `<AppShell/>` pill (:53). Root of every page.
- `lib/briefcase/pill-mount.ts:32-40` (`shouldRenderStandalone`) — pill suppression: hides on `/p/*`, and on `/r/*` when highlighter on. **Your `SHELL_HIDDEN_PREFIXES` must stay parity with the `/p/*` rule.**
- `middleware.ts:121-132` — only `/project*` is auth-gated; **every other route is public** → logged-out nav can safely expose app tabs (Search/Charts/Showcase) as proof-of-product.

## Build
1. **`components/nav/SiteShell.tsx`** — the one shell, `"use client"`, mounted in `app/layout.tsx` in place of `GlobalNav`. Renders on every path **except** `SHELL_HIDDEN_PREFIXES` (`/p/`, `/embed/`, `/login`, `/auth`). Auth-aware (reuse GlobalNav's client-session read).
   - **Primary tabs** from a `NAV_GROUPS` constant (export it — B2/B5 extend it): Search `/r` · Charts `/charts` · Showcase `/showcase` · Projects `/project` (+ B2 turns these into the grouped `Explore ▾`).
   - **Logged-out:** show the primary tabs **and** keep `Log In` (modal) + `Get Access` (CTA). On `/` the Get Access stays the prominent funnel CTA (don't dilute it).
   - **Logged-in:** primary tabs + the account dropdown (My Projects/Contacts/Billing/Sign out).
   - **Home variant:** on `/`, ALSO surface the marketing anchors (`#comparison`/`#install`/`#data`) — e.g. a secondary row or merged into the bar — so the hero page keeps its scroll-nav AND gains real doors into the app. Logo → `homeHref(user)`.
   - Export helpers: `homeHref(user)` (default `/`; B4 repoints for signed-in), `SHELL_HIDDEN_PREFIXES`, `NAV_GROUPS`, and keep `isActive()`.
2. **`components/nav/SiteFooter.tsx`** — real sitemap, mounted in `app/layout.tsx` (suppress on `SHELL_HIDDEN_PREFIXES` so `/p/*`+`/embed/*` stay white-label clean). Columns:
   - **Explore:** Search `/r` · Maps `/map` · Charts `/charts` · ZIP Reports `/r/zip-report` · Showcase `/showcase` · Demo `/demo` · Projects `/project` · Alerts `/alerts`
   - **Company:** Support `/support` · Install MCP `#install` (or a real install page) · API `/api/b/master`
   - **Legal:** Privacy `/privacy` · Terms `/terms`
   - Keep `DigestSubscribe`. (Do **not** list `/data-intel` or `/ops/*` — internal per B6.)
3. **Retire the split:** `app/page.tsx` drops its own `<Header/>`+`<Footer/>` and inherits `SiteShell`+`SiteFooter` from the layout (or renders the home variant). Delete `Header.tsx` + `Footer.tsx` (fold what's unique — `DigestSubscribe`, marketing anchors — into the new components). Old `GlobalNav.tsx` is replaced by `SiteShell`.

## Preserve / DO NOT break
- `/p/*` and `/embed/*` render **no shell, no footer, no pill** (white-label). Verify against `shouldRenderStandalone`.
- The Get Access → `#waitlist` funnel CTA stays visible and primary (revenue path).
- The `AppShell` floating pill still mounts (bottom-right) and coexists with the shell.
- Active-section highlight (`isActive()`) carries across the whole shell incl. home.

## Acceptance (re-run the crawl to prove it)
- `python runs/connectivity-map.py` → home `/` is no longer source-island; `/map`,`/showcase`,`/support`,`/ask` reachable from chrome (footer or nav).
- `python runs/crawl-site-flow.py` (logged-out) → `/` rendered internal links now include `/r`,`/charts`,`/showcase` (not just `/privacy`,`/terms`,`#`).
- `/p/[id]` crawl still shows zero SWFL chrome. Logged-out on `/charts` sees tabs + Get Access; logged-in sees account menu.
- `next build` ✓ · `real-tsc` 0 · eslint clean · `bun test` green.

## Gates
`real-tsc` 0 (alone) · eslint · `next build` ✓ · `bun test` · `node scripts/check-orphans.mjs` (from B0, if landed) shows the orphan count dropping · `SESSION_LOG.md` entry · explicit-path staging · **no autonomous push — show the diff.**
