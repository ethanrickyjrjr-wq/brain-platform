# Social Media Calendar in Email Lab

**Date:** 2026-06-28
**Slug:** `social-calendar-lab`
**Check:** `social_calendar_lab_live_verify`

---

## Problem

Real estate agents need a consistent weekly social media presence backed by real local data. Every competitor posts generic tips ("great time to buy!"). Our agents can post actual SWFL numbers — median price, days-on-market, inventory shifts — but today there's no surface to generate that content in under 5 minutes.

The Email Lab already has the full data pipeline (lake figures + master dossier + web fallback) and the AI fill system. The social calendar wires those together into a week of ready-to-post content.

---

## Goal

One click in the Email Lab generates a 5-post Mon–Fri social media calendar for the agent's scope (ZIP or county). Each post has:
- A platform-agnostic caption (280 words max, hook-first, real SWFL data, CTA, hashtags)
- A social card `EmailDoc` (hero + supporting blocks, no header/footer, square-renderable)

The user can copy any caption to clipboard and load any card into the canvas for final editing and export.

---

## What We're Building

### Five Day Themes

Each day has a fixed content shape and block template. The AI fills content; the shape is not negotiable.

**Monday — Market Monday**
- Block shape: `hero` (headline stat) + `stats` (2 KPIs)
- Content focus: one headline metric (median price or DOM) + two supporting figures
- Caption hook: lead with the most surprising number from the week's data
- Primary data source: master dossier → price/DOM/inventory

**Tuesday — Tip Tuesday**
- Block shape: `signal` (the tip) + `text` (one-paragraph expansion)
- Content focus: a buyer or seller tip, backed by exactly one cited SWFL figure
- Caption hook: the tip as a direct instruction ("Before you list, know this…")
- Primary data source: cited figures → whichever figure makes the tip concrete

**Wednesday — Neighborhood Spotlight**
- Block shape: `hero` (neighborhood stat) + `text` (local context)
- Content focus: a single ZIP, corridor, or neighborhood with one standout metric
- Caption hook: the place name + the metric in the first sentence
- Primary data source: master dossier → drill into strongest signal for the scope

**Thursday — Client Story**
- Block shape: `signal` (the win narrative) + `agent-card`
- Content focus: social proof — a closed deal story or testimonial scaffold
- Caption hook: the outcome first ("Closed in 14 days, $22K over ask")
- Primary data source: agent branding only; AI provides the narrative scaffold with `[Need: client quote]` placeholder
- Note: agent-card is identity-owned (never filled by AI), but `signal` body is AI-filled

**Friday — Local Life**
- Block shape: `text` (lifestyle paragraph) + `image` (agent adds their own photo)
- Content focus: community angle for the market — restaurants, events, local identity
- Caption hook: something that makes the area feel like a place, not a market
- Primary data source: master dossier → community/corridor character signals; web fallback for local event if lake is thin

---

## Architecture

### Data flow

```
User clicks "Generate Week"
  → POST /api/email-lab/social-calendar  { scope, brandTokens }
  → fetchLakeParts(scope)                [ONE shared lake fetch]
  → 5 parallel buildSocialPost() calls   [Haiku, one per theme]
      each call:
        contentPatchSystem() variant     [social-tuned prompt]
        → Claude Haiku (≤512 tokens)     [caption + hashtags as JSON]
        → buildCard(theme, patch, style) [construct EmailDoc for the card]
  → return WeeklyCalendar { posts: SocialDraft[] }
Client renders CalendarPanel
  → user clicks day → expands caption + "Copy" + "Load Card"
  → "Load Card" swaps EmailLabShell's doc to draft.card
```

### Types — `lib/email/social-calendar/types.ts`

```typescript
export type CalendarDay = "mon" | "tue" | "wed" | "thu" | "fri";

export interface DayTheme {
  day: CalendarDay;
  label: string;            // "Market Monday"
  cardBlocks: BlockType[];  // ordered block types for the card doc
  systemAddendum: string;   // extra instructions for this day's AI call
}

export interface SocialDraft {
  day: CalendarDay;
  theme: string;            // "Market Monday"
  caption: string;          // ≤280 words, CTA included, no hashtags inline
  hashtags: string[];       // 5–8 tags, no # prefix (added at render time)
  card: EmailDoc;           // the visual card doc (square-renderable)
}

export interface WeeklyCalendar {
  scope: BuildScope;        // re-export BuildScope from build-doc.ts
  weekOf: string;           // ISO date string of the Monday
  posts: SocialDraft[];     // 5 items, Mon–Fri order
}
```

### Day configs — `lib/email/social-calendar/themes.ts`

