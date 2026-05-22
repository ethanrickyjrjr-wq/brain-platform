<!--
Use this when: you want the install/landing page. /connect is where new
users arrive to install SWFL Data Lake into their AI. First impression
matters most here — animation budget is high. Use this prompt after the
design system is locked, or run it standalone if you want a quick wow.

Copy everything below the dashed line into Claude Design as your prompt.
Claude Design should have brain-platform connected via GitHub with at
least `app/_design/` and `app/connect/` (or wherever /connect lives) in
scope.
-->

---

I'm designing **SWFL Data Lake** — a real-time analyst-grade data product
for Southwest Florida (Lee, Collier, Charlotte counties). The full design
system lives in this repo at `app/_design/`.

**Before generating anything**, read these files in order:

1. `app/_design/00-START-HERE.md` — the soul, the three contexts.
2. `app/_design/02-motion-rules.md` — § 3 (`/connect` landing — full
   send, marketing) is the relevant context. Universal rule still
   applies.
3. `app/_design/03-surface-recipes.md` → **Surface E is the canonical
   recipe.**
4. `app/_design/05-color-and-type.md` — palette + type tokens.
5. `app/_design/06-voice-and-microcopy.md` — copy rules. The
   /connect-specific microcopy patterns (copy button, waitlist submit,
   tab labels, brand prose patterns) are toward the end.
6. `app/_design/QUICK-REFERENCE.md` — keep open.

For animation code, open the example folders cross-referenced in
Surface E: `animejs-v4-logo-animation/`, `text/`, `onscroll-sticky/`,
`onscroll-responsive-scope/`, `timeline-seamless-loop/`.

## What to build

The **`/connect` landing page** at route `/connect` — where new users
arrive to install SWFL Data Lake into their AI assistant (Claude,
ChatGPT, Cursor, Windsurf, etc.).

This is the first-impression page. Animation budget is **high**. Every
beat is paid for by user trust gained. The install command is the
climax.

### Sequence (one orchestrated `createTimeline()`)

Build exactly to Surface E's nine beats. Summary:

1. Hero headline — `text.split()` + char stagger, 800ms total,
   18ms per char, `eases.outQuint`
2. Hero supporting line — fade in at +400ms
3. Install command block — scale 0.96→1 + fade, 600ms spring at +900ms
4. Copy button — appears with install block; on click 150ms press
   feedback + checkmark
5. Multi-client install tabs — 400ms fade as a row
6. Waitlist section — scroll-triggered, fade + 12px rise, 600ms
7. Waitlist checkbox rows — 50ms stagger when section reveals
8. Privacy line — fades in with the form, 300ms
9. Support section — fade in at scroll, 400ms

### Sections, top to bottom

**Hero**

- Headline: "Real answers about Southwest Florida." (display type,
  weight 600, tracking -2%)
- Supporting line: "Install once. Your AI gets sourced data on housing,
  CRE, permits, traffic, tourism, hurricane risk, and the macro context
  behind them."
- Small mono freshness chip in `--text-tertiary`:
  `Last data refresh: 2026-05-22`. Instant, no animation.

**Install command block** (the centerpiece)

```
claude mcp add --transport http swfl https://brain-platform-amber.vercel.app/api/mcp
```

- Mono type (JetBrains Mono or IBM Plex Mono), weight 500.
- `--gulf-slate` card with `1px solid --gulf-haze`.
- Copy button on the right, `--gulf-teal` background,
  `--text-on-accent` text.
- Copy button microcopy per `06-voice-and-microcopy.md`: idle `Copy`,
  after success `Copied ✓` for 1500ms then revert.

**Multi-client install tabs** (below the install command)

Five tabs in a row: `Claude` (default) / `ChatGPT` / `Cursor` /
`Windsurf` / `Other`. Switching tabs swaps content with a 200ms
crossfade.

- **Claude** — CLI one-liner (same as above) + a "Claude Desktop"
  sub-section with a JSON config snippet.
- **ChatGPT** — Numbered steps:
  1. Settings → 2. Developer Mode → 3. Connectors →
  2. paste this URL: `https://brain-platform-amber.vercel.app/api/mcp`
- **Cursor** — Single "Install in Cursor" button (deep-link
  placeholder `cursor://mcp/install?url=...`).
- **Windsurf** — Single "Install in Windsurf" button (deep-link
  placeholder).
- **Other** — Generic URL + transport type (`http`) in a small table.

**Waitlist section**

Heading: `Coming next — pick what you want first`

Email input + five checkbox rows (each checkbox stacked vertically
with its label + 1–2 sentence description in `--text-secondary`):

- ☐ **New data lakes** — Tampa, Miami, statewide Florida.
- ☐ **Your own vault** — save what your AI figures out, so the next
  conversation builds on the last.
- ☐ **Sharper numbers** — new sources, tighter confidence math,
  contradiction surfacing.
- ☐ **Delivered to Slack** — your team sees the read without leaving
  the channel.
- ☐ **Reports as documents** — ask your AI for a sourced PDF or doc,
  get one.

Submit button microcopy per `06-voice-and-microcopy.md`: idle
`Get notified`, after success `On the list ✓` for 1500ms then revert.

**Privacy line** (small, directly under the form)

"Your email and interests stay on our infrastructure. We don't sell,
share, or feed them to any third party."

Set in `--text-tertiary`, body small.

**Support section**

Heading: `Need help?`

Body: "We're async only. Drop into our Slack or Discord and we'll get
back to you within a business day."

Two link buttons: `Slack` and `Discord` (placeholder URLs `#`).

**Footer**

Mono freshness token: `Connect page v0.1 — 2026-05-22`. Tiny.

## Style + technical constraints

- Anime.js v4. Confirm against `app/_design/animejs-v4-examples/`
  before writing animation code.
- React + Tailwind. CSS variables for color tokens per
  `05-color-and-type.md`.
- Animations toggle in top-right (small gear or text link). Persist to
  `localStorage` under `swfl.animations`. When off, the page renders
  instantly with no motion. Respect `prefers-reduced-motion: reduce`.
- Background: subtle `--gulf-midnight` → `--gulf-deep` gradient.
- Mobile: tabs collapse to an accordion below 720px. Hero headline
  scales via `clamp(2.5rem, 7vw, 4.5rem)`.
- Voice: follow `06-voice-and-microcopy.md`. Brand prose patterns at
  the end of that file are the calibration.

## What success looks like

A new user lands on `/connect`. The headline reveals character-by-
character. The supporting line follows. The install command rises into
place with a spring that lands clean. They click the copy button — it
acknowledges them. They paste it into their terminal. They're in.

Then they scroll. The waitlist section reveals. They check two
interests and submit. The button thanks them.

Their first thought before they even installed anything was: "these
people take data seriously."

Build it.
