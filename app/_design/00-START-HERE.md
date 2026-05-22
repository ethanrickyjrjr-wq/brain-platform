# 00 — Start Here

You are designing the **SWFL Data Lake** — a real-time analyst-grade data
product for Southwest Florida.

## The soul of this product

Data should feel like it's **surfacing from deep water.** Slow enough to
feel intentional, fast enough to feel responsive. Spring physics that
settle — not bouncy, not elastic, not "cute." Every number has a source.
Nothing is invented. The most important insight lands first; everything
else supports.

> What if a premium research firm had the soul of a great data
> visualization studio?

If you take nothing else from this folder, take that.

## The three contexts (where this product lives)

1. **Inside an AI chat** — the MCP widget. Mid-conversation. The user is
   working, not browsing. Read the room: subtle by default, slightly
   more animated if they explicitly ask to be impressed.
2. **On a full web report page** at `/r/{report_id}`. A destination. Full
   send: maps, full Anime.js sequences, 3D when it earns its place.
3. **On the `/connect` landing page**. Marketing surface. Stop people
   mid-scroll. Full send.

The universal rule across all three: **animation reveals data, it does
not gate it.** The number is in the DOM from page load; the motion is
the flourish on top.

## Read in this exact order before generating anything

1. **`01-product-brief.md`** — what we're building, who it's for, the
   canonical data shape (master report JSON).
2. **`02-motion-rules.md`** — the three-context model, vetoes, the
   "earn its place" test, default timings, the toggle. **This is the
   most important rule file. Re-read it before any animation decision.**
3. **`03-surface-recipes.md`** — beat-by-beat animation sequence per
   product surface, plus empty/loading/error states. Treat as
   constraints, not suggestions.
4. **`04-context-decision-tree.md`** — given a piece of content (single
   metric / table / chart / map / audit dump), which motion pattern to
   use. Quick lookup for every component.
5. **`05-color-and-type.md`** — gulf palette + type direction in
   concrete tokens.
6. **`06-voice-and-microcopy.md`** — how the product talks. Number
   formatting, trend language, empty-state copy, error wording.

When you need to pick a build target, look in **`prompts/`** — one
ready-to-use prompt per surface, plus a chooser README.

When you need a fast lookup mid-build, **`QUICK-REFERENCE.md`** at the
folder root is the one-page cheat sheet.

## Then, when you need to implement

- **`animejs-v4-examples/`** — 24 standalone working v4 apps. **These are
  your primary code reference, not the docs.** Each is a tiny
  `index.html` + `index.js` showing real v4 import syntax and a real
  pattern. The rule docs above cross-reference these by folder name.
- **`animejs-docs/`** — API reference for parameter signatures, callbacks,
  edge cases. Reach for these when an example uses an API and you need
  the precise shape.

## Critical version note

Anime.js **v4** is a different library from v3. v3 syntax will not run.
Always import from the v4 module surface:

```js
import {
  animate,
  createTimer,
  createTimeline,
  createAnimatable,
  createDraggable,
  createSpring,
  createScope,
  svg, // includes svg.createDrawable, svg.createMotionPath, svg.morphTo
  text, // includes text.createScrambler, text.split
  stagger,
  utils,
  onScroll,
  eases,
} from "animejs";
```

The `animejs-v4-examples/` folder is the ground truth for which APIs are
real. If you're tempted to write v3-style `anime({ ... })`, **stop and open
an example folder** — confirm the v4 syntax before generating.

## Hard constraints (from the brief)

- All animations must be **toggleable** via an `animations: on/off`
  preference. When off, instant render, no motion. See
  `02-motion-rules.md` for the toggle pattern.
- **No bounce, no elastic.** Spring physics with damping that settles
  cleanly. The aesthetic is "surfacing from water," not "rubber band."
- Every animation must earn its place. If you can't articulate the
  insight an animation reveals, delete it.
