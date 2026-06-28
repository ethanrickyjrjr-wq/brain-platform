# Homepage nautical-chart data experience + Email Lab funnel

**Date:** 2026-06-28
**Check:** `homepage_chart_experience_live_verify`
**Supersedes the homepage half of:** `docs/superpowers/specs/2026-06-28-homepage-listing-showcase-design.md`
(that spec's decree was correct; its `/listings`-page body was not — see Scope below)

---

## Problem

The homepage is 100% fixture data. The interactive map, the stat bar, and all 57 ZIPs
are auto-ported from an old Python demo (`lib/landing/home-map-data.ts`) and carry a
literal **"Sample data"** badge. Two landing components that were already built
(`components/landing/Charts.tsx`, `components/landing/ComparisonSection.tsx`) point at a
`/api/landing-data` endpoint that does not exist, so they silently render nothing.

The map opens on the **Flood** overlay (alarming orange) — the wrong first impression for
a research tool. Meanwhile we have ~40 live `data_lake.*` tables and a proven live-read
pattern (`app/charts/page.tsx`), so every number on this page *could* be real today.

There is also no path from the homepage into the product. The project-scoped Email Lab is
fully built (branding→tokens, scope inference, live lake data, AI fill, chart inject,
schedule + cron re-render), but a homepage visitor cannot reach it — they'd have to sign up,
log in, and manually create a project first.

## Goal

A homepage that opens on a **colorful, live map of SWFL defaulting to Home Value**, surrounds
it with **real cited numbers**, lets any researcher explore with zero friction, and quietly
assembles what they look at into a **draft project** that converts — in one sign-in — into a
branded, place-scoped project pre-staged in the Email Lab.

Operator decree (2026-06-28): *"We aren't a listings company. We just want numbers that
attract interest from all people doing research. We take all real data; if we don't have it
we find it; we have AI paint the actual picture of what's going on."*

Operator commit note (2026-06-28): *"Let's commit. Easy to move things around. Just make sure
we have the colorful map showing first… switch it off the flood map to home value and make
flood something else [a toggle, not the default]."*

---

## Design direction: the homepage is a living nautical chart of SWFL

A nautical chart is already what we are: a map with real, cited numbers printed at locations
(depth **soundings**), an authoritative **survey date**, a source **legend**, and **notes to
mariners**. Every part of our model has a chart equivalent — a cited number at a place = a
sounding; the as-of date = the survey date; the choropleth = a bathymetric depth overlay; a
scheduled recurring brief = a **passage plan** (a plotted course that updates with conditions).

The metaphor lives in **structure and typography, not decoration**. No anchors, no rope
borders, no kitsch. This is the one deliberate aesthetic risk, and the restraint is what keeps
it a serious data instrument rather than a theme. It also avoids all three current
generated-design clichés (cream + editorial serif + terracotta; near-black + acid accent;
broadsheet hairlines).

### Token system

```
COLOR  (extends the existing brand teal — does NOT fork the design system)
  Deep Gulf      #07171F   ink, dark sections, primary text
  Chart Linen    #ECEDE6   paper background (cool buff, deliberately NOT cream)
  Shoal Teal     #0E8C8C   primary accent · Home Value choropleth (existing brand teal)
  Channel Red    #C0473D   risk / flood ONLY — the single warm signal
  Sounding Brass #BE9445   growth / new construction
  Tide Line      #5B7A82   hairlines, gridlines, secondary text

  Depth ramps (each metric is its own survey overlay):
   value  #CDE5E2 → #5FB0AC → #0E8C8C → #0A5C5C   (deeper = pricier)
   flood  #F0D9D2 → #D98C7E → #C0473D → #8C2C24
   build  #EFE3C8 → #D8B96E → #BE9445 → #8C6A28

TYPE
  Display    Bricolage Grotesque   hero headline, section titles, wordmark (used with restraint)
  Body       IBM Plex Sans         engineered, authoritative — built for data UIs
  Soundings  IBM Plex Mono         every live number, tabular figures = depth soundings

SIGNATURE
  (1) Live numbers rendered as soundings: mono tabular figures with a location tick and the
      survey (as-of) date stated once, MM/DD/YYYY.
  (2) The click-to-paint moment: clicking a place types out a cited "NOTES" survey annotation —
      the AI painting the picture. ONE bold animated moment; everything else stays quiet,
      gridded, precise. (Respect prefers-reduced-motion: render instantly, no typing.)
```

### Above-the-fold layout (positions are flexible — "easy to move around")

```
┌──────────────────────────────────────────────────────────────────────────┐
│ SWFL DATA GULF        Home Value · Construction · Rents · Flood    [Sign in]│  title block
├──────────────────────────────────────────────────────────────────────────┤
│  SURVEY AREA: LEE · COLLIER                       as surveyed MM/DD/YYYY     │
│                                                                            │
│  ╭ ask anything ─────────────────────────────────╮    ┌─ SOUNDINGS ─────┐ │
│  │ Is Cape Coral a good buy right now?        [→] │    │ MEDIAN VALUE    │ │
│  ╰────────────────────────────────────────────────╯    │  <live + YoY>   │ │
│      ┌────────────────────────────────────┐            │ NEW CONSTRUCTION│ │
│      │   BATHYMETRIC MAP — LEE+COLLIER    │            │  <live permits> │ │
│      │   depth (teal) = HOME VALUE (deflt)│            │ MEDIAN RENT     │ │
│      │   click a place → picture paints   │            │  <live>         │ │
│      └────────────────────────────────────┘            │ FLOOD EXPOSURE  │ │
│        ◐ Home Value  ○ Construction  ○ Rents  ○ Flood   │  <live>         │ │
│                                                         └─────────────────┘ │
│  NOTES:  ‹AI paints the clicked place — cited, typed out›        sources ▾  │
└──────────────────────────────────────────────────────────────────────────┘
   ▸ Your SWFL project · 0 items                          (ambient tray, docked)
```

Below the fold (kept, restyled into the chart register):
- **Four survey questions** — buyer / seller / broker / investor cards, each voiced as the
  question that audience brings (existing `Capabilities.tsx` copy). Opening a card runs the
  real query and drops the cited result into the draft project.
- **"What everyone else charges"** competitor strip (kept).
- **Waitlist** (kept).

### Map behavior — the headline change

- Default overlay flips **Flood → Home Value** (`Hero.tsx` `applyMetric("flood")` →
  `applyMetric("value")`). Home Value is the colorful overlay that shows first.
- Flood is demoted to a **non-default toggle**, alongside Construction and Rents.
- Toggle order: **Home Value (active) · New Construction · Rents · Flood**.
- The map SVG, ZIP click/redirect, and tooltip logic are **unchanged** — only the default
  metric, the toggle set, and the color ramps change. (The map is a hand-rolled clickable
  SVG, not Mapbox; we are NOT rebuilding the rendering tech.)

---

## The ambient draft funnel (zero-friction → one sign-in)

1. **Land** → an ambient draft project spins up client-side (0 items). The tray docks at the
   bottom of the viewport.
2. **Explore** → clicking a ZIP, asking a question, or opening an audience card adds the
   **real cited result** to the draft; the item count ticks up.
3. **Cap reached** (default **4**, configurable) → tray reads "ready to build."
4. **"Build me this weekly"** → POST mints a claim token seeded with the place + items →
   `/claim?t=` → one sign-in → a branded, place-scoped project lands, pre-staged → straight
   into the Email Lab.

This reuses the existing paved road end-to-end: `lib/claim/claim-store.ts`
(`mintClaimToken(items, title, { brand, seed })`, `ClaimSeed = {template, scopeKind,
scopeValue}`), the `/claim` consume flow, and the precedent web caller
`app/api/prospect/open-project/route.ts`. No new claim/seed infra.

### The single root — `lib/landing/draft-project.ts`

One module owns the entire ambient-draft contract, so behavior is a one-line edit:
- `DRAFT_ITEM_CAP` (default `4`)
- tray labels / copy
- `addItem` / `clear` / `toClaimPayload` (maps draft items → claim-token `items` + `seed`)
- client-side persistence key (survives a refresh within the session)

Everything that touches the draft — the tray component, the map click handler, the ask box,
the audience cards — imports from here. Nothing hard-codes the cap or the copy.

---

## Scope

**In scope (this spec — the design + homepage experience build):**
- Nautical-chart visual identity applied to the homepage (tokens above).
- Map default flip to Home Value; Flood → toggle; color ramps.
- Live numbers wired into the soundings rail and the revived chart components.
- The ambient draft funnel + `lib/landing/draft-project.ts` root.

**Explicitly cut (decree overrides the prior spec's body):**
- The `/listings` page, the listings map pill, and listings-as-narrative. Listings count may
  appear as **one** sounding sourced from a real table — nothing more. We are not a listings
  company.

**Phase 1 of this build (the data substrate) — required, sequenced first:**
- `/api/landing-data` endpoint and the exact live queries (median value + YoY, top
  new-construction ZIP, median rent, flood exposure, per-ZIP choropleth values).
- Replacing `home-map-data.ts` fixtures with live per-ZIP reads.
- This design pins the **contract** (which numbers/charts must appear); the implementation
  plan details the queries against the proven `app/charts/page.tsx` live-read pattern. The
  homepage is not "done" while any number is fixture — hence substrate ships before the UI.

## Build sequence (for the implementation plan)

1. **Substrate** — `/api/landing-data` + live metric reads (kills the "Sample data" badge,
   feeds the soundings + revives `Charts.tsx` / `ComparisonSection.tsx`).
2. **UI** — nautical-chart identity, map default flip + ramps, soundings rail, restyled cards.
3. **Funnel** — `lib/landing/draft-project.ts` root, the tray, the click-to-add wiring, the
   mint-claim CTA into `/claim`.

---

## Research findings (crawl4ai, 2026-06-28)

- **Competitors all lead with "ask → instant answer from a huge dataset," never listings.**
  HouseCanary CanaryAI: *"Simply ask a question and get instant answers derived from our
  massive 136M+ property dataset."* ATTOM: *"Property Data & Intelligence Built for AI,"* leads
  with data categories (breadth is the product). Cotality: *"property from every angle."*
  Mapbox's own direction: *"Maps turn conversational"* (MapGPT). This validates the decree.
- **Map UX — progressive disclosure (NN/g):** show only the most important option first; the
  fact something appears initially signals it's important. → lead with one default overlay
  (Home Value), defer the rest to toggles. Don't open on four overlays at once.
- **Funnel — wizards (NN/g):** a short branching flow is right for an occasional task (setting
  up a recurring brief) and should route by audience (a buyer never walks a broker's path). →
  the four audience cards are the branch; the ambient tray is the shortest path to "build."

## Live data available now (source for the soundings + substrate contract)

| Sounding / overlay | Source brain / table | Status |
|---|---|---|
| Median home value + YoY | `home-values-swfl` / `data_lake.zhvi_swfl` (Zillow ZHVI) | live (e.g. $367,392, YoY −7.2% as of 06/26/2026) |
| New construction (permits) | `permits-swfl` / `lee_building_permits`, `collier_building_permits` | live |
| Median rent | `rentals-swfl` / `data_lake.zori_swfl` (Zillow ZORI) | live |
| Flood exposure | `env-swfl` / `fema_nfip_claims` (FEMA NFIP) | live |
| Per-ZIP choropleth values | same sources, per-ZIP grain | live |

(Specific values are served live and cited at render — never hard-coded. Only $367,392 / −7.2%
are quoted here as confirmed examples; all others are slots filled by the substrate spec.)

---

## Files

| File | Change |
|---|---|
| `components/landing/Hero.tsx` | Default `value`; Flood → toggle; toggle set + order; chart-linen/soundings restyle; survey-date header; click-to-paint NOTES; ask box; tray mount |
| `lib/landing/home-map-data.ts` | Color ramps per metric; (substrate spec swaps fixture → live) |
| `components/landing/Capabilities.tsx` | Four survey-question cards restyled; opening a card adds to draft |
| `components/landing/Charts.tsx` | Revive against `/api/landing-data` (substrate spec) |
| `components/landing/ComparisonSection.tsx` | Revive against `/api/landing-data` (substrate spec) |
| `lib/landing/draft-project.ts` | **New** — single root: cap (default 4), tray copy, add/claim payload |
| `components/landing/DraftTray.tsx` | **New** — docked ambient tray; imports the root |
| `app/api/landing/draft-claim/route.ts` | **New** — mints claim token from draft (reuses claim-store) |
| theme / fonts | Add Bricolage Grotesque + IBM Plex Sans/Mono; chart palette tokens |

## Verification (`homepage_chart_experience_live_verify`)

1. Homepage opens on the **Home Value** choropleth (colorful, not flood orange).
2. Toggles: Home Value (active) · New Construction · Rents · Flood; Flood is NOT the default.
3. Every above-the-fold number is real and cited; **no "Sample data" badge**.
4. Clicking a place paints a cited NOTES annotation (instant under reduced-motion).
5. Exploring adds items to the docked draft tray; cap is read from `draft-project.ts`.
6. "Build me this weekly" → `/claim?t=` → sign in → branded, place-scoped project in Email Lab.
7. `/listings` is NOT linked from the homepage.
8. `bunx next build` clean.
