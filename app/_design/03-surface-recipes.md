# 03 — Surface Recipes

Animation budget and pattern per product surface. Treat as constraints.

Each recipe ends with **which `animejs-v4-examples/` folders to open**
before implementing.

---

## Surface A — Report Page Tier 2 (default view, the main body)

The most-used view. Structured: hero verdict → metrics table → drivers →
caveats → upstream links → freshness token.

**Context:** Web report page — Context 2 per `02-motion-rules.md` § 2.
Full send: spend the budget, lazy-load any heavy libs.

**Animation budget:** Moderate.

**Sequence (on first arrival only — see returning-user rule):**

1. **Hero verdict** (the direction word: "bullish" / "bearish" / "mixed" /
   "neutral"): spring reveal with subtle vertical rise, 700-900ms, settles
   cleanly. Direction color is set instantly — only the form springs in.
2. **Headline conclusion sentence:** fade + 4px upward translate, 500ms,
   starts at +300ms after the verdict begins.
3. **Metrics table rows:** staggered fade+rise, 60-80ms between rows, each
   row 400ms. Begins at +600ms.
4. **Number values in the table:** count up from 0 to final value as the
   row reveals. 800ms count, `eases.outQuint`. Show units throughout
   (don't reveal them with the number).
5. **Drivers section:** fades in as a block, 500ms, no per-item stagger.
6. **Caveats:** fade in last, 400ms, slightly reduced opacity by default
   (this is a "yes but" — visually secondary).
7. **Freshness token:** appears instantly, no animation. It's a proof
   element.

**Then stillness.** Nothing pulses, nothing loops.

**Reference examples to open:**

- `animejs-v4-examples/easings-visualizer/` — confirm spring shape
- `animejs-v4-examples/stagger/` — row stagger pattern
- `animejs-v4-examples/advanced-grid-staggering/` — refined stagger params
- `animejs-v4-examples/text/` — number/text reveals
- `animejs-docs/animejs.com-documentation-easings-spring-easing.md`

---

## Surface B — Report Page Tier 1 (executive glance)

Two-to-five-sentence summary. The user wants the answer in 3 seconds.

**Context:** Web report page — Context 2 per `02-motion-rules.md` § 2,
restraint-mode. Same surface as Tier 2; minimal motion because the
sentences ARE the data.

**Animation budget:** Minimal.

**Sequence:**

1. **Verdict word:** spring reveal, 600ms. Same as Tier 2.
2. **The 2-5 sentences:** fade in as a single block, 400ms. **No
   per-sentence staggering.** The sentences are the data here; don't
   perform them.
3. **Source-link chip(s) at the bottom:** fade in last, 300ms.

That's it. Done in under 1.2 seconds.

**Reference examples:**

- `animejs-v4-examples/easings-visualizer/` — spring shape only

---

## Surface C — Report Page Tier 3 (raw audit)

Full citation table. People are verifying numbers. They came to find
something specific.

**Context:** Web report page — Context 2 per `02-motion-rules.md` § 2,
audit-tier carve-out. The "full send" rule does NOT apply here; this is
the citation-verification flow.

**Animation budget:** Near-zero.

**Sequence:**

1. **Whole audit block:** single fade-in, 300ms, on tab switch or page
   load. Once.
2. **Tab switch from Tier 2 → Tier 3:** the existing Tier 2 content
   fades to 60% opacity then unmounts as Tier 3 fades in. Crossfade
   total 250ms.
3. **No per-row animation.** Ever. Rows might be 100+ in some reports.
4. **Filter / sort interactions:** instant. The table re-renders without
   any motion.
5. **Hover on a row:** background tint shifts in 120ms (`eases.outQuad`).
   That's the only ongoing motion in this surface.

**Reference examples:**

- `animejs-docs/animejs.com-documentation-easings.md` (outQuad usage)

---

## Surface D — MCP Inline Widget (renders in a Claude chat bubble)

Constrained width, mid-conversation, not a destination. The user is in
the middle of asking their AI a question — this is the answer rendering.

**Context:** MCP / in-chat — Context 1 per `02-motion-rules.md` § 1.
Read the room: default to subtle (≤300ms, never over 400ms). If the host
passes `mode: "impress"` via prop or tool-call args, you may relax to
≤600ms total. Default mode is subtle. **Never block the data.**

**Animation budget:** Tiny.

**Sequence:**

1. **Direction word:** 500-600ms spring, subtle. This is the only
   "decorative" motion allowed in this surface.
2. **3-4 top metrics:** fade in as one block, 250ms. No staggering — at
   this width, stagger looks accidental.
3. **Source-link chips:** appear with the metrics, no separate animation.
4. **Freshness indicator:** instant.
5. **Caveats:** collapsed by default. Expansion (on user click) animates
   the height in 200ms `outQuad`.
6. **"View full report" link:** instant, with a 120ms hover transition.

**Width constraint:** assume 480-640px effective render width inside a
chat bubble. Layout must reflow gracefully below 480px.

**Reference examples:**

- `animejs-v4-examples/easings-visualizer/` — spring shape, but cap
  duration at 600ms
- `animejs-docs/animejs.com-documentation-getting-started-using-with-react.md`
  — if rendered in a React MCP UI

---

## Surface E — `/connect` Landing Page

First-impression page. Users arrive here to install SWFL Data Lake into
their AI. They have not yet decided to trust this product.

**Context:** Marketing landing — Context 3 per `02-motion-rules.md` § 3.
Full send. Same performance constraints as web reports: lazy-load heavy
libs, don't block first paint.

**Animation budget:** High — but every beat is paid for by user trust
gained.

**Sequence (entire `createTimeline()` orchestration):**

1. **Hero headline:** text reveals via `text.split()` + character
   stagger, 800ms total, 18ms per char, `eases.outQuint`. One headline
   only — don't stagger multiple headlines.
2. **Hero supporting line:** fade in at +400ms after headline begins,
   500ms.
3. **Install command block:** rises in with a subtle scale 0.96→1 +
   fade, 600ms spring. Begins at +900ms.
4. **Copy button:** appears with the install block. On click: 150ms
   "pressed" scale (1→0.96→1) + checkmark crossfade in. The
   feedback is the reward.
5. **Multi-client install tabs:** appear as a row, 400ms fade. No
   per-tab stagger.
6. **Waitlist section:** scroll-triggered (`onScroll`). Fade + 12px
   rise, 600ms, when it crosses 70% into viewport.
7. **Each waitlist checkbox row:** staggered 50ms when the section
   reveals. (Exception to the "no stagger below the fold" rule —
   this is the secondary engagement moment.)
8. **Privacy line near form:** fades in with the form, 300ms.
9. **Support section (async only, Slack/Discord placeholder):** fade
   in at scroll, 400ms.

**The install command is the climax.** Everything before it builds toward
"copy this and you're in." Everything after it is supporting.

**Reference examples (priority order):**

- `animejs-v4-examples/animejs-v4-logo-animation/` — hero-scale reveal
- `animejs-v4-examples/text/` — character-level text reveal
- `animejs-v4-examples/onscroll-sticky/` — scroll-triggered reveals
- `animejs-v4-examples/onscroll-responsive-scope/` — viewport-aware reveals
- `animejs-v4-examples/timeline-seamless-loop/` — `createTimeline()` shape
- `animejs-docs/animejs.com-documentation-events-onscroll.md`
- `animejs-docs/animejs.com-documentation-timeline.md`

---

## Cross-cutting: charts and maps

These appear inside report pages (Tier 2 mostly, sometimes Tier 1).

### Charts (trend lines, bar charts, gauges)

- **Path/line charts:** draw the line with `svg.createDrawable()` on
  viewport entry, 800-1200ms, `eases.outQuart`. Then still.
- **Bar charts:** bars grow from baseline, staggered 40ms, 500ms each,
  `eases.outCubic`.
- **Gauges:** needle springs to value, 700ms, same spring as hero verdict.
- **Axis labels:** appear after the chart, 200ms fade. Don't stagger.
- **Tooltips:** instant on hover. 120ms hover transition only.

**Reference examples:**

- `animejs-v4-examples/svg-line-drawing/` — path drawing baseline
- `animejs-v4-examples/svg-graph/` — graph reveals
- `animejs-docs/animejs.com-documentation-svg-createdrawable.md`

### Maps (county/region views, route overlays)

- **Map fades in once** at 400ms. No flashy intro.
- **County boundaries draw in** with `svg.createDrawable()` IF the map is
  SVG-based, 1000ms, `eases.outQuart`. Once per session.
- **Data overlay (heatmap, choropleth):** fade in over the base map,
  500ms, after boundaries finish.
- **Route/path animations** (logistics, traffic): use
  `svg.createMotionPath()` — element follows the path at meaningful
  speed (not "fast for fast's sake"). 2-4 seconds for a county-spanning
  route.
- **Pan/zoom interactions:** spring-eased, 400ms, `damping: 18`.
- **Never animate every marker.** The eye can't track it. Animate the
  viewport or the highlighted route only.

**Reference examples:**

- `animejs-v4-examples/svg-line-drawing/` — boundary drawing
- `animejs-v4-examples/animatable-follow-cursor/` — pan-like motion
- `animejs-docs/animejs.com-documentation-svg-createmotionpath.md`

---

## Cross-cutting: scroll behavior across all surfaces

- Use `onScroll` with `enter: 'bottom-=20% top'` (element starts revealing
  when its bottom is 20% into the viewport from below).
- Reveals **fire once.** Do not re-trigger on scroll-up — that reads as
  twitchy.
- For long report pages, group reveals into 3-5 sections. Don't reveal
  every paragraph individually.
- Sticky sections (charts that pin while scroll narrates) — only on
  `/connect` and dedicated explainer pages. Not on report pages
  (analysts scroll fast).

**Reference examples:**

- `animejs-v4-examples/onscroll-sticky/`
- `animejs-v4-examples/onscroll-responsive-scope/`
- `animejs-docs/animejs.com-documentation-events-onscroll.md`

---

## Cross-cutting: empty, loading, and error states

Every surface above has degraded states. They get the same hierarchy
discipline as the happy path — and **no decorative motion.**

### Loading (fetch in flight)

- Render a **skeleton matching the final layout.** Same row count, same
  card dimensions, same spacing as the resolved state. The page must not
  reflow when data lands.
- Skeleton color: `--gulf-slate-hi` at 50% opacity. **No shimmer loop**
  (the no-decorative-loops rule applies). Static skeleton blocks only.
- If a fetch is still running after 2 seconds, replace skeleton labels
  with single-line status text in `--text-tertiary`:
  "Fetching from {source name}…" Once. Static.
- **No spinners. Anywhere.** A spinner is a confession that the page
  failed.

### Empty (data resolved, nothing to show)

- Be specific about WHAT is empty. Never write "No data."
  - Bad: "No data."
  - Good: "No multifamily transactions in Cape Coral Tier-A this
    quarter (n=0)."
- If a metric exists but the upstream brain is stale, render the value
  as `—` and append a caveat: "Data refresh pending — last computed
  {timestamp}." Use the freshness token if available.
- No empty-state illustrations. Plain text in `--text-secondary`.
- The verdict word still appears, set to `neutral` direction color, with
  conclusion text explaining the empty state in one sentence.

### Error (fetch failed, source unreachable)

- Translate everything to plain English. No "500", no "fetch error",
  no error codes in user-facing copy.
- Per-metric failure: render the label, an em-dash for value, and a
  single line beneath: "Couldn't reach {source}." Link the source URL
  so the user can verify manually.
- Whole-page failure: render the layout shell with one block of copy:
  "We couldn't load this report right now. The data lives at
  {source URL} if you need it now." Show the most recent cached
  freshness token if available.
- **No animation on any error state.** No shake, no flash, no color
  pulse. The data didn't load; perform nothing.

### Stale (data resolved but past freshness TTL)

- Render normally with a single line in `--neutral-gold` above the
  conclusion: "This report is {N} days past its expected refresh."
- Don't block the report. Stale data is still data; the user can
  decide whether to trust it.
