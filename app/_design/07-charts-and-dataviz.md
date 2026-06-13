# 07 — Charts and Data Visualization

How the SWFL Data Lake draws data. As load-bearing as the motion rules
(`02`) and the voice rules (`06`). A chart that misleads — even
accidentally, even prettily — destroys the trust the sourcing built.

This file is the standing reference for **every** chart we build, on
`/charts` and on any topic page later. Read it before adding a chart.

> Sourcing note: the rules below were verified in-session (2026-06-13)
> against Financial Times' _Visual Vocabulary_, Datawrapper Academy,
> Storytelling with Data, Our World in Data, Nielsen Norman Group, the
> U.S. Web Design System (USWDS), GOV.UK / UK Analysis Function, and W3C
> WCAG 2.2. Citations are inline. When sources disagreed, the stricter
> general-audience rule won — we are a consumer product, not an analyst
> terminal.

---

## 0. The one rule above all

**A chart earns its place or it doesn't ship.** Storytelling with Data:
if a single number or one sentence says it better, use the sentence. A
chart is for showing a _shape over time_ or a _comparison_ — not for
decorating a fact. ("Typical Fort Myers home value is $415k, up 4% from a
year ago" is a sentence, not a chart. The 10-year trend behind it is a
chart.) — _storytellingwithdata.com/blog/you-dont-always-need-a-graph_

When a chart does earn its place, it follows every rule below.

---

## 1. Chart-type rules

1. **Monthly time series → a plain LINE chart.** Continuous values that
   rise and fall over time (home value, rent, passenger counts) are the
   textbook case for a line. — _FT Visual Vocabulary "Change over Time";
   datawrapper.de/academy/what-to-consider-when-creating-line-charts_
2. **Do NOT fill the area under the line.** A filled area chart means a
   _cumulative total_ or a _part-to-whole_ (shares summing to 100%). A
   price or rent _level_ is neither — a fill implies a magnitude that
   isn't there. Clean stroked lines only. (At most, a single lone series
   may carry a very subtle tint as pure decoration; the safe default is
   no fill.) — _FT VV area-chart caveat; Datawrapper line guide_
3. **Line y-axes do NOT need to start at zero.** Truncate to the data
   range so the movement is legible (home values ~$300–600k, rents
   ~$1.5–3k). **Bar/column charts ALWAYS start at zero** — truncating a
   bar baseline is documented deception (Pandey 2015). Don't carry the
   bar rule onto a line, and don't carry the line freedom onto a bar. —
   _datawrapper.de/academy/why-our-column-and-bar-charts-start-at-zero_
4. **Three series is the comfortable ceiling for one chart.** Clutter is
   triggered by _overlap_, not a hard count. If lines tangle (especially
   at mobile width), switch to **small multiples** (one mini-line per
   metro) with a **shared y-axis** so cross-metro comparison survives. —
   _datawrapper.de/blog/what-to-consider-when-creating-small-multiple-line-charts_
5. **No pie, donut, gauge, treemap, or 3-D — ever.** They encode value as
   area/angle, which people read poorly. Line and bar exploit position
   and length, which people read accurately and pre-attentively. —
   _nngroup.com/articles/dashboards-preattentive; USWDS data-viz_

---

## 2. Color — the locked palette and the mandatory mitigation

Series colors come from the gulf palette (`05-color-and-type.md`),
**not** Tailwind defaults. The locked categorical set:

| Series slot | Token            | Hex       |
| ----------- | ---------------- | --------- |
| 1           | `--gulf-teal`    | `#3dc9c0` |
| 2           | `--mangrove`     | `#5bc97a` |
| 3           | `--neutral-gold` | `#d4b370` |
| 4 (if used) | `--sunset-coral` | `#e08158` |

**Contrast vs. the `#0a1419` background: all pass** WCAG 1.4.11 non-text
3:1 with room to spare (teal 9.15:1, green 8.94:1, gold 9.30:1, coral
6.61:1). Cream text `#f0ede6` on bg = 15.94:1. — _W3C WCAG 2.2 §1.4.11,
§1.4.3_

