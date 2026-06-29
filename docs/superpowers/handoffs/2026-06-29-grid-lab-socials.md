# Handoff — Make socials function better in the Grid (paid) lab

**Date:** 2026-06-29
**Context:** Socials is now **paid-only** via the capabilities dial (`lib/email/lab/capabilities.ts`,
`FEATURE_ROUTING.socialCalendar = "paid-only"`). The free shell's Social Calendar is gated OFF; the
paid grid shell (`EmailLabGridShell`) now renders it, gated on `capabilitiesFor("paid").socialCalendar`.
This handoff is the work to make that paid social surface actually good.

## What works right now (after this session's wiring)

In `/email-lab/grid`, the Social Calendar panel (`components/email-lab/SocialCalendarPanel.tsx`) can:
- **Generate Week** → POST `/api/email-lab/social-calendar` (scope-aware) → a `WeeklyCalendar` of
  posts (`lib/email/social-calendar/{types,build-week,themes,week}.ts`). Each post = theme + caption
  + hashtags + a `card` (`EmailDoc`).
- **Copy Caption** → clipboard (caption + hashtags).
- **Load Card** → drops the post's card onto the 2D grid. Social cards are linear (no `layout`), so
  `loadSocialCard` in `EmailLabGridShell` synthesizes a full-width stacked layout per block.

That's the whole surface today: generate, copy, load. **No scheduling, no publishing, no
per-platform tailoring, no native grid composition.** That's the gap.

## The improvements (priority order)

### 1. Wire "Schedule this post" to the social scheduler that ALREADY runs — highest value
The publishing/scheduling backend exists and is NOT a new build:
- `lib/social/` — `publish.ts`, `targets.ts`, `recipients.ts`, `idempotency.ts`, `cadence-reuse.ts`,
  `channels/index.ts`.
- `scripts/social/run-schedules.mts` — the worker.
- `.github/workflows/social-scheduler.yml` — the live cron.

Add a **Schedule** action to the social panel (next to Copy/Load) that persists the post + cadence +
target platforms and hands off to the scheduler — mirror how email uses `ScheduleSendModal` +
`/api/deliverables/.../schedule`. Confirm the social side has (or needs) an equivalent persist+schedule
route. This is the "create socials in grid and SCHEDULE" the operator asked for, and it flips
`socialCalendar` toward its `"both"`/full intent.

### 2. Per-platform output (the 8 platforms have one root)
`lib/email/social/platforms.ts` defines the 8 platforms. The calendar emits one generic caption today.
Improve to per-platform variants — char limits, hashtag conventions, link handling — and let the user
pick which platforms a post targets, with a per-platform preview. Keep platforms reading the ONE root,
never a copy.

### 3. Native grid composition of social cards
Today `loadSocialCard` just stacks blocks full-width (a shim). Social posts are visual and
aspect-ratio-specific (IG 1080×1080 square, story 1080×1920 portrait). Give social cards real grid
layouts (image + headline + stat side-by-side), and add social-sized canvas presets so a post composes
natively on the 2D grid instead of as a stacked email.

### 4. Platform-correct image export
Social needs real image assets, not HTML. The grid lab already has the Filerobot editor + image blocks
+ `/api/email-lab/media`. Add an export that renders the social card to the right pixel dimensions per
platform. Tie into the existing render/PDF path (`/api/email-lab/render`, `compile-grid.ts`) but output
an image at platform size.

### 5. Real-data captions (the moat — verify, don't assume)
Every number in a generated caption must be cited (our data → upload → named web → user figure; never
invented). Audit `/api/email-lab/social-calendar/route.ts` + `build-week.ts`: confirm captions pull
real SWFL brain numbers with provenance, not generic copy. If a caption states a figure, it names a
source.

### 6. "New social post" create flow (not just load AI-generated)
Add a way to START a social post from scratch on a social-sized canvas (square/portrait) with
social-appropriate blocks — so the user creates in the grid, not only loads what the AI authored.

### 7. Calendar / status management
The panel is a flat week list. A real workflow needs day/time scheduling, status (draft → scheduled →
posted), and bulk actions. `lib/social` cadence pieces (`cadence-reuse.ts`) are the backbone; surface
them.

## Guardrails for whoever picks this up
- Socials stays **paid-only**: read `capabilitiesFor(tier)` — never hardcode the tier difference.
  `lib/email/lab/capabilities.test.ts` enforces it; don't relax the test.
- Platforms = one root (`lib/email/social/platforms.ts`). Captions = cited, never invented.
- Don't build a new scheduler — wire the existing `lib/social` + `social-scheduler.yml`.

## Files touched this session (the wiring this handoff builds on)
- `lib/email/lab/capabilities.ts` + `capabilities.test.ts` — the tier dial (socials = paid-only).
- `components/email-lab/EmailLabShell.tsx` — free: social section gated off via `caps.socialCalendar`.
- `components/email-lab/EmailLabGridShell.tsx` — paid: social state + handlers + gated render added;
  `loadSocialCard` synthesizes grid layout.
- `lib/email/CLAUDE.md` — dial breadcrumb.
