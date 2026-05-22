# 04 — Context Decision Tree

Use this lookup when generating any animated component. Given **what's
on screen and how much of it**, pick the motion pattern.

## The two axes

1. **How much data?** One number → a few → many → audit dump.
2. **What's the user doing?** First arrival → reading → verifying →
   referencing.

These collapse into the table below.

## Lookup table

| Content                                | User state           | Pattern                                                 | v4 example to copy from                                                |
| -------------------------------------- | -------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Single verdict word** (bullish etc.) | First arrival        | Spring reveal, 700-900ms, settles cleanly               | `animejs-v4-examples/easings-visualizer/`                              |
| **Single hero number** (e.g. NOI)      | First arrival        | Spring reveal + `utils` number count-up, 800ms          | `animejs-v4-examples/text/` + `easings-visualizer/`                    |
| **3-6 metric rows**                    | First arrival        | Staggered fade+rise, 60-80ms between, 400ms each        | `animejs-v4-examples/stagger/`                                         |
| **3-6 metric rows**                    | Returning user       | Same stagger but 60% duration; skip if `animations:off` | `animejs-v4-examples/stagger/`                                         |
| **10+ row data table**                 | Reading / verifying  | One block fade-in, 300ms. No per-row anim.              | (no example needed — single fade)                                      |
| **Full audit / citation table**        | Verifying            | One block fade-in, 250ms. Hover tint only.              | (no example needed)                                                    |
| **Trend line / sparkline**             | First viewport entry | `svg.createDrawable()` path draw, 800-1200ms outQuart   | `animejs-v4-examples/svg-line-drawing/`                                |
| **Bar chart**                          | First viewport entry | Bars grow from baseline, 40ms stagger, 500ms outCubic   | `animejs-v4-examples/svg-graph/`                                       |
| **Gauge / dial**                       | First viewport entry | Needle spring to value, 700ms                           | `animejs-v4-examples/easings-visualizer/`                              |
| **County / region map (SVG)**          | First viewport entry | Boundaries draw 1000ms outQuart, then overlay fades     | `animejs-v4-examples/svg-line-drawing/`                                |
| **Route or path on map**               | First viewport entry | `svg.createMotionPath()`, 2-4s county-spanning          | (see `animejs-docs/animejs.com-documentation-svg-createmotionpath.md`) |
| **Headline / hero copy**               | First arrival        | `text.split()` + character stagger, 18ms/char, outQuint | `animejs-v4-examples/text/`                                            |
| **Body copy paragraphs**               | Reading              | Single block fade, 400ms. No per-sentence anim.         | (no example needed)                                                    |
| **Source citation chip**               | Anywhere             | Fade in with parent, 200ms. Never solo-animate.         | (no example needed)                                                    |
| **Freshness token**                    | Anywhere             | **Instant. Never animated.**                            | n/a                                                                    |
| **Scroll-triggered section reveal**    | Reading              | Fade+12px rise, 600ms outCubic. Fire once.              | `animejs-v4-examples/onscroll-responsive-scope/`                       |
| **Sticky scroll narrative**            | `/connect` only      | `onScroll` with sticky pinning                          | `animejs-v4-examples/onscroll-sticky/`                                 |
| **Coordinated multi-element reveal**   | First arrival        | `createTimeline()` orchestration                        | `animejs-v4-examples/timeline-seamless-loop/` + `timeline-50K-stars/`  |
| **Draggable UI control**               | Interactive          | `createDraggable()` with snap                           | `animejs-v4-examples/draggable-playground/`                            |
| **Carousel of metrics or screenshots** | Interactive          | `createDraggable()` infinite or snap                    | `animejs-v4-examples/draggable-infinite-auto-carousel/`                |
| **Hover affordance on row/card**       | Reading              | 120-180ms outQuad on bg/border. No scale on tables.     | (no example needed)                                                    |
| **Loading state**                      | Anywhere             | Skeleton matching final layout. **No spinners.**        | n/a                                                                    |
| **Tab switch (Tier 1↔2↔3)**            | Reading              | Crossfade 250ms total                                   | (no example needed)                                                    |
| **Number changing live (poll update)** | Reading              | Count animation 600ms, only if delta > 1%               | `animejs-v4-examples/text/`                                            |

## The three-context override

Given any row above, ask: **which surface is this on?** Then apply the
matching context rule from `02-motion-rules.md`.

- **MCP widget / in-chat (Context 1)** → halve the per-element budget
  and prefer block reveals over per-element staggers. Default to subtle
  mode (≤300ms, never over 400ms). Only relax to ≤600ms if the host
  passed `mode: "impress"`. **Never block the data.**
- **Web report Tier 2 (Context 2, full send)** → use the pattern as
  listed. Lazy-load heavy libs (Mapbox, Three.js).
- **Web report Tier 1 (Context 2, restraint)** → block reveal of the
  sentences; the prose IS the data. Halve per-element budgets.
- **Web report Tier 3 (Context 2, audit carve-out)** → strip to single
  block fade-in regardless of the pattern above. Hover tint only.
- **`/connect` landing (Context 3, full send marketing)** → use the
  full pattern, plus extra weight on the hero. Longer durations and
  additional timeline beats are fine here.

The universal rule from `02-motion-rules.md` overrides every entry in
this table: **the data must be in the DOM and readable from the moment
the page loads.** Reveal animations adjust opacity/transform; they
never gate access to the answer.

## The "lot of data" override

If you find yourself about to animate **more than 10 elements
individually**, stop. Either:

- Group them into 2-4 reveal chunks and animate the chunks, or
- Animate just the container (one fade-in) and let the content render
  inside.

Stagger past ~8 elements becomes visual noise. The eye can't track it,
and the page feels slow because **the user can't read until the last
element lands.**

## The "little data" override

If there is exactly **one** thing on screen worth animating (a verdict,
a hero number, a single chart), spend the budget on it. A solo spring
reveal with proper damping at 800ms is more impressive than the same
budget split across 10 elements.

This is the SWFL Data Lake's signature move: **one clean reveal of the
answer.** Everything else supports.
