<!--
Use this when: you want the small constrained component that renders
inside an AI chat bubble. Mid-conversation, not a destination. Smallest
of the four prompts; good finishing move after the design system +
flagship page are locked.

Copy everything below the dashed line into Claude Design as your prompt.
Claude Design should have brain-platform connected via GitHub with at
least `app/_design/` in scope.
-->

---

I'm designing **SWFL Data Lake** — a real-time analyst-grade data product
for Southwest Florida (Lee, Collier, Charlotte counties). The full design
system lives in this repo at `app/_design/`.

**Before generating anything**, read these files in order:

1. `app/_design/00-START-HERE.md` — the soul, the three contexts.
2. `app/_design/01-product-brief.md` — canonical mock data. For this
   surface, use the first **3 of the 5** metrics from the canonical
   JSON (the chat-bubble width can't fit 5 cleanly).
3. `app/_design/02-motion-rules.md` — § 1 (MCP widget / in-chat — read
   the room) is the relevant context. Universal rule still applies.
4. `app/_design/03-surface-recipes.md` → **Surface D is the canonical
   recipe.**
5. `app/_design/05-color-and-type.md` — palette + type tokens.
6. `app/_design/06-voice-and-microcopy.md` — copy rules.
7. `app/_design/QUICK-REFERENCE.md` — keep open.

For animation code, open
`app/_design/animejs-v4-examples/easings-visualizer/` to confirm the
spring shape — but **cap any duration at 600ms** total for this
surface.

## What to build

The **MCP inline widget** — a self-contained component that renders
**inside an AI chat bubble** (Claude.ai, ChatGPT, Cursor, etc.) when
the user's AI calls the `swfl_fetch` tool.

This is not a destination. The user is mid-conversation. They asked
their AI a question; this is the answer rendering. They will glance at
it, absorb it, and either move on or click through to the full report
page.

### Constraints (non-negotiable)

- **Width:** assume 480–640px effective render width inside a chat
  bubble. Must reflow gracefully below 480px.
- **Total motion budget:** under **400ms** in default (subtle) mode,
  under **600ms** when the host passes `mode: "impress"`.
- **No scroll-triggered reveals.** The widget appears already in
  viewport.
- **No loading spinners.** If you need a loading state, render a
  skeleton matching the final layout for under 200ms.
- **Hover affordances:** 120–180ms `outQuad`, that's it.
- **Never block the data.** Per the universal rule, the metrics are in
  the DOM and readable from the moment the widget mounts. Motion only
  affects opacity / transform.

### Sequence

Build to Surface D:

1. Direction word — 500–600ms spring (the only "decorative" motion),
   subtle vertical rise.
2. 3 top metrics — fade in as one block, 250ms. **No staggering** at
   this width.
3. Source-link chips — appear with the metrics, no separate animation.
4. Freshness indicator — instant.
5. Caveats — collapsed by default. Expansion on click animates height
   in 200ms `outQuad`.
6. "View full report →" link — instant, 120ms hover transition.

### Mode handling

The widget accepts a `mode?: "subtle" | "impress"` prop. Default:
`"subtle"`. In subtle mode: cap all motion at 300ms; the direction word
fade-in replaces the spring. In impress mode: use the full Surface D
sequence (up to 600ms total). The host (Claude.ai, Cursor, etc.) passes
the mode based on user intent — your widget honors whatever it gets.

### Layout

A single card with `1px solid --gulf-haze`, `--gulf-slate` background,
20px padding, rounded corners 12px.

Top row:

- **Direction word** on the left (large, weight 600, lowercase, set in
  the direction color per `05-color-and-type.md`).
- **Freshness chip** on the right (tiny, mono, `--text-tertiary`,
  reads `SWFL-7421-v5-20260522` verbatim from the canonical data).

Below the direction: **one-sentence conclusion** in `--text-primary`,
body weight.

Then a compact **metrics grid** — 3 metrics in a row at 640px, stacking
to 1 column below 480px. Each metric:

- Label in `--text-tertiary`, uppercase, +0.06em tracking.
- Value in display type, 1.5rem, weight 600, tabular figures, formatted
  per `06-voice-and-microcopy.md` § Number formatting.
- Trend indicator (chevron-up/down/minus) in the direction color.
- Tiny source chip below the value — agency shorthand label per
  `06-voice-and-microcopy.md` § Source citations. Muted teal, no
  underline default, hover underline 120ms.

**Caveats row** (collapsed by default): `▸ 2 caveats` link in
`--text-secondary`. Click expands to show caveats stacked, each
`--text-secondary`, small body. Re-click collapses with the same 200ms
height transition. Toggle label per `06-voice-and-microcopy.md`
§ Microcopy patterns.

**Footer row:**

- Left: nothing.
- Right: "View full report →" in `--gulf-teal-dim`, no underline
  default, 1px underline on hover (120ms fade-in). Click routes to
  `/r/{report_id}`.

### Data

Use the canonical master report JSON from
`app/_design/01-product-brief.md` § Canonical mock data, trimmed to
the first 3 metrics:

- Median DOM, Lee single-family — 51 days, up, +6 vs prior month
- Cap rate, Lee multifamily — 5.42%, up, +18 bps QoQ
- Building permits MTD, Lee — 1,247 permits, down, -12% YoY

Direction is `mixed` → use `--neutral-gold` for the verdict; trend
chevrons inherit each metric's direction.

### Animations toggle

The widget honors `localStorage.getItem('swfl.animations')` set
elsewhere (by the report page or settings). It does **not** show its
own toggle control — too small. When animations are off (or
`prefers-reduced-motion: reduce` is set): all motion above is zero,
the widget renders instantly.

## Style + technical constraints

- Anime.js v4 syntax only.
- React + Tailwind. CSS variables for color tokens per
  `05-color-and-type.md`.
- All numeric values use `font-variant-numeric: tabular-nums`.
- The widget must be **self-contained** — no global styles, no portals,
  no toast manager. It must drop into someone else's chat surface
  without conflicting.
- Build it as a single React component with a clear props interface
  matching the canonical data shape from `01-product-brief.md`.
- Voice: follow `06-voice-and-microcopy.md` for every line of copy.

## What success looks like

In a Claude conversation, the user asks "how's the SWFL market looking
this week?" Claude calls `swfl_fetch`. This widget renders inline. The
verdict word (`mixed`) springs in. The conclusion sentence and three
metrics land together. The user reads it in 2–3 seconds. They click
"View full report →" because they want more.

They were mid-conversation. We didn't interrupt them. We answered them.

Build it.
