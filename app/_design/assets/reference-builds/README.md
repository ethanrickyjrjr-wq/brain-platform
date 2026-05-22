# Reference builds — real production code from sites we admire

Six files: three beautified JS bundles + three markdown captures of how
the corresponding sites read editorially. **These are reference
material, not source to copy.** Use them when a v4 example doesn't
cover a pattern and you want to see how a real production site solved
the same problem.

The companion visual references for these sites are at
`app/_design/assets/inspiration/` (PNG screenshots).

## JavaScript bundles (beautified, variable names still mangled)

Beautified via `js-beautify` so the structure is readable, but
production minifiers stripped semantic variable names — you'll see
`a`, `e`, `t`, `o` everywhere. The bundles are **searchable** (grep
for `transition`, `scale`, `tween`, `easing`, `interpolate`, etc.),
not casually readable top-to-bottom.

### `pudding-happy-map-page-component.beauty.js` (1.4 MB, 41.4 K lines)

Source: <https://pudding.cool/2026/02/happy-map> — Pudding's Feb 2026
scrollytelling map essay. Pulled directly as the SvelteKit page-
component chunk; this is the bespoke article code, not Svelte runtime.

**Why it's here:** **232 transitions, 163 scale calls, 6 GeoJSON
references.** The closest existing reference for **scroll-driven map
data UI** — exactly what we'll need for SWFL Lee County permit
density / corridor flows / hurricane track visualizations.

**Grep this when:** building a map surface with scroll-narrated
reveals; needing patterns for `d3.geoPath`-style boundary draw
sequencing; wanting to see how scrollytelling handles section
transitions and sticky maps.

### `pudding-birthday-effect-page-component.beauty.js` (71 KB, 834 lines)

Source: <https://pudding.cool/2025/04/birthday-effect> — Pudding's
chart-driven Apr 2025 essay. Smaller bundle (one article, one main
chart pattern).

**Why it's here:** A focused **chart-animation pattern** reference.
Fewer moving parts than happy-map. Easier entry point if you want to
understand how Pudding sequences a single bar/line chart reveal.

**Grep this when:** building a single chart reveal sequence; looking
for tween patterns on bar/line elements; needing a small-scale
reference before tackling happy-map.

### `meteo-ashwyn-bundle.beauty.js` (907 KB, 16.7 K lines)

Source: <https://meteo.ashwyn.studio/> — full bundled inline script
from the page (the dark-themed weather data viz site whose screenshot
is in `assets/inspiration/`).

**Why it's here:** Production code from the site whose **aesthetic
most closely matches SWFL's** (dark background, gulf-teal-adjacent
accent, sharp data presentation). Public-API class methods like
`getHistoricalData` survived minification, so structural patterns are
greppable by name.

**Grep this when:** building a data fetch + render cadence for a
"live" feel (the freshness indicator on `/connect`); looking for how
they sequence reveals after data resolves; replicating the dark-mode

- accent-color motion vocabulary.

## Markdown captures (full editorial structure of each site)

These are the human-readable Markdown extractions — the actual prose,
hierarchy, and microcopy of each site at scrape time.

### `pudding-birthday-effect.md` (19 KB)

The full text of the Pudding birthday-effect article. **The single
best reference document for our voice work.** Same shape as a SWFL
report: a claim, supporting metrics, source citations, drivers,
caveats. Read it to calibrate how data journalism handles
metric-with-source language without sounding like a government data
portal.

**Read this when:** drafting prose for the report page Tier 1 / Tier
2 conclusion sentences; writing caveat language; needing to see how
"this number means this" prose reads in a successful editorial data
piece.

### `pudding-cool.md` (13 KB)

The Pudding homepage / article index at scrape time. Their navigation
patterns, sticker-based brand decoration, and tag-based content
filtering.

**Read this when:** designing a content index / archive view (if SWFL
adds a `/reports` archive page later); studying playful-but-credible
brand decoration patterns.

### `linear-app.md` (17 KB)

Linear's homepage IA and copy at scrape time — section ordering, CTA
phrasing, marketing prose tone.

**Read this when:** drafting `/connect` landing page copy; needing
benchmarks for SaaS marketing voice without sliding into hype; seeing
how a polished product describes itself in plain language.

## How to use these in Claude Design

These files are **in the GitHub-attached folder**, so they're already
available when Claude Design has `app/_design/` (or the parent `app/`)
in scope. You don't need to attach them separately to the assets slot.

If you want to direct Claude Design at one specifically:

> "Look at `app/_design/assets/reference-builds/pudding-happy-map-page-component.beauty.js`
> and adapt that scroll-triggered map reveal pattern for a Lee County
> permit-density choropleth."

Or:

> "Grep `app/_design/assets/reference-builds/meteo-ashwyn-bundle.beauty.js`
> for `createTimer` or interval-based update patterns. We want a
> similar tick cadence for the live freshness indicator on the report
> page."

Or:

> "Read `app/_design/assets/reference-builds/pudding-birthday-effect.md`
> end-to-end. Calibrate the voice in our report page Tier 2
> conclusion to match that prose register."

## What's intentionally NOT here

- **Linear inline bundle** (`linear-app-biggest-inline.js` from the
  external `claude-design-assets/`). It's Next.js RSC payload (page-
  tree JSON), not motion code. Linear's actual animations live in
  chunked `_next/static/chunks/*.js` files we didn't download. And
  Linear uses framer-motion declaratively, which Claude already knows.
- **Nodal.gg JS** (5 KB runtime bootstrap only — not animation code).
- **Raw firecrawl JSON outputs** (working files, not human-readable).
- **The Anime.js v4 README** (sponsor blurbs mostly; real docs are in
  `animejs-docs/`).

These remain in the external `claude-design-assets/reference-builds/`
folder on disk, available if needed but not pushed to the repo.
