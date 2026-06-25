# Email Socials & Branding — Design Spec
**Date:** 2026-06-25  
**Status:** Approved — Opus handoff  
**Next step:** writing-plans → implementation

---

## Why Socials Weren't Working in the Current Footer

The break was NOT in the rendering layer — FooterBlock, `applyBrand`, and the email-lab token bridge were fully wired and ready. The data never reached them because of three upstream gaps:

1. **No DB columns** — `user_brand_profiles` had no `instagram_url`, `facebook_url`, `linkedin_url`, `unsubscribe_url` columns. Nothing was ever persisted.
2. **No form inputs** — `BrandingBlock.tsx` had no social URL fields. Users had no way to enter them.
3. **API route excluded them** — `/api/user/brand` GET/PATCH only selected `AGENT_FIELDS` + `COLOR_FIELDS`. Even if a value somehow existed in the DB, it was never returned or saved.

Fix those three gaps and the footer starts rendering socials immediately with zero changes to the rendering engine.

---

## Scope

This spec covers:
1. DB migration — add social + unsubscribe columns to `user_brand_profiles`
2. API extension — wire new columns into `/api/user/brand`
3. BrandingBlock form — "Connect Socials" section
4. New `social-icons` standalone block type (full email canvas block)
5. FooterBlock enhancement — reorderable social icons within the footer
6. Pre-baked SVG icon set + "add your own" with Logo.dev fallback + domain logging

**Out of scope (future v2):** Block snap-to-footer — a UX feature where a standalone `social-icons` block can snap/dock to the footer block. Requires drag-and-drop block grouping logic not yet built. Park for after the social-icons block ships and usage patterns are observed.

---

## 1. Data Layer

### DB Migration
**File:** `docs/sql/20260625_user_brand_socials.sql`

Add to `user_brand_profiles`:
```sql
ALTER TABLE user_brand_profiles
  ADD COLUMN IF NOT EXISTS instagram_url  text,
  ADD COLUMN IF NOT EXISTS facebook_url   text,
  ADD COLUMN IF NOT EXISTS linkedin_url   text,
  ADD COLUMN IF NOT EXISTS x_url          text,
  ADD COLUMN IF NOT EXISTS tiktok_url     text,
  ADD COLUMN IF NOT EXISTS youtube_url    text,
  ADD COLUMN IF NOT EXISTS pinterest_url  text,
  ADD COLUMN IF NOT EXISTS threads_url    text,
  ADD COLUMN IF NOT EXISTS unsubscribe_url text;
```

Also create a logging table for custom platform discovery:
```sql
CREATE TABLE IF NOT EXISTS brand_custom_socials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      text NOT NULL,
  url         text NOT NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  logo_url    text,              -- Logo.dev resolved URL, nullable
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brand_custom_socials_domain ON brand_custom_socials(domain);
```

No migration needed on `projects.branding` — it's JSONB and already accepts arbitrary keys. New fields ride along automatically once the API emits them.

### API Route `/api/user/brand`
Add a `SOCIAL_FIELDS` constant:
```ts
const SOCIAL_FIELDS = [
  'instagram_url', 'facebook_url', 'linkedin_url', 'x_url',
  'tiktok_url', 'youtube_url', 'pinterest_url', 'threads_url',
  'unsubscribe_url'
] as const;
```

Extend both GET (SELECT) and PATCH (upsert) to include `SOCIAL_FIELDS` alongside existing `AGENT_FIELDS` / `COLOR_FIELDS`. Same pattern, no new logic.

---

## 2. BrandingBlock Form — "Connect Socials" Section

**File:** `app/project/[id]/workspace/BrandingBlock.tsx`

Add a **Social Links** section below the Contact section. Layout: 2-column grid matching the existing contact fields grid.

```
Instagram URL      Facebook URL
LinkedIn URL       X (Twitter) URL
TikTok URL         YouTube URL
Pinterest URL      Threads URL
────────────────────────────────
Unsubscribe URL    [half-width, full row]
```

Each input:
- URL text input, placeholder shows format: `https://instagram.com/yourhandle`
- No inline validation — save as entered (same pattern as phone/email today)
- Label = platform name ("Instagram", "X (Twitter)", etc.)
- **Clear (×) button** inline on the right when the field has a value — clears the field; on save writes null to DB

Save path: both `saveBrandGlobal()` and `saveBrandProjectOnly()` already pass the full branding object through, so the new fields ride along with no new save logic.

`Branding` interface in `email-lab/page.tsx`: the `instagram_url`, `facebook_url`, `linkedin_url`, `unsubscribe_url` fields already exist (dormant). Add `x_url`, `tiktok_url`, `youtube_url`, `pinterest_url`, `threads_url`.

---

## 3. Pre-Baked SVG Icon Set

**Location:** `components/email-lab/social-icons/` — one `.tsx` file per platform.

**8 pre-baked platforms:**
| Platform | File | Notes |
|---|---|---|
| Instagram | `InstagramIcon.tsx` | gradient fill |
| Facebook | `FacebookIcon.tsx` | #1877F2 |
| LinkedIn | `LinkedInIcon.tsx` | #0A66C2 |
| X (Twitter) | `XIcon.tsx` | black/white |
| TikTok | `TikTokIcon.tsx` | black or duotone |
| YouTube | `YouTubeIcon.tsx` | #FF0000 |
| Pinterest | `PinterestIcon.tsx` | #E60023 |
| Threads | `ThreadsIcon.tsx` | black |