**But teal, green, and gold are nearly iso-luminant.** For red-green
colorblind readers (~1 in 12 men) the three lines collapse into one olive
smudge — verified by deuteranopia/protanopia simulation. Color alone is
**not** a sufficient encoding (WCAG 1.4.1, Level A). Since the colors are
brand-locked, **redundant encoding is mandatory, not optional:**

1. **Direct end-of-line labels**, color-matched, at the right end of each
   line. Drop legend dependence. This is the single highest-leverage fix
   and it helps _every_ reader. — _datawrapper.de/blog/text-in-data-visualizations;
   datawrapper.de/blog/colorblindness-part2_
2. **Vary line style per series** — solid / dashed / dotted. So the lines
   are distinguishable in pure black-and-white ("get it right in B&W").
3. **Highlight-on-hover:** emphasize the hovered series, fade the others;
   tooltip restates the category ("Naples $620k", not "$620k").
4. **Color only what matters** when a series is context — grey it, color
   the one that carries the story.

Gridlines must also clear 3:1 against the background (check the grey).
Avoid hairline strokes on near-black — anti-aliasing can drop a nominal
3:1 below threshold. — _WCAG §1.4.11_

---

## 3. Labeling and microcopy (no jargon, ever)

Follows `06-voice-and-microcopy.md`. Chart-specific rules:

- **The title is the takeaway, in plain words.** "Typical home value" —
  never "ZHVI" or "Zillow Home Value Index." No company names, no
  acronyms, no internal slugs/table names on any public chart. Precise
  definitions (median vs. mean, methodology) go in the small print or the
  linked source page, not the title. — _Datawrapper text-in-dataviz; USWDS_
- **Numbers conversational, then precise.** `$415k` not `415000`; `27%`
  not `27.0%`. Exact values live in the tooltip. Repeat units in the
  axis, the tooltip, and any annotation — not just the description.
- **Date every chart.** A small grey `as of [Mon YYYY]` line, fed by the
  real data freshness (the `freshness_token` / latest month present),
  never a hardcoded date. **Never** a "sample"/"fixture"/"demo" badge on
  live data (see `env.source` note in §6).
- **Source line is small and grey but always present** once the sources
  brief exists. Methodology is progressive disclosure — short source on
  the chart face, click-through to the `/r/source/[table]` provenance
  page. (Until the sources brief lands, ship the chart with the `as of`
  date and no company attribution — clean, not fake.)
- **A one-sentence plain-English takeaway** sits near each chart as body
  text. It doubles as the screen-reader / no-JS / slow-connection
  fallback. "Could you recreate the chart from this sentence over the
  phone?" — _accessibility.blog.gov.uk/2023/04/13/text-descriptions-for-data-visualisations_

---

## 4. Accessibility checklist (run before shipping any chart)

- [ ] **Not color-alone.** Direct labels + line-style variation present
      (WCAG 1.4.1, Level A).
- [ ] **Text contrast** ≥ 4.5:1 (labels/axes/source) on the dark bg
      (WCAG 1.4.3). Our cream is fine; check any greyed text.
- [ ] **Non-text contrast** ≥ 3:1 for lines _and_ gridlines vs. bg
      (WCAG 1.4.11).
- [ ] **Plain-text equivalent** — a takeaway sentence in the DOM; a
      screen-reader data table (`usa-sr-only`) for complex charts, with
      the visual marked `aria-hidden` (USWDS).
- [ ] **Reduced motion** — the draw-in animation is gated behind
      `@media (prefers-reduced-motion: reduce)` (render final state
      instantly when set). WCAG 2.2 Technique C39. The number is in the
      DOM from load; motion is the flourish (mirrors `02-motion-rules`).
- [ ] **Tested in a simulator** — Chrome DevTools "Emulate vision
      deficiencies" (deuteranopia + protanopia) before merge.

---

## 5. Information architecture — hub and spoke

