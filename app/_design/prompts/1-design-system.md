<!--
Use this when: you want to ground Claude Design in the SWFL Data Lake
look-and-feel before building any product surface. This is the safest
first paste — it produces a single self-contained page that demonstrates
the palette, typography, and signature motion language. Use the result
to validate the vibe, then build product surfaces with the other prompts.

Copy everything below the dashed line into Claude Design as your prompt.
Claude Design should have brain-platform connected via GitHub with at
least `app/_design/` in scope.
-->

---

I'm designing **SWFL Data Lake** — a real-time analyst-grade data product
for Southwest Florida (Lee, Collier, Charlotte counties). The full design
system lives in this repo at `app/_design/`.

**Before generating anything**, read these files in order:

1. `app/_design/00-START-HERE.md` — the soul of the product, the three
   contexts, the universal rule.
2. `app/_design/02-motion-rules.md` — the three-context motion model,
   vetoes, default timings. **Most important file.**
3. `app/_design/04-context-decision-tree.md` — content × user state →
   motion pattern lookup.
4. `app/_design/05-color-and-type.md` — gulf palette + type system as
   concrete tokens.
5. `app/_design/06-voice-and-microcopy.md` — how the product talks.
6. `app/_design/QUICK-REFERENCE.md` — one-page cheat sheet to keep open.

Then open `app/_design/animejs-v4-examples/easings-visualizer/`,
`stagger/`, `svg-line-drawing/`, and `text/` to confirm the v4 API
shape before writing any animation code. Anime.js v4 ≠ v3.

## What to build

A single-page **design system / atmosphere page** at route `/design`.
This is not a product surface — it's an internal show-and-tell that
demonstrates the SWFL Data Lake visual identity in working form. Treat
it like a polished `/brand` page that the team uses to validate every
other surface against.

The page must contain, in this order:

1. **Hero**
   - Wordmark "SWFL Data Lake" set in display type, weight 600,
     tracking -2%.
   - Tagline below: "Real answers about Southwest Florida. Sourced.
     Fresh. Surgical."
   - Hero reveals via character-level `text.split()` + stagger,
     `eases.outQuint`, 18ms per char. Tagline fades in at +400ms.

2. **The signature reveal demo**
   - A live demo of the hero verdict spring in working form.
   - Show all four direction states side by side as cards: `bullish`,
     `bearish`, `mixed`, `neutral`. Each card has the verdict word, a
     placeholder sample metric, and the direction color applied per
     the mapping in `05-color-and-type.md`.
   - Add a "Replay reveal" button that re-fires the spring on all four
     simultaneously. Use `createSpring({ stiffness: 90, damping: 14 })`.

3. **Color tokens**
   - Surface, accent, and text swatches from
     `app/_design/05-color-and-type.md`.
   - Each swatch shows the token name and the hex anchor value.
     Click-to-copy on the hex.

4. **Typography scale**
   - Live samples at every scale step from `QUICK-REFERENCE.md`:
     `clamp(3rem, 6vw, 5rem)` hero, 2.75rem H1, 1.75rem H2, 1rem body,
     0.875rem caption, 0.75rem mono freshness token.
   - One sample uses `font-variant-numeric: tabular-nums` next to a
     proportional-figures sample so the alignment difference is visible.

5. **Motion principles, live**
   - Three live mini-demos, each labeled and replayable:
     - "Hero verdict spring" — single big number springs to value with
       count-up.
     - "Metric row stagger" — five placeholder metric rows stagger in
       (60–80ms between rows).
     - "SVG path draw" — a small placeholder trend line drawn via
       `svg.createDrawable()`, 1000ms, `eases.outQuart`.

6. **Animations toggle (working)**
   - A real toggle in the top right that flips `animations: on/off` and
     persists to `localStorage` under key `swfl.animations`. When off,
     all demos above render instantly. Also respect
     `prefers-reduced-motion: reduce` unconditionally. See the exact
     pattern in `app/_design/02-motion-rules.md` § The toggle.

7. **Footer**
   - Mono freshness token line: `Design system v0.1 — 2026-05-22`.
   - Tiny source link styled per `05-color-and-type.md` (muted teal,
     no underline by default, 1px underline fade-in on hover).

## Style + technical constraints

- Anime.js v4 syntax only. Confirm against
  `app/_design/animejs-v4-examples/` before writing animation code.
- React + Tailwind. Use CSS variables for the color tokens.
- The page background uses the subtle `--gulf-midnight` → `--gulf-deep`
  gradient implying depth. Cards are flat with `1px solid --gulf-haze`
  borders. **No drop shadows.**
- Source link styling: `--gulf-teal-dim`, no underline by default, 1px
  underline fade-in on hover (120ms).
- All numbers anywhere on the page use
  `font-variant-numeric: tabular-nums`.
- Mobile: stack the cards vertically below 720px.
- Follow voice rules in `06-voice-and-microcopy.md` for any copy: no
  hype, lowercase verdict words, quantified trends.

## What success looks like

When I open this page, my first thought is "this is more polished than
anything I've seen in Florida real estate data." The hero reveal feels
inevitable. The color tokens look like a real research firm's brand
system. Toggling animations off makes the page instantly static with
zero motion residue.

Build it.
