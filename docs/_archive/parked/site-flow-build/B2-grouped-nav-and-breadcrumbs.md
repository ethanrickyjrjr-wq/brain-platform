# B2 — Grouped nav + breadcrumbs + active state · **Sonnet** · WAVE 2 (after B1) · edits the SiteShell

**Goal:** turn the flat tab row into a use-case-grouped nav (~6 items, not 12 flat), add wayfinding on the deep
report/project trees, and make the active section unmistakable. Kills **R2**. **Depends on B1's `SiteShell` +
`NAV_GROUPS`** — do not start until B1 is on `main`. **Sequence before B4** (both edit the shell).

## What exists
- B1's `components/nav/SiteShell.tsx` exporting `NAV_GROUPS`, `isActive()`. Re-read it first (RULE 0.5).
- Deep route trees needing breadcrumbs: `/r/[slug]`, `/r/zip-report/[zip]`, `/r/cre-swfl/[corridor]`, `/r/source/[table]`, `/r/method/[metric]`, `/project/[id]`. (NOT `/p/*` — white-label.)
- Research backing (cite in the brainstorm if you run one): NN/g menu-design + breadcrumbs; Baymard "highlight current scope" (95% of sites fail it).

## Build
1. **Grouped primary nav** — extend `NAV_GROUPS` so the long tail collapses under an **`Explore ▾`** dropdown: Search `/r` · Maps `/map` · ZIP Reports `/r/zip-report` (· Data Intel `/data-intel` **only if operator keeps it customer-facing — see B6**). Top-level siblings: **Explore ▾ · Charts · Showcase · Projects** (+ `Alerts` if promoted). Keep account items in the dropdown. Mobile drawer mirrors the groups.
2. **`components/nav/Breadcrumbs.tsx`** — location-based (reflects IA, not click history). Render under the shell on `/r/*` and `/project/*` only. Examples: `Home / Search / {report}` ; `Home / Search / ZIP Reports / 33931` ; `Home / Projects / {name}`. Exclude `/p/*`.
3. **Active state** — replace the low-contrast `text-white` vs `text-gray-300` with a persistent pill/underline for the current section, reusing `isActive()`. Must read correctly on home too.

## Acceptance
- `Explore ▾` opens/closes (pointer + keyboard + outside-click), groups the tail, mobile drawer matches.
- Breadcrumbs appear on a report page and a project page, absent on `/p/[id]` and home.
- Active section visibly distinct on `/r`, `/charts`, `/project`.
- `node scripts/check-orphans.mjs` still green (promoting `/map` etc. into Explore keeps them in-chrome).
- `real-tsc` 0 · eslint · `next build` ✓ · `bun test`.

## Gates
Standard done-bar (README). `SESSION_LOG.md` entry · explicit-path staging · no autonomous push.