The exemplars (Our World in Data, FRED, data.census.gov) and NN/g
converge on a **hub-and-spoke hybrid**, which is exactly the operator's
instinct ("a charts link on every page, specific charts on specific
pages").

- **`/charts` is the central hub.** As it grows past 2–3 charts, lay it
  out as a **sectioned responsive card grid** (2–3 across on desktop → 1
  across on mobile), grouped under topic headers (Home Values, Rents,
  Economy, Permits, Flood Risk) — not one infinite vertical column. Each
  card: takeaway headline → chart → one-line explainer → expand/full-
  screen affordance → small grey `as of`/source footer. Lazy-load
  below-the-fold charts. — _NN/g; USWDS; OWID; data.europa responsive guide_
- **Global nav link on every page, labeled "Charts."** A persistent
  top-level entry is a recognized standard component (NN/g); OWID uses
  "Data," Census uses "Data Tools." For a consumer audience "Charts" (or
  "Market Data") is more inviting than the bare word "Data." Use the same
  word for the nav item and the page `<h1>`. — _nngroup.com/articles/ia-vs-navigation_
- **Contextual charts later (the spokes).** Embed the 1–2 most relevant
  charts directly on each topic page where the reader already is;
  contextual placement measurably lifts engagement. Each contextual chart
  links back to its fuller version on `/charts` ("See all charts →").
  Define the topic grouping (the IA) before wiring nav. — _Visier
  embedded-analytics; OWID; Census_
- **Don't require interaction to get the message.** Headline + takeaway
  must be visible before any hover/filter. Interactivity is for going
  _deeper_, not for the baseline message. — _USWDS "lossless representation"_

---

## 6. Implementation notes (this codebase)

- **RSC boundary — the rule that broke the build on 2026-06-13.** Our
  chart components are Client Components (`"use client"`, they use
  recharts + motion). The pages that render them (`app/charts/page.tsx`)
  are **Server Components** doing DB reads. **You cannot pass a function
  prop from a Server Component to a Client Component** — Next.js can't
  serialize it and `next build` aborts at prerender ("Functions cannot be
  passed directly to Client Components"). Pass a **serializable token**
  (e.g. `valueFormat="usd" | "rent"`) and resolve it to a formatter
  _inside_ the client component. Same goes for any callback/closure.
  `tsc`, eslint, and `bun test` all pass this bug — only `next build`
  (or `vercel build`) catches it. **Run a real build before pushing a
  page that wires a new chart.**
- **Data source:** charts read the `data_lake.*_pivoted` views
  (wide `{ month, cape_coral, fort_myers, naples }`) server-side via the
  service-role client. A new 3-metro chart = a new `*_pivoted` view + one
  `PANELS[]` row. Single-series data (e.g. airport) needs the component
  generalized to 1..N series.
- **Component:** `components/charts/ZHVIAreaChart.tsx` exports
  `MetroAreaChart` (the generic) with a `ZHVIAreaChart` alias. Keep the
  alias byte-identical for `embed`/`demo`/registry call sites.
- **`env.source` is refinery-only** (`refinery/config/env.mts`) — do NOT
  import it into `app/`. Live-vs-fixture provenance is decided
  per-call-site (live = `data_lake.*`; fixture = JSON in `fixtures/`), so
  attribution is passed in, never inferred from a refinery env in the
  Next bundle.

---

## 7. Current state and roadmap

**On `/charts` today (the hub):**

| Chart                          | Source view                   | Shape       |
| ------------------------------ | ----------------------------- | ----------- |
| Typical home value             | `data_lake.zhvi_pivoted`      | 3-metro     |
| Typical monthly rent           | `data_lake.zori_pivoted`      | 3-metro     |
| Air travel through the region¹ | `public.rsw_airport_monthly`  | single line |

¹ Verified live: monthly enplanements, →2026-04 (640,135, +1.7% YoY).

**Known clean candidates for later charts** (verified in the lake, but
need reshaping — not drop-ins): regional airport already wired above;
tourist-tax collections (`fl_dor_tdt_collections`, monthly, county
grain); home-value momentum (YoY % derived from `zhvi_pivoted`, zero new
source). **Not chart-ready:** permits (per-permit, geocode/value gaps),
sales tax (2-month lag), FHFA HPI (metro-aggregated, redundant with home
value). Never build a chart on data you haven't confirmed is populated
and clean.

**Spokes (future):** contextual chart on each topic page, linking back to
the matching `/charts` section.
