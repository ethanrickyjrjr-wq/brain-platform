# Quick Reference

One page. Keep open while building. Every value here is canonical;
deeper docs link from each row.

## The universal rule (re-read first)

**Animation reveals data, it does not gate it.** The number is in the
DOM from page load; motion is the flourish on top. If forced to choose
between "show the number now" and "perform a reveal," show the number
now.

## Three contexts — budget per surface

| Context      | Surface(s)                       | Default budget            | Source                   |
| ------------ | -------------------------------- | ------------------------- | ------------------------ |
| 1. In-chat   | MCP inline widget                | ≤ 300ms (subtle, default) | `02-motion-rules.md` § 1 |
| 1. In-chat   | MCP inline widget, impress mode  | ≤ 600ms                   | `02-motion-rules.md` § 1 |
| 2. Web       | Report Tier 2 (default view)     | Moderate, full send       | `02-motion-rules.md` § 2 |
| 2. Web       | Report Tier 1 (executive glance) | Minimal (block reveals)   | `02-motion-rules.md` § 2 |
| 2. Web       | Report Tier 3 (audit, carve-out) | Near-zero (single fade)   | `02-motion-rules.md` § 2 |
| 3. Marketing | `/connect` landing               | High (full send)          | `02-motion-rules.md` § 3 |

## Default timings (anchor values, ±20% OK)

| Element                    | Duration                | Easing / spring                                |
| -------------------------- | ----------------------- | ---------------------------------------------- |
| Hero verdict spring        | 700–900ms               | `createSpring({ stiffness: 90, damping: 14 })` |
| MCP widget direction word  | 500–600ms               | Same spring, capped duration                   |
| Metric row stagger         | 60–80ms gap, 400ms each | fade + rise, default ease                      |
| Number count-up            | 800ms                   | `eases.outQuint`                               |
| Chart path draw            | 800–1200ms              | `eases.outQuart`                               |
| Bar chart bar grow         | 500ms, 40ms stagger     | `eases.outCubic`                               |
| SVG county boundary draw   | 1000ms                  | `eases.outQuart`                               |
| Map route motion path      | 2–4 seconds             | meaningful speed, not "fast for fast's sake"   |
| Section reveal on scroll   | 500–700ms               | `eases.outCubic`                               |
| Hover affordance           | 120–180ms               | `eases.outQuad`                                |
| Tab crossfade (Tier 1↔2↔3) | 250ms total             | crossfade                                      |
| Caveat expand/collapse     | 200ms                   | `eases.outQuad` on height                      |

## Color tokens (anchor hex; adjust within same chroma/value)

### Surfaces

| Token             | Hex       | Use                                         |
| ----------------- | --------- | ------------------------------------------- |
| `--gulf-midnight` | `#0A1419` | Primary background                          |
| `--gulf-deep`     | `#0F1D24` | Section background just above midnight      |
| `--gulf-slate`    | `#152832` | Card / surface                              |
| `--gulf-slate-hi` | `#1C3340` | Elevated surface (hover, expanded)          |
| `--gulf-haze`     | `#22414F` | Dividers, table borders, low-emphasis lines |

### Accents

| Token             | Hex       | Use                                          |
| ----------------- | --------- | -------------------------------------------- |
| `--gulf-teal`     | `#3DC9C0` | Primary accent, CTAs, focused states         |
| `--gulf-teal-dim` | `#2A8C85` | Source links, secondary CTAs                 |
| `--mangrove`      | `#5BC97A` | **Bullish** signals                          |
| `--mangrove-dim`  | `#3D8A52` | Bullish on muted backgrounds                 |
| `--sunset-coral`  | `#E08158` | **Bearish** signals                          |
| `--coral-dim`     | `#A45A3D` | Bearish on muted backgrounds                 |
| `--neutral-gold`  | `#D4B370` | **Mixed / neutral** signals; stale-data line |

### Text

| Token              | Hex       | Use                                  |
| ------------------ | --------- | ------------------------------------ |
| `--text-primary`   | `#F0EDE6` | Warm off-white (never pure white)    |
| `--text-secondary` | `#B8B4A8` | Body copy on cards, table cells      |
| `--text-tertiary`  | `#807E76` | Captions, freshness token, footnotes |
| `--text-on-accent` | `#0A1419` | Text on `--gulf-teal` surfaces       |

