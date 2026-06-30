# Handoff — Make socials function better in the Grid (paid) lab

> **Recommended model:** ⚡ Sonnet — 6 tasks, 7 files, keywords: architecture



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

---

# REVIEW + RESEARCH (added 06/29/2026 — code-verified, then crawl4ai)

This section corrects the body above against the actual code, then layers in outside best-practice
researched live with crawl4ai (RULE 0.4). Read it before picking up the priority list — three of the
seven items change shape.

## A. Code-verified corrections (RULE 0.5 — I opened the files)

There are **two separate social systems** in the tree, and the handoff above conflates them:

1. **`lib/social/` is a COMPLETE publish/schedule engine — not a to-do.** Beyond
   `publish.ts/targets.ts/recipients.ts`, it has: an OAuth token store (`oauth-tokens.ts`,
   `connect/oauth-config.ts`), `social_schedules` rows with **freeze-on-confirm + cadence** (mirrors
   the email scheduler), `social_posts` identity, an **engagement-polling ledger** (`engagement.ts` +
   `poll-engagement.mts`), **5 live channel adapters** (`channels/{x,meta,linkedin,gbp}`), the cron
   worker (`run-schedules.mts`) and the live `social-scheduler.yml`. Gated by `SOCIAL_PUBLISH_ENABLED`
   (dry-mode by default; three defensive checks before any live call). Item #1 ("wire to the scheduler")
   is therefore a **wiring + persist-route** job, not a backend build — correct in spirit, bigger payoff
   than implied.

2. **Item #4 is largely ALREADY BUILT.** `lib/social/render-social-image.ts` rasterizes branded,
   watermarked PNGs at **4 platform sizes** via `@resvg/resvg-js` (SVG→PNG `Buffer`, works in a route
   handler AND the cron), with the no-invention moat enforced (empty stat → block omitted, never "$0").
   It is **not wired to the lab.** Item #4 = wire it in, not write it.

3. **Publishable (5) ≠ displayable (8).** `lib/social/channels/index.ts` is a `never`-guarded
   exhaustive switch over exactly **5** platforms (x, facebook, instagram, linkedin, google_business).
   `lib/email/social/platforms.ts` lists **8** for display/branding (adds tiktok, youtube, pinterest,
   threads — explicitly Phase-2 in `lib/social/types.ts`, no adapters). Item #2 ("the 8 have one root")
   can **author** for 8 but only **publish** to 5. Per-platform UI must not offer a schedule target it
   can't fire — gate the publishable subset off the `Platform` union, not off `platforms.ts`.

