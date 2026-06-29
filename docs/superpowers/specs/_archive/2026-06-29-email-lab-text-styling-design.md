# Email Lab: 14 fonts, block text formatting, image overlay opacity

**Date:** 2026-06-29
**Check:** `email_lab_text_styling_live_verify` (open)
**Status:** SPEC — not yet built. Plan: `docs/superpowers/plans/2026-06-29-email-lab-text-styling.md`

---

## Problem

The Email Lab gives users blocks and a brand palette but almost no *typographic* control:

- **Fonts:** 6 families, only 3 of which are web fonts — and those 3 don't actually
  render on the primary surface (see "Render-engine reality" below).
- **Text styling:** no way to bold / italic / underline / recolor an individual block.
  The only color control is the global `textColor` + brand palette.
- **Image overlay:** `ImageProps` already carries `overlayTitle/overlayBody/overlayTextColor/
  overlayBg/overlayAlign`, but the inspector exposes `overlayBg` as a **raw CSS text field** —
  the user must hand-type `rgba(0,0,0,0.45)`. Unusable as a design control.

## Goal

Three "design-tool" capabilities, each correct across **all three render engines** (live
canvas preview, sent email, PDF):

1. **14 fonts** (6 → 14), grouped in the picker, web fonts that actually render everywhere.
2. **Block-level text formatting** — bold / italic / underline / color, user-owned.
3. **Image overlay opacity** — a hex color picker + a 0–100 opacity slider, replacing the raw
   `rgba()` text field.

## Decisions (operator, 2026-06-29)