Each icon component: accepts `size: number`, `color: "original" | "brand" | string`. "original" = platform brand color; "brand" = CSS var for accent color; string = hex override.

**"Add your own" flow:**
1. User pastes any URL
2. Extract domain from URL
3. Fetch `https://img.logo.dev/{domain}?token={LOGODEV_API_KEY}&size=64` (Logo.dev)
4. Fallback: `https://www.google.com/s2/favicons?domain={domain}&sz=64`
5. Last resort: generic globe SVG icon
6. Log to `brand_custom_socials` (domain + url + user_id + resolved logo_url)
7. Store `logoUrl` in the platform entry in branding/block props

`LOGODEV_API_KEY` → add to Vercel env vars + `.env.local`.

---

## 4. New `social-icons` Block Type

### Block Props Type
```ts
export interface SocialIconsBlockProps {
  platforms: Array<{
    type: KnownPlatform | "custom",
    url: string,
    label?: string,        // display name (custom platforms; known platforms auto-label)
    logoUrl?: string,      // custom only — Logo.dev resolved URL
    order: number,
  }>,
  displayMode: "icon" | "text" | "icon+text",
  layout: "row" | "column",
  iconSize: "sm" | "md" | "lg",   // 20px / 28px / 36px
  iconColor: "original" | "brand" | "custom",
  customIconColor?: string,        // hex, only when iconColor === "custom"
}

type KnownPlatform = "instagram" | "facebook" | "linkedin" | "x" | "tiktok" | "youtube" | "pinterest" | "threads";
```

### Block Registration (follow existing patterns exactly)
Wire into:
- `lib/email/blocks/types.ts` — add `"social-icons"` to block union
- `lib/email/blocks/schema.ts` — Zod schema for `SocialIconsBlockProps`
- `components/email-lab/BlockRenderer.tsx` — render case
- `components/email-lab/BlockInspector.tsx` — inspector panel case
- `components/email-lab/AddBlockPanel.tsx` — "Social Icons" entry
- `lib/email/blocks/SocialIconsBlock.tsx` — the React-Email-compatible render component
- `lib/email/pdf/PdfBlockRenderer.tsx` — PDF render case (icon + url text as fallback)

### Inspector Panel Layout
Four sections:
1. **Platforms** — list of active platforms with drag handles to reorder, toggle on/off, + "Add platform" button (shows platform picker for pre-baked + URL input for custom)
2. **Display mode** — segmented toggle: Icon / Text / Icon + Text
3. **Layout** — segmented toggle: Row / Column
4. **Style** — icon size (S/M/L), icon color (Original / Brand / Custom hex)

### `applyBrand` Integration (`EmailLabShell.tsx`)
When processing a `social-icons` block, populate `platforms` from branding tokens the same way footer does — but only for platforms that have a URL set in branding. Preserve any manually-set order.

---

## 5. FooterBlock — Reorderable Social Icons

**File:** `lib/email/blocks/FooterBlock.tsx`

Add `socialOrder: KnownPlatform[]` to `FooterBlockProps` — defaults to `["instagram", "facebook", "linkedin", "x"]`. Render social row using `socialOrder` to sequence the icons.

In the FooterBlock inspector, the social row becomes a mini drag list — users drag platform chips to reorder. Platforms with no URL set are greyed out (not clickable but visible as "not connected").

Footer social icons always render in **icon + text** mode (not configurable in footer; standalone block handles the flexible modes).

---

## 6. `applyBrand` Token Mapping (Email Lab)

**File:** `app/project/[id]/email-lab/page.tsx` — Branding interface  
**File:** `components/email-lab/EmailLabShell.tsx` — `applyBrand` function

Token keys to add:
```
INSTAGRAM_URL, FACEBOOK_URL, LINKEDIN_URL, X_URL,
TIKTOK_URL, YOUTUBE_URL, PINTEREST_URL, THREADS_URL,
UNSUBSCRIBE_URL
```

`applyBrand` already has the pattern for footer socials. Extend it to also populate `social-icons` blocks by platform URL.

---

## Future: Block Snap-to-Footer (v2)

When a `social-icons` block is dragged near the bottom of a `footer` block, offer a "snap" affordance that docks them — the footer absorbs the social strip and removes the standalone block. Requires:
- Proximity detection during drag (canvas coordinate math)
- Merge logic: take `platforms` from the standalone block and write into `footer.socialOrder`
- Undo support

Park this until the standalone block ships and we observe how users actually place them.

---

## Implementation Order

1. DB migration (`docs/sql/20260625_user_brand_socials.sql`) + run it
2. API route `/api/user/brand` — extend fields
3. `Branding` interface — add missing URL fields
4. BrandingBlock form — "Connect Socials" section
5. SVG icon components (`components/email-lab/social-icons/`)
6. `SocialIconsBlock` types + schema + render component + PDF renderer
7. Block registry wiring (BlockRenderer / BlockInspector / AddBlockPanel)
8. `applyBrand` extension for `social-icons` block
9. FooterBlock `socialOrder` + reorderable inspector
10. Logo.dev "add your own" flow + `brand_custom_socials` logging
11. Add `LOGODEV_API_KEY` to Vercel env
