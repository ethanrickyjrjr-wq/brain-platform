# ZIP page → AI pill: first-visit auto-open (design)

**Date:** 2026-06-21 · **Status:** approved (operator), implementing
**Brainstorm probe:** 7-surface code scout (homepage facts, map click, existing zip pages, AI pill, cutout geometry, zip data, routing).

## The surprise the probe surfaced

Almost everything the brief described already exists in the (untracked) `/z/[zip]` build:

- **Map click → `/z/[zip]`** is already wired on both surfaces — homepage `Hero.tsx` (`selectZip` → `router.push('/z/${zip}')`) and `/map` via `MapCanvas.tsx`.
- **`/z/[zip]` page** already renders the cutout (via `lib/map/extract-zip-shape.ts`), a 4-cell stats strip under it, and a breakdown + side-rail two-column body.
- **The AI pill** (`AiBriefcasePill`, global via `AppShell`) already opens a `BriefcasePanel` that renders context-aware starter prompts (`promptsForPage`), the "See a live example" project cards (`EXAMPLE_CARDS` → live `/p/example-*` deliverables), and the Build path.
- **Visit tracking** already exists: `lib/briefcase/visits.ts`, `sdg_briefcase_visits` localStorage int.

So this is not a build — it's three small changes.

## Scope (three edits)

1. **Delete the "Ask the AI about {zip}" CTA** on `/z/[zip]` (the `.zp-ai-cta` block + the `/ask` query that fed it, plus its dead CSS). We never send anyone to `/ask` from the zip page.

2. **Auto-open the global pill on a visitor's FIRST visit.** The pill is already on every page; the only new behavior is that on the first visit it pops itself open (pre-loaded with the prompts + project examples that already live in the panel). Gate:
   - **First visit only** — `readVisits() === 0` (the counter bumps to 1 the first time the panel mounts, so it auto-pops at most once per browser, ever).
   - **Logged-out only** — logged-in users are past the funnel; never pop for them.
   - **Standalone pill only** — never auto-open the bridged `/r/*` report dock.
   - The decision is a pure function `shouldAutoOpenPill({firstVisit, authed, bridged})` (unit-tested); the component reads `firstVisit` via `useSyncExternalStore` (server snapshot = false → no hydration mismatch) and `authed` via `useSession` (waits for auth to resolve before deciding). No `setState`-in-effect (hard-banned); the one-shot open is set during render behind a guard.

3. **One front door:** the homepage search box routes a typed 5-digit ZIP to `/z/[zip]` (was `/r/zip-report/${zip}`).

## Out of scope (flagged, not silently dropped)

- **Live data** on the `/z/[zip]` cards stays fixture (`HOME_MAP_DATA`) with the honest "Sample data" badge — separate follow-up (operator: "fixtures now").
- **Free-text** hero search still goes to `/ask` (no homepage pill-seed mechanism in scope).
- `/z/[zip]` covers the 57 fixture ZIPs; a typed ZIP outside that set 404s until live data lands. `/r/zip-report` remains for deep/live reads.