```typescript
import type { DayTheme } from "./types";

export const DAY_THEMES: DayTheme[] = [
  {
    day: "mon",
    label: "Market Monday",
    cardBlocks: ["hero", "stats"],
    systemAddendum: `Lead with the most surprising or actionable market number for this scope.
The hero.value must be a real cited figure (price, DOM, or inventory level).
The stats block must have exactly 2 items — supporting KPIs that give context to the hero.
Caption: open with the hero number. One sentence of interpretation. One CTA.`,
  },
  {
    day: "tue",
    label: "Tip Tuesday",
    cardBlocks: ["signal", "text"],
    systemAddendum: `Write one concrete buyer or seller tip backed by exactly one cited SWFL figure.
signal.title is the tip headline (imperative voice). signal.body is the SWFL number that justifies it.
text.body is a 2–3 sentence expansion. No more than one number in the whole post.
Caption: the tip as a direct instruction in the first sentence.`,
  },
  {
    day: "wed",
    label: "Neighborhood Spotlight",
    cardBlocks: ["hero", "text"],
    systemAddendum: `Pick the single strongest signal for the agent's scope — one ZIP, corridor, or area.
hero.kicker is the place name. hero.value is that area's standout metric.
text.body explains what the number means for someone considering that area (2–3 sentences).
Caption: place name + metric in the first sentence.`,
  },
  {
    day: "thu",
    label: "Client Story",
    cardBlocks: ["signal"],
    systemAddendum: `Write a social-proof post. The signal block is a closed-deal narrative scaffold.
signal.kicker = "Client Win" or "Just Closed". signal.title = the headline outcome 
(e.g. "Closed in 14 days, $22K over ask"). signal.body = 2-sentence story with 
[Need: client quote] placeholder where the testimonial would go.
Do NOT fill the agent-card — it is identity-owned and populated by branding tokens.
Caption: outcome first, then the brief story, then the CTA.`,
  },
  {
    day: "fri",
    label: "Local Life",
    cardBlocks: ["text", "image"],
    systemAddendum: `Write a community/lifestyle post for the agent's market area.
text.body is a 3–4 sentence paragraph that makes the area feel like a place people want to live — 
restaurants, character, vibe, local identity. Pull any community signals from the dossier.
If the lake has no community data, use [Need: local landmark or community detail] placeholders.
image.alt describes the kind of photo the agent should add. image.caption is optional scene-setter.
Caption: open with something sensory or specific about the place, not a market stat.`,
  },
];
```

### Builder — `lib/email/social-calendar/build-week.ts`

Entry: `buildWeek(scope, brandTokens, weekOf) → Promise<WeeklyCalendar>`

Steps:
1. `fetchLakeParts(scope)` — one call, result shared across all 5 posts
2. Stale-figure check + web fallback (same logic as `buildContentDoc`) — done ONCE, result shared
3. `composeLakeContext(figures, dossier)` — produces the shared context string
4. `Promise.all(DAY_THEMES.map(theme => buildSocialPost(theme, lakeContext, brandTokens, globalStyle)))`
5. Return `{ scope, weekOf, posts }`