## Type scale (rem, 16px base)

| Role                               | Size                     | Weight | Other                        |
| ---------------------------------- | ------------------------ | ------ | ---------------------------- |
| `/connect` hero                    | `clamp(3rem, 6vw, 5rem)` | 600    | tracking -2%                 |
| Report H1 (direction word, Tier 2) | `2.75rem`                | 600    | tracking -2%, lowercase      |
| Section H2                         | `1.75rem`                | 500    |                              |
| Metric value (big number)          | `2.25rem`                | 600    | tabular nums                 |
| Metric label                       | `0.875rem`               | 500    | uppercase, +0.06em tracking  |
| Body                               | `1rem`                   | 400    | line-height 1.55             |
| Body small / caption               | `0.875rem`               | 400    |                              |
| Freshness token / source URL       | `0.75rem`                | 500    | monospace, `--text-tertiary` |

**Always on numbers:** `font-variant-numeric: tabular-nums;`

## Direction → color mapping (set instantly, never animated)

```css
[data-direction="bullish"] {
  color: var(--mangrove);
}
[data-direction="bearish"] {
  color: var(--sunset-coral);
}
[data-direction="mixed"] {
  color: var(--neutral-gold);
}
[data-direction="neutral"] {
  color: var(--text-secondary);
}
```

## Anime.js v4 imports (use only these)

```js
import {
  animate,
  createTimer,
  createTimeline,
  createAnimatable,
  createDraggable,
  createSpring,
  createScope,
  svg, // svg.createDrawable, svg.createMotionPath, svg.morphTo
  text, // text.createScrambler, text.split
  stagger,
  utils,
  onScroll,
  eases,
} from "animejs";
```

If you're about to write `anime({ ... })` (v3 syntax), **stop.** Open
any `animejs-v4-examples/<folder>/index.js` and confirm the v4 shape.

## Veto list (never animate these)

- Numbers in the audit table
- Source citation links
- The freshness token
- Loading spinners (use skeletons matching final layout)
- Hover affordances on dense tables (row tint only — no background animation)
- Direction color shifts (set, don't animate)
- Bounce, elastic, or "cute" back-overshoots
- Looping decorative motion (pulsing dots, spinning rings, idle anim)
- Any animation on any error state

## The animations toggle (non-negotiable pattern)

```js
const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
const userPref = localStorage.getItem("swfl.animations") ?? "on";
const ANIMATE = userPref === "on" && !prefersReducedMotion;

const duration = (ms) => (ANIMATE ? ms : 0);
const delay = (ms) => (ANIMATE ? ms : 0);
```

`prefers-reduced-motion: reduce` overrides the user toggle to `off`
unconditionally.

## Common example folders mapped to needs

| Need                        | Open this                                                        |
| --------------------------- | ---------------------------------------------------------------- |
| Hero verdict spring shape   | `animejs-v4-examples/easings-visualizer/`                        |
| Metric row stagger          | `animejs-v4-examples/stagger/`                                   |
| Chart line/path draw        | `animejs-v4-examples/svg-line-drawing/`                          |
| Bar / graph reveal          | `animejs-v4-examples/svg-graph/`                                 |
| Map boundaries              | `animejs-v4-examples/svg-line-drawing/`                          |
| Map route motion-path       | `animejs-docs/animejs.com-documentation-svg-createmotionpath.md` |
| Headline character reveal   | `animejs-v4-examples/text/`                                      |
| Scroll-triggered reveal     | `animejs-v4-examples/onscroll-responsive-scope/`                 |
| Sticky scroll narrative     | `animejs-v4-examples/onscroll-sticky/`                           |
| Multi-element orchestration | `animejs-v4-examples/timeline-seamless-loop/`                    |
| Carousel / draggable UI     | `animejs-v4-examples/draggable-playground/`                      |
| Hero logo-style reveal      | `animejs-v4-examples/animejs-v4-logo-animation/`                 |

## When in doubt

**Cut the animation.** A still, well-typed, well-spaced page that shows
the right number first is better than an animated one that buries the
verdict in motion.
