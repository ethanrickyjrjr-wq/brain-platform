# Brand tokens, one root — fonts + surfaces across email/PDF/social

**Date:** 2026-07-02 · **Slug:** `brand-tokens-one-root` · **Check:** `brand_tokens_one_root_live_verify`
**Wave:** 2 of the deliverable-factory waves (`docs/superpowers/plans/2026-07-02-deliverable-factory-waves.md`).
Handoff evidence: readiness doc §social item 5 — "the single highest-leverage item for visual quality."

## Problem

A user's brand record (`projects.branding` / `user_brand_profiles`) carries colors, logo, and
identity — but **no fonts and no surface colors**. Consequences today:

1. **Email and social diverge.** `brandingToTokens` (`lib/email/brand/branding-to-tokens.ts`)
   emits no font/surface tokens; `tokensFromBranding` (`lib/social/design/templates.ts`) reads
   only PRIMARY/ACCENT/TEXT/LOGO_URL and hardcodes `const FONT = "Arial"`. A Playfair-branded
   email ships next to an Arial social card — provably not the same brand.
2. **Font resolution is scattered across four roots:** `FONT_STACKS` + `WEB_FONT_URLS`
   (`lib/email/blocks/styles.ts`), `pdfFont()` (`lib/pdf/email-doc-pdf.tsx`), and the canvas
   `FONT` const. Nothing forces them to agree.
3. **The two email render paths disagree.** The flow renderer (`EmailDocRenderer.tsx`) injects
   the Google-Fonts `<link>` in `<Head>`; `compileGrid` emits an EMPTY `<Head>` — the same doc
   keeps or loses its webfont depending on whether any block has a grid `layout`. (The fork now
   lives in ONE seam — `renderEmailDocHtml`, `lib/email/render-email-doc.ts`, landed `44e36fc7`
   on 07/02 — so the fix has a single home.)
4. **Live bug:** `render-social-image.ts:363` rasterizes with
   `{ loadSystemFonts: true, defaultFontFamily: "Arial" }` — the exact pattern
   `lib/charts/chart-fonts.ts` documents as silently rendering blank text on Vercel (no Arial on
   the Linux runtime). The engine-side social PNG path is font-broken in prod.

## Research evidence (crawl4ai, fetched 07/02/2026 — RULE 0.4)

- **caniemail `css-at-font-face`:** estimated support **~24.4%**. Gmail: unsupported (note 6).
  Outlook Windows (notes 4–5): declaration parsed but distant fonts ignored, and elements using
  an @font-face font **ignore the fallback stack and land on Times New Roman** unless
  `mso-generic-font-family` / `mso-font-alt` (or an `[if mso]` override) forces the safe stack.
- **react-pdf.org/fonts (v4):** built-ins are only Courier/Helvetica/Times variants;
  `Font.register` accepts TTF/WOFF only; variable fonts unsupported (PDF 2.0 spec).
- **resvg serverless pattern** (proven in-repo by `lib/charts/chart-fonts.test.ts`, which runs
  real resvg): `fontFiles` + `loadSystemFonts: false` + `defaultFontFamily` = deterministic
  text rendering local === Vercel.

Best practice confirmed: **progressive enhancement** — safe stack always present; webfont as an
optional garnish for the ~24% of clients that honor it; Outlook explicitly pinned to the stack.

## Operator decisions (07/02, in-session)

1. **Full font freedom on image surfaces.** Social cards, photo-text overlays, chart PNGs are
   rasterized server-side — the font is baked into pixels, every viewer sees the same thing.
   Fancy fonts are unconditionally safe there.
2. **Email is auto-safe, always, silently.** "Put what works where it works best, inform as to
   why if asked." No toggle, no opt-in state, no send-time warning. The brand font expresses
   itself in email as webfont-where-supported over a hand-matched safe stack, with Outlook
   forced onto the stack. Applies identically to scheduled sends. The font picker carries one
   info line: "email apps vary; we always pair your font with a matching backup."
3. **Display/body split ships** — different heading vs body fonts are plain CSS supported by
   every client including Outlook (the risk was only ever *downloaded* fonts).
4. **Sand defaults reuse the existing palette:** SURFACE `#f0ede6` (the warm sand-white already
   shipped as `TEXT_PRIMARY` on dark templates), SURFACE_DARK `#0f1d24` (existing deep-navy
   primary). Brand-set values override.

## Design

### 1. One font registry — `lib/brand/fonts.ts` (NEW, the one root)

One record per `FontFamily` (type stays in `lib/email/doc/types.ts`; it imports from no one).
`Record<FontFamily, BrandFont>` so adding a family forces a complete entry, exactly like
`FONT_ROUTING`:

```ts
interface BrandFont {
  label: string;            // picker label
  stack: string;            // email-safe fallback stack — ALWAYS present in output
  webfontUrl?: string;      // Google Fonts CSS2 <link>; omitted = pure system family
  pdf: "Helvetica" | "Times-Roman"; // react-pdf built-in (v1: no Font.register — YAGNI;
                            // upgrade path = add a `pdfRegister` field later, TTF/WOFF only)
  canvasSvg: string;        // family name in server SVG text (covered by bundled TTFs)
  canvasFiles: string[];    // TTF paths under assets/fonts/ resvg loads (regular + bold)
  previewStack: string;     // browser stack for the Konva client canvas preview
}
```

- `lib/email/blocks/styles.ts` `FONT_STACKS`/`WEB_FONT_URLS` become re-exports/reads of the
  registry (existing imports keep working). `pdfFont()` reads `registry[f].pdf`. The canvas
  `FONT` const dies.
