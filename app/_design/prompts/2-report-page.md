<!--
Use this when: you want the flagship product surface. This builds the
full report page at /r/{report_id} with all three tiers as tabs. The
biggest single payoff — if you only run one prompt, this is the one.

Copy everything below the dashed line into Claude Design as your prompt.
Claude Design should have brain-platform connected via GitHub with at
least `app/_design/` and `app/r/` in scope.
-->

---

I'm designing **SWFL Data Lake** — a real-time analyst-grade data product
for Southwest Florida (Lee, Collier, Charlotte counties). The full design
system lives in this repo at `app/_design/`.

**Before generating anything**, read these files in order:

1. `app/_design/00-START-HERE.md` — the soul, the three contexts, the
   universal rule.
2. `app/_design/01-product-brief.md` — what we're building **and the
   canonical mock master report JSON**. Use that data verbatim.
3. `app/_design/02-motion-rules.md` — the three-context model. The
   relevant section for this surface is § 2 (Web report pages — full
   send).
4. `app/_design/03-surface-recipes.md` — **Surface A is the canonical
   recipe for this page.** Also read Surface B (Tier 1) and Surface C
   (Tier 3). Read the empty/loading/error states cross-cutting section.
5. `app/_design/05-color-and-type.md` — palette + type tokens.
6. `app/_design/06-voice-and-microcopy.md` — copy rules, number
   formatting, trend language.
7. `app/_design/QUICK-REFERENCE.md` — keep open while building.

For animation code, open the example folders cross-referenced in
Surface A: `easings-visualizer/`, `stagger/`, `text/`,
`svg-line-drawing/`. Anime.js v4 syntax only.

## What to build

The **report page** at route `/r/{report_id}`. All three tiers (Tier 1
conversational, Tier 2 structured, Tier 3 raw audit) are tabs on the
**same page**, not separate pages.

### Tabs

Top-right: a three-state tab control. `Glance` / `Report` / `Audit`,
defaulting to `Report` (Tier 2). Tab labels come from
`06-voice-and-microcopy.md`. Switching tabs crossfades 250ms.

### Tier 2 (default — `Report`)

Build to the exact sequence in `app/_design/03-surface-recipes.md` →
Surface A. Eight beats:

1. Hero verdict word — spring reveal 700–900ms
2. Headline conclusion sentence — fade + 4px rise, starts +300ms
3. Metrics table — staggered rows 60–80ms between, each 400ms,
   begins +600ms
4. Numbers count up from 0 with `eases.outQuint`, 800ms, tabular
   figures
5. Drivers section — block fade-in, 500ms
6. Caveats — fade in last, 400ms, slightly reduced opacity
7. Upstream report chips — fade in with caveats
8. Freshness token — instant, mono, `--text-tertiary`

Then stillness.

### Tier 1 (`Glance`)

Build to Surface B. Total motion under 1.2 seconds. Verdict spring +
single-block sentences fade + source chips. No per-sentence
staggering.

### Tier 3 (`Audit`)

Build to Surface C. **Single block fade-in only.** No per-row animation,
ever. Hover row tint 120ms `outQuad` is the only ongoing motion in
this surface.

### Animations toggle + returning-user rule

Per `02-motion-rules.md`:

- Toggle in top-right (gear icon or text "Settings"), opens popover
  with `Animations: on / off`. Persist to `localStorage` under
  `swfl.animations`. Respect `prefers-reduced-motion: reduce`
  unconditionally.
- Returning-user rule: detect via
  `localStorage.getItem('swfl.visited.{report_id}')` whether this
  session has seen this report before. After first visit: scale all
  animation durations to 60% and **skip** the hero verdict spring on
  subsequent loads.

### Data

Use the canonical master report JSON from
`app/_design/01-product-brief.md` § Canonical mock data **verbatim.**
Do not invent alternate numbers — the work composes coherently only if
every prompt builds against the same example.

Source URLs in metric rows render as citation chips using the agency
shorthand mapping in `06-voice-and-microcopy.md` § Source citations
(e.g. `LeePA`, `Lee Accela`, `Florida DOR`, `NOAA`). Chip color
`--gulf-teal-dim`, no underline default, hover underline 120ms fade.

Upstream report chips route to `/r/{upstream.id}` on click.

### Empty / loading / error states

Implement per the cross-cutting section in
`app/_design/03-surface-recipes.md`. Specifically:

- Loading: skeleton matching final layout. No spinners, no shimmer.
- Empty: name what's empty per `06-voice-and-microcopy.md` empty-state
  copy rules.
- Error: plain English with source URL as the path forward. No error
  codes.
- Stale: single line in `--neutral-gold` above the conclusion.

## Style + technical constraints

- Anime.js v4. Confirm against `app/_design/animejs-v4-examples/`
  before writing animation code.
- React + Tailwind. CSS variables for color tokens per
  `05-color-and-type.md`.
- All numeric values use `font-variant-numeric: tabular-nums`.
- Direction word styling: weight 600, tracking -2%, lowercase, set in
  the direction color per `05-color-and-type.md`. Color is set
  instantly — never animated.
- Background: subtle `--gulf-midnight` → `--gulf-deep` gradient.
  Cards flat with `1px solid --gulf-haze`. **No drop shadows.**
- Mobile: tabs become a segmented control below 640px. Metric table
  becomes stacked cards below 640px.
- Voice: every line of copy follows `06-voice-and-microcopy.md`. No
  hedging, no marketing fluff.

## What success looks like

I open this page. Within two seconds, the verdict (`mixed`) springs in
and lands. The conclusion sentence follows. Then the five metrics
cascade in with their numbers counting up. The drivers and caveats
settle behind. The freshness token is there from the start, quietly.

Toggling to `Glance` collapses it to a one-paragraph executive read.
Toggling to `Audit` shows the full citation table with zero animation.

Toggle `Animations: off` in settings, refresh — the page renders
instantly with no motion. Same content, same hierarchy, zero
performance.

Build it.