4. **THE architecture seam (the real decision items #3/#4 hinge on).** The engine composes a social card
   as a **`SocialModel`** (one headline + ONE stat + optional chart → one SVG string → PNG). The lab
   composes it as an **`EmailDoc`** (a block list). `loadSocialCard` in `EmailLabGridShell` just stacks
   EmailDoc blocks full-width — a shim across two incompatible models. "Native grid composition" (#3)
   and "image export" (#4) are the SAME decision: **does a social card author as an EmailDoc rendered to
   a platform PNG, or as a SocialModel placed on the grid?** Pick one before building either.

5. **Captions ARE cited (item #5 mostly satisfied).** `lib/email/social-calendar/build-week.ts` runs
   the four-lane sourcing prompt (lake → upload → named web → `[Need: …]`), reuses the email pipeline's
   `refreshStaleLakeContext`, and `webSources` rides back on the `WeeklyCalendar`. The audit #5 asks for
   is a confirmation pass, not a rebuild — the moat plumbing is already there.

## B. Outside best-practice (crawl4ai, fetched 06/29/2026)

Sources fetched (markdown captured, scratchpad-only per the `*crawl4ai*` gitignore):
- Buffer — "Social media image sizes" (buffer.com/resources/social-media-image-sizes/)
- Sprout Social — "Social media image sizes guide" (sproutsocial.com/insights/social-media-image-sizes-guide/)
- Hootsuite — "Social media image sizes guide" (blog.hootsuite.com/social-media-image-sizes-guide/)
- Buffer — "Beginner's guide to using AI for social media scheduling" (buffer.com/resources/ai-social-media/)
- Hootsuite — "Social media calendar: tools and templates for 2026" (blog.hootsuite.com/social-media-calendar/)
- Hootsuite — "Social media for real estate" (blog.hootsuite.com/social-media-real-estate/ — nav-heavy capture; thin extraction)
- NOT fetched: Canva Magic Resize / Adobe Express (JS-only SPA pages hung the crawler; their "one design →
  auto-resize all formats" pattern is referenced below as a known UX convention, NOT as a verified-this-session source).

### B1. Verbatim platform sizes — our 4 `SOCIAL_FORMATS` are CONFIRMED CURRENT
Buffer and Sprout independently confirm the four constants in `render-social-image.ts`:
- `square` **1080 × 1080** — FB / IG / X feed square ✓
- `portrait` **1080 × 1350** — FB / IG / LinkedIn vertical feed (the recommended feed size) ✓
- `landscape` **1200 × 630** — link/horizontal preview (FB / X / LinkedIn) ✓
- `story` **1080 × 1920** — Stories AND **Reels AND TikTok all share this** ✓ (resolves the "fill Reels"
  question: Reels is 1080×1920 = our `story`, already covered — no new format needed).
- Only gaps for a full per-platform export: **Pinterest 1000×1500 (2:3)** and **YouTube thumb 1280×720** —
  both Phase-2 non-publishable platforms, so no urgency. Add only if/when their adapters land.

### B2. AI creating in the grid (prong 1 of the ask)
From Buffer's AI guide, the patterns that make AI-generated social good (not generic):
- **Prompt with all four: audience + network + tone + goal.** Buffer's worked example names the
  audience, the platform, the taste/notes, and the tone in one prompt. Our `socialPostSystem` already
  carries lake data + four-lane; ADD an explicit per-network instruction (caption shape differs per
  platform) and a goal/tone knob the user sets once.
- **Generation is metered ("AI credits").** Maps cleanly to our "builds free, SEND is the paywall":
  authoring/regeneration can be free; the cost gate sits at schedule/publish, not at generate.
- **Monitor + iterate, never blind-adopt.** A/B AI captions vs. baseline. Our `social_events` engagement
  ledger is the substrate for this loop — surface it so a user can see which AI posts performed.
- **The market leader SPLITS "create" into two surfaces — we already unify them.** Buffer's own AI
  Assistant page is explicit: its AI is **text only** — caption generation, per-platform *tailoring*
  ("Make every post platform-perfect" — a Thread vs a LinkedIn post vs an IG caption), and one-click
  tone/length editing (OpenAI-backed, free, optional, never auto-applied). The **visual** comes from the
  **Canva integration** (templates + brand assets + Magic Resize auto-resize), surfaced inside the
  composer — NOT from Buffer's AI. Our grid lab is BOTH the design canvas AND the AI fill AND the
  scheduler (`lib/social`), so we collapse what Buffer needs Buffer+Canva to do. That's a real edge —
  lean into it, don't rebuild Buffer.
- **"Compose once → adapt per platform" runs on TWO axes, and the build needs both:** (1) TEXT —
  per-platform caption variants (Buffer "content tailoring" → handoff item #2); our `socialPostSystem`
  already carries lake data + four-lane, just ADD an explicit per-network instruction + a goal/tone knob.
  (2) VISUAL — one design → many sizes (Canva Magic Resize; B1 confirms the 4 canonical aspect ratios →
  item #4). NOTE the Canva/Adobe product SPAs would not render to the crawler (≈300 chars), so Magic
  Resize is cited here as a known convention, fetched-around via Buffer's Canva-integration + content-
  repurposing pages — not a verified-this-session product spec.
- **Generation is free + unlimited (Buffer), gated nowhere at authoring.** Maps cleanly to our "builds
  free, SEND is the paywall": authoring/regeneration free; cost gate at schedule/publish, not generate.
- **Monitor + iterate, never blind-adopt.** A/B AI captions vs. baseline. Our `social_events` engagement
  ledger is the substrate — surface it so a user sees which AI posts performed.

### B3. End user actually using it (prong 2 of the ask)
From Hootsuite's calendar guide, the spine of a usable social workflow — track every post across **three
areas**:
- **Scheduling:** date, time, platform, and **Status: Draft → In review → Approved → Scheduled → Live.**
  The lab today has none of this (flat week list). The engine's `PostStatus`
  (`queued|dry_run|published|failed`) covers the back half; the front half (draft/in-review/approved) is
  a lab-side authoring state the build must add. This is item #7, with a concrete status model.
- **Content:** final caption + hashtags, the asset, the link, the format type (Reel/carousel/Story/static).
- **Workflow:** reviewer + approval notes (sign-off before live).
- **Cadence:** plan/schedule weekly in a batch so a trend can be slotted in fast — matches our
  `WeeklyCalendar` "Generate Week" already; the missing piece is letting the user move a post to a
  day/time and push it into `social_schedules`.

## C. Net recommendation (what the build should actually do, in order)
1. **Decide the composition seam first — it's a genuine fork, not a freebie.** `renderSocialImage` is a
   BESPOKE single-template SVG composer (one headline + ONE stat + optional chart). It is NOT a general
   grid rasterizer: it cannot render an arbitrary EmailDoc grid (multiple blocks, images, side-by-side,
   listing blocks). So the choice is real:
   - **(a) SocialModel-on-grid** — constrain social cards to the headline/stat/chart template. Then
     `renderSocialImage(format)` already gives you per-platform PNGs for free (the cheap path), BUT
     "native grid composition" (item #3) is limited to that template — you're not really composing freely
     on the grid.
   - **(b) EmailDoc→PNG** — let a card be a rich EmailDoc grid, then rasterize it per platform size. This
     gives true grid composition, but **that rasterizer does not exist in the tree today** (`compile-grid`
     emits HTML; the PDF path uses `EmailDocPdf`, not an image). You'd build an HTML/grid→PNG path
     (e.g. resvg can't do HTML — this needs a headless-render or `@vercel/og`/Satori route). That's net-new.
   Pick (a) for speed-to-ship, (b) for the real "create in the grid" the operator asked for. Don't start
   #3 or #4 until this is chosen — they ARE this choice.
2. **Wire "Schedule this post"** (item #1) to a persist-route over `social_schedules` + the existing
   scheduler — gating the platform picker to the **5 publishable** channels.
3. **Add the status model** (Draft → In review → Approved → Scheduled → Live) to the lab panel (item #7).
4. Per-platform caption variants + the audience/network/tone/goal prompt knobs (item #2/#6).
5. Confirm (don't rebuild) caption provenance (item #5).

Sizes are settled; no new format needed for the 5 publishable platforms.

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 2, Task 2, Task 2, Task 2 |  |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