`buildSocialPost(theme, lakeContext, brandTokens, globalStyle) → Promise<SocialDraft>`:
1. Build card skeleton: `seedSocialCard(theme, globalStyle)` → minimal `EmailDoc` (theme's blocks, no header/footer)
2. Call Claude Haiku with:
   - System: `socialPostSystem(lakeContext, theme.systemAddendum)`
   - User: `docSkeleton(cardDoc)` — same skeleton format as email fill
   - Max tokens: 512
   - Response format: JSON with `{ captionText, hashtags, patch }` where `patch` is a standard `ContentPatch`
3. Parse response; validate `ContentPatchSchema` on `patch`
4. `applyPatch(cardDoc, patch)` — reuse existing function
5. Apply brand globalStyle (colors from brandTokens)
6. Return `{ day, theme: theme.label, caption: captionText, hashtags, card }`

`seedSocialCard(theme, globalStyle) → EmailDoc`:
- Builds a minimal `EmailDoc` from `theme.cardBlocks` using `createBlock()`
- Adds `agent-card` block for Thursday only (identity fields; AI doesn't fill it, but it renders)
- globalStyle from agent branding

`socialPostSystem(lakeContext, addendum) → string`:
```
You are a social media copywriter for a Southwest Florida real estate agent.

Return ONLY valid JSON with exactly these keys:
  captionText: string  (≤280 words, hook-first, one CTA at end, NO hashtags inline, NO em-dashes)
  hashtags: string[]   (5–8 items, NO # prefix, mix: 2 local, 2 topical, 1 brand "SWFLDataGulf")
  patch: object        (same ContentPatch format as email fill — block id → text fields only)

[same four-lane DATA SOURCING rules as email]
[same "never invent a number" rule]
[same "only allowed text fields" rule]

DAY-SPECIFIC: {addendum}
```

### API route — `app/api/email-lab/social-calendar/route.ts`

POST body:
```typescript
{
  scope?: BuildScope;
  brandTokens?: Record<string, string>;  // same as email-lab/ai
  weekOf?: string;                       // ISO Monday date; defaults to current week
}
```

Response:
```typescript
{
  calendar: WeeklyCalendar;
  webRefreshed?: string[];  // labels refreshed from web (for UI transparency)
}
```

Error: `{ error: string }` with appropriate HTTP status.

Auth: same auth guard as `/api/email-lab/ai/route.ts` (check that route's pattern and replicate).

### Render — `app/api/email-lab/render/route.ts` (modify)

Add `?mode=social-card` query param:
- When present, render at width 600px with a 1:1 aspect ratio container (square)
- Same HTML render path; the `EmailDocRenderer` already handles any block set
- No new render component needed — just a viewport size variant

### UI Panel — `components/email-lab/SocialCalendarPanel.tsx`

State:
```typescript
type PanelState = "idle" | "loading" | "ready" | "error";
const [state, setState] = useState<PanelState>("idle");
const [calendar, setCalendar] = useState<WeeklyCalendar | null>(null);
const [expanded, setExpanded] = useState<CalendarDay | null>(null);
```

Render:
- "Generate Week" button (disabled while loading; shows spinner)
- When ready: 5 day tiles (Mon–Fri) in a vertical list
  - Each tile: day label + theme name + first sentence of caption (truncated at 80 chars)
  - Click expands: full caption text, hashtag pills (`#tag`), two action buttons
  - "Copy Caption" — copies `caption + "\n\n" + hashtags.map(h => "#" + h).join(" ")` to clipboard
  - "Load Card" — calls `onLoadCard(draft.card)` prop (replaces EmailLabShell's doc)
- Error state: "Couldn't generate this week — try again" with retry button

Props:
```typescript
interface SocialCalendarPanelProps {
  scope?: BuildScope;
  brandTokens?: Record<string, string>;
  onLoadCard: (doc: EmailDoc) => void;  // caller is EmailLabShell; swaps the canvas doc
}
```

### EmailLabShell integration (modify)

Add a "Calendar" tab to the left panel tab strip (alongside whatever controls currently live there).

When Calendar tab is active: render `<SocialCalendarPanel scope={scope} brandTokens={initialTokens} onLoadCard={handleLoadCard} />` where `handleLoadCard` calls `pushDoc(history, newDoc)` so the action is undoable.

---

## Constraints

- Lake fetch is ONE call per "Generate Week" click — not five separate fetches
- All five Claude calls are Haiku (not Sonnet/Opus) — this is high-volume, low-complexity fill work
- Max 512 tokens per post (captions are short)
- No new block types — the 5 card shapes use only existing types
- Social card EmailDoc never includes header or footer blocks (those are email-specific)
- Agent-card block on Thursday is identity-only — the AI does not fill name/photo/phone; brand tokens do
- Caption max 280 words (not characters) — fits all major platforms without truncation
- Hashtags array has no `#` prefix — the UI adds the `#` at render time; the API stores clean tags
- `weekOf` defaults to the current Monday (server-side `new Date()` offset to Monday ISO string)
- No new Supabase tables — calendar state is ephemeral (in-memory, not persisted)
- The "Load Card" action goes through `pushDoc` so undo works in EmailLabShell
- `socialPostSystem` prompt is a sibling to `contentPatchSystem` — not a fork of it; they share the four-lane data rule verbatim

---

## What This Is Not

- Not a scheduler — the calendar generates drafts; the existing ScheduleSendModal handles send timing
- Not platform-specific rendering — captions are platform-agnostic; the user copies and pastes
- Not a new route — the calendar lives inside EmailLabShell as a panel, not a separate page
- Not persisted — no DB write; if the user refreshes, they re-generate
- Not replacing the email seeds — email and social are two different things; both live in the Lab

---

## Live Verify Criteria (closes `social_calendar_lab_live_verify`)

1. "Generate Week" button appears in EmailLabShell when scope is set
2. Clicking it produces 5 draft tiles (Mon–Fri) in under 30 seconds
3. Every caption contains at least one real cited SWFL figure (not a placeholder)
4. "Copy Caption" copies caption + hashtags in paste-ready format
5. "Load Card" replaces the canvas with the social card doc and is undoable
6. The card renders in the existing preview frame without errors
7. No email-specific blocks (header / footer) appear in a social card