- Serif coverage: vendor **Liberation Serif** Regular+Bold (SIL OFL, metric-compatible with
  Times New Roman) alongside the existing Liberation Sans in `assets/fonts/`, licensed the same
  way. Serif families (`BOOK_SERIF`, `PLAYFAIR_SERIF`) map `canvasSvg: "Liberation Serif"`;
  sans families map `"Liberation Sans"`. `next.config.ts outputFileTracingIncludes` extended to
  every route that rasterizes.
- Tier dial untouched: brand font pickers list `fontsFor(tier)` (`lib/email/lab/capabilities.ts`)
  — registry + routing are both keyed `Record<FontFamily, …>`, so a new font can't skip either.

### 2. Brand record grows four fields (the same one root both surfaces read)

`projects.branding` / `user_brand_profiles` blob gains:

- `font_display` — `FontFamily` key (headings, card headlines, photo overlays)
- `font_body` — `FontFamily` key (body text)
- `surface_color` — hex, light card/stat surface (default sand `#f0ede6` when absent)
- `surface_dark_color` — hex, dark surface (default `#0f1d24` when absent)

`brandingToTokens` emits `FONT_DISPLAY`, `FONT_BODY` (validated: unknown key → token skipped,
never a free-text stack — no user CSS reaches email HTML), `SURFACE`, `SURFACE_DARK`.
The BrandingBlock form gains two font dropdowns (from `fontsFor(tier)`) + two color fields,
with the one-line "matching backup" info note.

### 3. Email side

- `EmailGlobalStyle` gains **optional** `displayFontFamily?: FontFamily`, `surfaceColor?: string`,
  `surfaceDarkColor?: string`. Strip-mode zod landmine honored: same-commit additions to
  `lib/email/doc/schema.ts` + round-trip case in `schema.test.ts` (a doc carrying all three
  survives save/load/AI-fill).
- `applyBrand` (`components/email-lab/EmailLabShell.tsx`) maps FONT_BODY → `fontFamily`,
  FONT_DISPLAY → `displayFontFamily`, SURFACE → `surfaceColor`, SURFACE_DARK →
  `surfaceDarkColor` (token absent → field untouched, today's behavior).
- Heading-bearing renders (header company name, hero headline/value, section titles) resolve
  `displayFontFamily ?? fontFamily`; body text resolves `fontFamily`. Card-painting blocks
  (stat rows, callouts) read `surfaceColor ?? CARD_BG`.
- **Both** email paths emit the same `<Head>`: the registry `webfontUrl` `<link>`s for families
  the doc actually uses, plus an `[if mso]` style override pinning `font-family` to the safe
  stack (kills the Times New Roman fallback bug). This fixes `compileGrid`'s empty-Head
  divergence (`createElement(Head, null)` → a shared head-builder both renderers call);
  `renderEmailDocHtml` (`lib/email/render-email-doc.ts`) is the one seam both paths already
  flow through, so the parity test drives that function directly.
- Webfonts in email are progressive enhancement only — the stack is always the inline
  `font-family` value; the `<link>` is additive. No stored opt-in, no warnings.

### 4. Social/canvas side

- `TemplateTokens` grows 4 → 8 slots: `fontDisplay`, `fontBody`, `surface`, `surfaceDark`
  (defaults: registry MODERN_SANS resolution, sand `#f0ede6`, `#0f1d24`).
  `tokensFromBranding` reads the new UPPER tokens. Templates set element `fontFamily` from
  `tokens.fontDisplay/fontBody` (registry `canvasSvg` name server-side, `previewStack` in the
  Konva client stage) and card backgrounds from `surface`/`surfaceDark`.
- **Bug fix:** `render-social-image.ts` switches to the proven pattern —
  `font: { fontFiles: [...registry files], loadSystemFonts: false, defaultFontFamily: "Liberation Sans" }`.
  SVG `font-family="Arial"` literals in that file migrate to the registry name.
- Deterministic-ids invariant untouched: tokens change styling inputs only, never element ids.

### 5. Parity test (the wave's acceptance gate)

`lib/email/__tests__/font-parity.test.ts` + a social sibling, asserting from the ONE registry:

1. Flow HTML and grid HTML for the same doc contain the **identical** resolved stack for body
   and display text, the identical `<link>` set, and the `[if mso]` pin (three-engines memory:
   this is the divergence killer).
2. PDF render of the same doc resolves each family to its registry `pdf` value (Times-Roman for
   serifs, Helvetica for sans) — asserted via the mapping, no PDF binary diffing.
3. Canvas: server SVG text uses registry `canvasSvg` names only (no `Arial` literal left in
   `lib/social/design/` or `render-social-image.ts`), and a real resvg smoke render with
   `loadSystemFonts: false` produces non-blank text (mirror of `chart-fonts.test.ts`).
4. Registry completeness: every `FontFamily` has a registry entry, a `FONT_ROUTING` entry, and
   its `canvasFiles` exist on disk.

## Out of scope

- The 8 premium fonts ("14-font work") — registry + routing make them a data add later.
- `Font.register` real-font PDFs — upgrade path noted in the registry shape, not built.
- Platform template defaults: `SWFL_TOKEN_DEFAULTS.SURFACE` stays `#ffffff` (back-compat token;
  sand applies at the *brand* layer, not a repaint of existing platform templates).
- Funnel/system emails — platform-branded, live-send deferred; they inherit shared-plumbing
  fixes (grid Head, resvg fonts) incidentally, nothing brand-record-driven.
- Email block vocabulary, chart-PNG wiring (wave 3); photo templates (wave 4).

## Verification

`bunx next build` (never bare tsc) · schema round-trip + parity tests via `bun:test` ·
live-verify `brand_tokens_one_root_live_verify` is operator-run (no paid API calls needed —
render routes only).
