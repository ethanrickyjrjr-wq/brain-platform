# AI author + right-column composer in the Social tab

**Date:** 2026-06-30
**Build slug:** `social-ai-author` · **Check:** `social_ai_author_live_verify`

## Problem

The Social tab of the Email Lab grid shell (`EmailLabGridShell.tsx`, `mode === "social"`)
renders the canvas composer (`SocialComposer.tsx`) but exposes almost no AI. Probing the
live code this session found:

- The prominent prompt-driven AI panel ("Build with AI" textarea, Build/Fill buttons,
  per-block "Now editing") is hard-gated to `mode === "email"` (`EmailLabGridShell.tsx`
  ~lines 886, 949). On the Social tab the right column keeps the "AI assistant" header
  but shows **no prompt input** — only a collapsed "Social calendar" accordion, Brand,
  and Photos.
- The composer's only AI is a single unlabeled **"Generate"** button buried in the 48px
  left rail (`SocialComposer.tsx:302`). It takes no prompt — it just fills whatever
  elements already sit on the canvas, via `buildSocialCanvasFill`.
- There is **no social author engine**. Email has two AI paths — `authorDoc` (compose the
  whole doc + layout from one sentence) and `buildContentDoc` (fill an existing skeleton).
  Social has only the fill path.
- Two silent gaps in the composer: it **cannot put a photo into an image element** (the
  Image palette adds an empty placeholder; no picker), and it **cannot edit element text**
  at all (no inspector, no inline edit). Today you can only arrange empty shapes and hit
  Generate.

Nothing is broken in the backend — `buildSocialCanvasFill` and `buildWeek` (Haiku, four-lane,
no-invention) are live. The gap is UX wiring: the Social tab shipped a manual drag-drop
canvas while the prompt-driven AI surface stayed email-only.

## Goal

Switch to the Social tab, type one sentence, and the AI composes a **finished, on-brand
post on the canvas** — picks a layout, writes cited copy and numbers, drops in a real
photo — then you edit anything (text, photos, layout). The whole control surface moves to
the right column in the email page's order. No invented numbers, ever.

## Research (RULE 0.4)

- crawl4ai pass on describe-to-build social composer UX (Buffer, Canva, Hootsuite,
  Sprout) returned marketing chrome, not concrete patterns. **Finding:** our own shipped
  email author UX (prompt box + "Build / Fill" split + chart chips + status line) is the
  proven internal best-practice; the social panel mirrors it for consistency.
- Vendor-contract facts are already verified in-code and need no re-pick: model IDs behind
  `resolveEmailModel` (`claude-haiku-4-5` / `claude-sonnet-4-6` / `claude-opus-4-8`,
  confirmed current 06/26/2026); X 280-char limit (verified 06/30/2026); `SOCIAL_FORMATS`
  (square/portrait/landscape/story). The author inherits the model router — no new model
  wiring or ID guessing.

## Decisions locked (from brainstorm)

1. **Hero job:** author one finished post from a sentence (not calendar-first, not
   fill-only).
2. **Author architecture:** template-backed (option A) — AI picks a pre-positioned layout
   template + format, then the shipped fill writes the text. Rejected: free-layout
   (fragile LLM coordinates) and email-author-convert (wrong aspect shape).
3. **Files as source:** uploaded project files are an **equal source** — files + lake +
   web weighed together, no special priority. Numbers stay four-lane / no-invention
   (structural, unchanged).
4. **Layout:** everything moves to the right "AI assistant" aside in importance order,
   mirroring the email page; canvas alone in center. Shared pieces (Brand, Photos) are
   byte-identical components, same order, not necessarily same position.
5. **Output actions** (Export PNG, Schedule post) live in the top bar next to email's
   Save / Send / Schedule — same actions, same order as email ("not same position").
   *(Open to flip under the AI panel — see Open points.)*

## Architecture — template-backed author

### Template library
New `lib/social/design/templates.ts`: each template is a brand-aware factory
`(tokens, format) => SocialDesign` with elements pre-positioned within the format's
bounds. Mirrors the email `SEED_DOCS` registry. Initial set:

- `stat-hero` — one big stat + headline + CTA.
- `headline-cta` — headline + supporting line + CTA.
- `three-stat` — three stats in a row/column + kicker.
- `listing-feature` — a real current listing: aerial image slot + price/beds stat + CTA.

Each template entry: `{ id, label, description, formats: SocialFormat[], build(tokens, format) }`.