- **Full PDF parity, including real fonts.** PDFs render true Playfair/Oswald/etc. via
  `Font.register`, and honor block formatting — not just email + preview. (Goal is "incredible
  self-updating emails *and PDFs*.")
- **Fold in the `compileGrid` empty-`<Head>` fix.** The grid-tier email path ships no web-font
  `<link>` today, so even the 3 fonts shipped 2026-06-29 are silently broken in grid emails.
  Fix it here.

---

## Vendor evidence (crawl4ai, 06/29/2026 — RULE 0.4)

**Google Fonts CSS2 — all 11 families resolve (HTTP 200, exact tokens):**
`Playfair+Display`, `Lato`, `Montserrat` (shipped) + the 8 new:
`Cormorant+Garamond`, `Merriweather`, `EB+Garamond`, `Raleway`, `DM+Sans`, `Nunito`,
`Oswald`, `Josefin+Sans`. URL pattern verified:
`https://fonts.googleapis.com/css2?family=<Token>:wght@400;700&display=swap`.

**caniemail — inline text CSS is email-safe, including Outlook:**
- `font-weight: bold` — supported everywhere (Outlook only fails granular numeric `<600`, not the keyword).
- `font-style: italic` and `color:` — so universal caniemail doesn't track them.
- `text-decoration: underline` — supported in Apple Mail / Gmail / Yahoo / Outlook.
- **`rgba()` — NOT supported in Outlook (`outlook: 'n'`).** `background-image` — also `'n'` in Outlook.

**@react-pdf/renderer 4.5.1 (installed) — Font module (react-pdf.org/fonts):**
- **Only TTF and WOFF** font files supported — **NOT woff2.** So `WEB_FONT_URLS` (woff2) is unusable for PDF; need TTF sources.
- `Font.register({ family, src })`; multiple weights/styles via `fonts: [{ src, fontWeight, fontStyle }]`.
- **Variable fonts don't work** — register separate *static* weight files.
- Built-ins (no registration): `Helvetica*`, `Times-*`, `Courier*`.
- `src` accepts URL or local path; existing `lib/pdf` deliberately chose **no network font fetch**.

---

## Render-engine reality (the part the design must respect)

An `EmailDoc` is rendered by **three independent engines**, each with its own font + style story:

| Surface | Engine | File | Web fonts today | Uses block renderers? |
|---|---|---|---|---|
| Live canvas preview | React DOM (block components) | `EmailLabGridShell` / `GridCanvas` | ❌ page `<head>` loads only Geist | ✅ |
| Email — free tier (no `layout`) | `@react-email` | `EmailDocRenderer.tsx` (`EmailDocEmail`) | ✅ `<link>` in `<Head>` | ✅ |
| Email — grid tier (any `layout`) | `@react-email` string compiler | `compile-grid.ts` (`compileGrid`) | ❌ `createElement(Head, null)` — empty | ✅ (reuses `BlockRenderer`) |
| PDF | `@react-pdf/renderer` | `lib/pdf/email-doc-pdf.tsx` (`EmailDocPdf`) | ❌ built-ins only (`pdfFont()`) | ❌ separate `PdfBlock` switch |

Consequences that drive the plan:

- **Pillar 2 (formatting)** applied as inline CSS in the 4 email block renderers is **automatic**
  for live preview + both email paths (they all share `BlockRenderer`). PDF needs the props added
  to `PdfBlock` separately.
- **Pillar 1 (fonts)** needs the web-font `<link>` in **3 places**: `EmailDocEmail` (done),
  `compileGrid` (empty today — fix), and the live preview page `<head>` (missing). PDF needs
  `Font.register` (separate mechanism, TTF files).

---

## The cross-cutting landmine: `schema.ts` strip mode

`lib/email/doc/schema.ts` validates **the whole doc** on every save, every load, and after every
AI block-fill (the AI route re-parses with `EmailDocSchema` post-patch). The per-block schemas are
`z.object` = **strip mode**: any key not declared is silently dropped.

Therefore **every new prop must be added to its zod schema** or it vanishes — and not just on
save: one AI block-fill would strip `bold/italic/color` off **every block in the doc**. The
`satisfies z.ZodType<Props>` guard does **NOT** catch a missing *optional* field (the output type
stays assignable). The real guard is the `schema.test.ts` round-trip — extend it for each new field.

New props are **USER-OWNED**: they must NOT be added to `BlockContentPatchSchema` **or**
`AuthoredBlockSchema` (the strip lists already drop them — keep it that way).

---

## Pillar 1 — Font expansion (6 → 14)

**New families** (all verified):

| `FontFamily` value | Picker group | Picker label | CSS2 token | Web font? |
|---|---|---|---|---|
| `MODERN_SANS` (Inter) | System | Modern Sans | — | system |
| `BOOK_SERIF` (Georgia) | System | Book Serif | — | system |
| `GEOMETRIC_SANS` (Century Gothic) | System | Geometric Sans | — | system |
| `PLAYFAIR_SERIF` | Serif | Playfair Display | `Playfair+Display` | ✅ |
| `CORMORANT_SERIF` | Serif | Cormorant Garamond | `Cormorant+Garamond` | ✅ |
| `MERRIWEATHER_SERIF` | Serif | Merriweather | `Merriweather` | ✅ |
| `EB_GARAMOND_SERIF` | Serif | EB Garamond | `EB+Garamond` | ✅ |
| `LATO_SANS` | Sans | Lato | `Lato` | ✅ |
| `MONTSERRAT_SANS` | Sans | Montserrat | `Montserrat` | ✅ |
| `RALEWAY_SANS` | Sans | Raleway | `Raleway` | ✅ |
| `DM_SANS` | Sans | DM Sans | `DM+Sans` | ✅ |
| `NUNITO_SANS` | Sans | Nunito | `Nunito` | ✅ |
| `OSWALD_SANS` | Display | Oswald | `Oswald` | ✅ (no italic variant) |
| `JOSEFIN_SANS` | Display | Josefin Sans | `Josefin+Sans` | ✅ |

**Touch points (all required):**

1. `lib/email/doc/types.ts` — extend the `FontFamily` union (+8).
2. `lib/email/doc/schema.ts` — extend the `GlobalStyleSchema.fontFamily` `z.enum([...])` (the
   one the design forgot). Keep it in lockstep with the union.
3. `lib/email/blocks/styles.ts` — `FONT_STACKS` (`Record<FontFamily,…>` — compiler forces all 14)
   + `WEB_FONT_URLS` (`Partial` — **add a test that every web-font family has an entry**, since
   `Partial` won't compile-enforce it).
4. **Both** pickers: `components/email-lab/EmailLabGridShell.tsx` (line ~61) **and**
   `components/email-lab/EmailLabShell.tsx` (line ~81) — grouped `<optgroup>` by System / Serif /
   Sans / Display.
5. `lib/email/blocks/compile-grid.ts` — replace `createElement(Head, null)` with a `<Head>` that
   injects `WEB_FONT_URLS[doc.globalStyle.fontFamily]` as a `<link>` (mirror `EmailDocEmail`).
6. **Live preview font loading** — inject the selected family's `WEB_FONT_URLS` `<link>` into the
   page `<head>` (e.g. a small effect in the shell, or render all web-font `<link>`s in the
   `/email-lab` layout). Confirm `app/layout.tsx` (Geist-only) isn't already covering it — it isn't.
7. **PDF fonts** — `lib/pdf/` font registry (new `lib/pdf/fonts.ts`): `registerPdfFont(family)`
   lazily `Font.register`s the **selected** family's static weights on first render (bounded — one
   family/doc), returns the family name; `pdfFont()` delegates to it (built-in fallback for the 3
   system fonts: serif→`Times-Roman`, sans→`Helvetica`). Two **prod realities** (advisor, 06/29 —
   invisible to local tests):
   - **`public/` is NOT in the Vercel lambda fs.** Don't read TTFs via `process.cwd()/public/…` — it
     passes `bun test` but the serverless PDF route can't see `public/`. **Register from a pinned
     Fontsource CDN URL** (static woff/ttf, one fetch/cold-start) — simpler and less fragile than
     `outputFileTracingIncludes`. The old `lib/pdf` "no network fetch" note predates needing real fonts.
   - **react-pdf THROWS on an unresolved variant** (not graceful fallback). Oswald has no italic →
     an italicized block on Oswald would crash PDF gen. The registry lists only variants that exist;
     a `pdfFontHasItalic(family)` guard stops the renderer emitting `fontStyle:"italic"` for a family
     that lacks it.
   - **Long pole:** PDF-real-fonts is materially heavier than the other surfaces — Pillars 1–3 on
     email + live preview can ship first; PDF parity is a clean fast-follow. Sequence PDF tasks last.

## Pillar 2 — Block-level text formatting

**Props** (USER-OWNED; optional):
- `TextProps` + `MultiColumnColumn`: `textColor?`, `bold?`, `italic?`, `underline?`
- `HeroProps` + `SignalProps`: `textColor?`, `bold?` **only** (italic/underline don't belong on
  display-size kicker/value — preserve semantic hierarchy, per the design).

**Touch points:**
1. `types.ts` — add the fields to the 4 interfaces.
2. `schema.ts` — add the SAME fields to `TextPropsSchema`, `MultiColumnColumnSchema`,
   `HeroPropsSchema`, `SignalPropsSchema` (or they get stripped — see landmine). Booleans:
   `z.boolean().optional()`; color: `z.string().optional()`. **Do NOT** add to
   `BlockContentPatchSchema`/`AuthoredBlockSchema`.
3. Email renderers — apply as inline CSS in `TextBlock.tsx`, `HeroBlock.tsx`, `SignalBlock.tsx`,
   `MultiColumnBlock.tsx`: `fontWeight: bold ? 700 : <existing>`, `fontStyle: italic ? "italic" : undefined`,
   `textDecoration: underline ? "underline" : undefined`, `color: textColor ?? <existing>`. (These
   four cover live preview + free + grid email automatically.)
4. PDF — same props applied in the matching `PdfBlock` branches (`@react-pdf` supports `fontWeight`,
   `fontStyle`, `textDecoration: "underline"`, `color`).
5. Inspector (`BlockInspector.tsx`) — for `text`/`multi-column`: a **B / I / U** toggle row + a color
   swatch; for `hero`/`signal`: a **Bold** toggle + color swatch only.
6. `schema.test.ts` — extend the round-trip to assert each new field survives parse.

## Pillar 3 — Image overlay opacity

**Prop:** add `overlayBgOpacity?: number` (0–100) to `ImageProps` + `ImagePropsSchema`
(`z.number().min(0).max(100).optional()`). USER-OWNED (not in patch/author schemas).

**Renderer (`ImageBlock.tsx`) — the Outlook-safe structure (advisor):**
- Resolve `base` = `overlayBg` if it's a hex (`#rrggbb`); legacy `rgba()/CSS string` → pass through.
- **Outer Section:** opaque solid `backgroundColor: baseHex` **always** (was: only when no `url`),
  plus the `background-image` photo. Outlook ignores the bg-image + rgba → shows the solid panel →
  white text stays readable (honors the existing "Outlook falls back to a colored panel" promise).
- **Inner scrim Section:** `backgroundColor: rgba(base, overlayBgOpacity/100)`. Modern clients: photo
  shows through, scrim dims it. No duplicate-key CSS cascade (react-email style objects can't hold one).
- **Back-compat:** a saved doc with `overlayBg: "rgba(0,0,0,0.45)"` and **no** `overlayBgOpacity` →
  inner uses that string verbatim; outer uses an opaque approximation (e.g. the rgb without alpha, or `#111827`).
- Default when nothing set: `base = #000000`, opacity `45`.

**PDF (`PdfBlock` image branch):** apply the same resolved overlay (solid panel + text) — react-pdf
has no bg-image, so it already renders a solid colored panel; wire `base`/opacity into its color.

**Inspector (`BlockInspector.tsx`, image → Text Overlay section):** replace the raw "Scrim
(background)" `TextField` with a **`ColorField`** (hex picker) for `overlayBg` + a **0–100 range
slider** for `overlayBgOpacity` (show the live % and the resolved rgba preview).

---

## Constraints / gotchas

- Keep `FontFamily` union ⇄ `GlobalStyleSchema` enum ⇄ both pickers ⇄ `FONT_STACKS` in lockstep; a
  drift between union and enum is a runtime reject, not a compile error.
- `WEB_FONT_URLS` is `Partial` — add the explicit "every web-font family has a URL" test.
- PDF TTFs are committed assets (NOT crawl4ai files) — fine for git. Lazy-register only the selected
  family to bound memory; never network-fetch at render.
- All new props are USER-OWNED — verify in `schema.test.ts` that an AI patch carrying them is stripped.
- Pillar 2 + Pillar 3 props must round-trip through the file-persistence load path too (same strip).

## Out of scope

- Inline rich text (formatting *spans within* a paragraph) — needs contentEditable; separate scope
  (already deferred in `2026-06-28-email-lab-ux-enhancements.md`). Pillar 2 is **whole-block** only.
- Per-character / per-word color.
- New social platforms, new block types.

## Verification (closes `email_lab_text_styling_live_verify`)

Live at `/email-lab/grid`: pick each new font (preview shows the real face, not a fallback) →
export email + PDF and confirm the face renders in both → bold/italic/underline/color a text block,
confirm in preview + email + PDF → set overlay hex + opacity, confirm rgba scrim in a modern client
and a readable solid panel in Outlook. `bun test lib/email/doc/schema.test.ts` + the PDF test green.