### Flow on "Build the post"
1. **One AI call** (`authorSocialPost`). The system prompt lists the templates (id +
   description + each template's element skeleton via `designToSkeleton`) plus the data
   context (lake + web-refreshed figures + listings + project files). The model returns
   `{ templateId, format, patch, caption, hashtags, variants }` — it chooses the layout
   and writes the text only.
2. Code instantiates the chosen template as a real `SocialDesign` with brand tokens.
3. Code applies the text patch via the existing `applyDesignPatch` — which writes only
   text/stat/cta text fields and **cannot** touch geometry, colors, or image URLs.
4. Code attaches a real photo into the template's image slot (see Photos).

Because layout comes from a human-positioned template and `applyDesignPatch` is text-only,
the post can never overlap, run off-canvas, or carry a fabricated image. **"Fill" is
unchanged** for canvases built by hand (`buildSocialCanvasFill`).

### Why this is safe by construction
`designToSkeleton` exposes only `TEXT_FIELDS` (text→[text], stat→[value,label], cta→[text]);
image/logo/chart have no text fields, so the AI patch never reaches an image. The
no-invention guarantee is structural, not prompt-dependent.

## Data flow — files = equal source; numbers = four-lane

The author/fill context gains a third input beside the lake feed and the live-web refresh:
already-uploaded project files. We thread `projectId` into the route, load the project's
`kind:"file"` items' distilled `extracted_text` (schema in `lib/project/items.ts`), and
append it to the prompt context with **no priority weighting** — files, lake, and web are
weighed together.

The four-lane moat is untouched: every number flows lake → your upload/files → named web →
a figure you state, cited, never invented. Files broaden what the post is *about*; they do
not loosen how numbers are sourced.

## Right-column layout (mirror email)

Konva canvas alone in center. Right "AI assistant" aside, importance order:

1. **AI assistant** (hero, top) — prompt box + "Build the post" / "Fill" + format picker +
   status line. Same structure as email's "Build with AI".
2. **Now editing** — the new `SocialElementInspector`, appears when an element is selected
   (mirrors email's "Now editing").
3. **Add / size** — element palette + format options (relocated from the left rail).
4. **Brand** — byte-identical `BrandingBlock` (already one shared root).
5. **Photos** — the email photo picker, extracted to one shared component used by both
   shells.

Top bar (social mode): adds **Export PNG**; the existing **Schedule** retargets to the
social schedule. Send / Save / PDF / Copy HTML stay as-is.

Shared-and-identical: `BrandingBlock` and the new `PhotosPanel` are the same components in
both pages. `SocialElementInspector` is a new sibling of email's `BlockInspector` (social
elements are a different data model — `SocialElement` vs `EmailBlock` — so not a byte copy).

## Photos — supplied and user-editable

Supplied (placed by code, never invented by the AI):
- `listing-feature` carries the real current listing's lot aerial, exactly like the weekly
  builder's `attachFeaturedAerial`.
- if the project has uploaded photos, the most relevant one drops into the template's image
  slot.
- brand logo auto-fills from brand tokens (already works for logo elements).

User edits and adds:
- every element is drag / resize / rotate / delete on the canvas (already works).
- the shared `PhotosPanel` (uploaded project photos + paste-URL + upload-new) drops a real
  photo onto the selected image slot — same behavior as email's `applyPhotoUrl`.
- `SocialElementInspector` edits an element's text, font, color, and (for image slots)
  swaps the photo.

This closes the two silent gaps: image-fill and text-edit, both wired in this build.

## New / changed files

New:
- `lib/social/design/templates.ts` — template library + registry.
- `lib/social/design/author.ts` — `authorSocialPost(scope, prompt, opts)` (or fold into
  `lib/email/social-calendar/build-canvas-fill.ts`).
- `components/email-lab/PhotosPanel.tsx` — extracted from `EmailLabGridShell`, imported by
  both shells (byte-identical).
- `components/email-lab/social/SocialElementInspector.tsx`.
- a small server loader for a project's `kind:"file"` `extracted_text`.

Changed:
- `app/api/email-lab/social/generate/route.ts` — branch on `author:true` (returns a full
  `design`), accept `projectId` + `format`.
- `components/email-lab/social/SocialComposer.tsx` — reduce to canvas-only; controls move
  into the grid shell's right aside.
- `components/email-lab/EmailLabGridShell.tsx` — render the social control stack in the
  right aside for `mode === "social"`; add Export PNG / social Schedule to the top bar;
  consume the shared `PhotosPanel`.

No new brain slugs → no vocab/catalog changes.

## API contract

`POST /api/email-lab/social/generate`
- Fill (today): `{ scope?, skeleton, platforms?, goalTone? }` → `{ patch, caption, hashtags, variants, webSources }`.
- Author (new): `{ scope?, projectId?, prompt, format?, author: true, platforms?, goalTone? }`
  → `{ design: SocialDesign, caption, hashtags, variants, webSources }`.
- `author:true` with an empty/whitespace prompt → 400 (mirror the fill guard).

## Error handling + guarantees

- AI miss (no template chosen / unparseable) → keep the current canvas, show
  "couldn't build — rephrase," like email's `applied:false`.
- No photo available → image slot stays a clean placeholder; the post still ships (build
  never blocks — RULE 0.7).
- `applyDesignPatch` + text-only skeleton are the structural guard against invented
  images/geometry (already enforced).
- Server failure / no `ANTHROPIC_API_KEY` → graceful error payload, never a crash.

## Testing

- unit: every template instantiates valid geometry within canvas bounds for each declared
  format; no element overlaps the logo slot.
- unit: `authorSocialPost` parser handles `templateId` / `format` / `patch`, drops unknown
  template ids, falls back cleanly on a miss.
- unit: project-file loader returns `extracted_text`; the context composer appends it.
- existing `build-canvas-fill` tests stay green.
- live-verify: real authored post on `/email-lab`, proof into
  `verification/answer-proofs.jsonl`; close `social_ai_author_live_verify`.

## Out of scope (YAGNI)

Charts on the canvas (still placeholder), freeform AI layout, new publish platforms, and
any weekly-calendar redesign — the calendar stays as-is, just relocated in the right column.

## Open points

1. §Layout decision 5 — Export PNG / Schedule in the top bar (email-consistent, current
   default) vs. under the AI panel. Defaulted to top bar; flip if desired.
