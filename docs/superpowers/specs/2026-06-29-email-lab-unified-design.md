# Email Lab — Unified Design Spec (panel + persistence + canvas + typography + AI sections)

**Date:** 2026-06-29
**Status:** SPEC — unified, review-corrected, awaiting `writing-plans`
**Supersedes (designs):** `2026-06-29-email-lab-shared-panel-design.md`, `2026-06-29-grid-email-canvas-v2-design.md`, `2026-06-29-email-lab-text-styling-design.md`
**Supersedes (draft plans):** `plans/2026-06-29-grid-email-file-persistence.md`, `plans/2026-06-29-grid-email-canvas-ux.md`
**Checks (existing — phases map onto them, no new check):** `email_lab_shared_panel_live_verify` · `grid_email_canvas_v2_live_verify` · `email_lab_text_styling_live_verify`

---

## Why this exists

Three separate specs were each improving the **same** paid surface (`/email-lab/grid`, `EmailLabGridShell`) and **colliding on the same shell file**. Worse, one of them cited a capability (`ai: "build+fill"`) that doesn't exist in code — it was a *proposal* from another of the three, mis-quoted as live code. This document merges all three into one ordered build, fixes the three review defects, and pins **one architectural principle** so the AI author engine and the end user never fight each other.

**End goal (the north star this serves):** incredible *self-updating* emails **and PDFs** a real-estate agent builds and schedules in ~5 minutes — fresh four-lane data + AI commentary, never an invented number. Everything below is sequenced to reach that with the least rework and the cleanest surface for the AI to author against.

---

## The one principle — ownership split (best for the AI builder AND the end user)

**The AI author engine owns MESSAGE + STRUCTURE. The human + saved brand own STYLE.**

- AI authors: which blocks, their order, row grouping (`span` / `new_row`), and message content — nothing else. Verified: `author-doc.ts:22` ("the model emits `span` + `new_row`; THIS module derives bounds-correct `{x,y,w,h}`"); the AI-writable field set is message-only (`types.ts:73` — `kicker/value/label/prose/title/body/caption/alt/stats`); the no-invention lints keep every authored number anchored to the data feed (`author-doc.ts:9-17`).
- Human + brand own: fonts, bold/italic/underline/color, image overlay, palette, logos, links, names — all **USER-OWNED**, all stripped from AI patches (`schema.ts` `BlockContentPatchSchema` / `AuthoredBlockSchema`).

**Why this is best for the AI builder:** a small, stable, unambiguous surface (message + structure) is exactly what keeps the no-invention moat *enforceable* and lets the author engine produce good layouts from a richer **section vocabulary** (Phase 5) instead of fighting pixel math or guessing at style. **Why best for the end user:** they get AI-drafted content instantly *and* full click-to-edit design control — and because every new style prop is user-owned and strip-protected, an AI re-fill can never stomp the design they set.

---

## Corrections folded in from review (the three defects)

**Defect 1 — `ai: "build+fill"` was a phantom citation.** It exists in **zero** code files; it lived only in the shared-panel spec as a *proposed* capability and was mis-cited in the canvas-v2 spec as live code at `capabilities.ts:67` (actual line 67 = `socialCalendar: false`; the real paid AI flag today is the boolean `authorEngine`, `capabilities.ts:51/59`). **Resolution:** Phase 1 *builds* the graded capability `ai: "fill" | "build+fill"`. After Phase 1 it is real and later phases gate on `ai === "build+fill"`. Until Phase 1 lands, the paid AI gate is `authorEngine`.

**Defect 2 — design name must NOT overload `deliverables.instruction`.** `instruction` is the stored **re-render prompt**: `emaildoc-occurrence.ts:80` reads it and feeds it to the author engine on every scheduled occurrence (`run-schedules.mts:304,323`; materials route comment, `route.ts:48-51`). Storing a name there means a scheduled design re-authors itself from the string `"Q3 Newsletter"`. **Resolution:** add a dedicated `name` column in the same migration.

**Defect 3 — the migration needs a PostgREST schema-cache reload.** After DDL, PostgREST serves from a cached schema; the new `name` column and the now-nullable `project_id` aren't visible to the REST API until the cache reloads. **Resolution:** the migration is three steps — run the SQL, then `NOTIFY pgrst, 'reload schema';`, then `bun run gen:types`. (crawl4ai 06/29/2026: PostgREST schema-cache docs `docs.postgrest.org`; Supabase API guide `supabase.com/docs`.)

**Tools verdict — ZERO new dependencies required.** Probe of `package.json`: `sonner` (restore toast), `zod` (doc validation), `@supabase/ssr` (designs API), `react-grid-layout` (canvas) are all present; `ResizeObserver` is native and already used in 4 chart components; autosave is a hand-rolled `fetch` + debounce (there is **no** TanStack Query in this repo — match the existing `onSave` pattern). The only optional add is **react-dropzone** for nicer image drag-drop (not required for v1; native HTML5 drop works). Puck / Craft.js / Plate were evaluated and **rejected** for this surface — they render React DOM, not Outlook-safe table HTML; the hard part (table-HTML email compilation) we already own in `compile-grid.ts` / `EmailDocRenderer`.

---

## Render-engine reality (load-bearing — every typography/formatting decision must respect it)

An `EmailDoc` is rendered by **three independent engines**, each with its own font + style story:

| Surface | Engine | File | Web fonts today | Block renderers? |
|---|---|---|---|---|
| Live canvas preview | React DOM (block components) | `EmailLabGridShell` / `GridCanvas` | ❌ page `<head>` loads only Geist | ✅ |
| Email — free tier (no `layout`) | `@react-email` | `EmailDocRenderer.tsx` (`EmailDocEmail`) | ✅ `<link>` in `<Head>` | ✅ |
| Email — grid tier (any `layout`) | `@react-email` string compiler | `compile-grid.ts` (`compileGrid`) | ❌ `createElement(Head, null)` — empty | ✅ (reuses `BlockRenderer`) |
| PDF | `@react-pdf/renderer` | `lib/pdf/email-doc-pdf.tsx` (`EmailDocPdf`) | ❌ built-ins only (`pdfFont()`) | ❌ separate `PdfBlock` switch |

Consequences: block-level formatting applied as inline CSS in the 4 email block renderers is **automatic** for live preview + both email paths (shared `BlockRenderer`); **PDF always needs the same props wired separately** into `PdfBlock`. Web fonts need the `<link>` in **three** web places (`EmailDocEmail` ✅ done, `compileGrid` ❌ empty `<Head>` — fix, live preview `<head>` ❌ missing) **and** `Font.register` for PDF (separate mechanism, TTF/woff files).

---

## The cross-cutting landmine: `schema.ts` strip mode

`lib/email/doc/schema.ts` validates the whole doc on every save, every load, and after every AI block-fill. Per-block schemas are `z.object` = **strip mode**: any undeclared key is silently dropped. So **every new prop must be added to its zod schema** or it vanishes — and one AI block-fill would strip an un-declared `bold/color` off **every block in the doc**. `satisfies z.ZodType<Props>` does NOT catch a missing *optional* field; the real guard is the `schema.test.ts` round-trip — extend it per new field. New style props are **USER-OWNED**: do NOT add them to `BlockContentPatchSchema` or `AuthoredBlockSchema` (the strip lists already drop them — keep it that way).

---

# Build path (phased, ordered) — with the why

**Critical path: Phase 1 → Phase 2.** Phase 1 removes the shell collision and creates the seam everything plugs into (and makes `build+fill` real). Phase 2 is the biggest end-user trust win (never lose work). **Phase 3, Phase 4, and Phase 5/C1 can interleave/parallelize once Phase 1 lands** — they touch different files (canvas, block renderers, templates). PDF-real-fonts (inside Phase 4) is the long pole — sequence it last. C2 (semantic sections) is deferred to its own design pass.

---

## Phase 1 — Foundation: shared panel + graded capabilities  ·  `email_lab_shared_panel_live_verify`

**Why first:** both other tracks edit `EmailLabGridShell` and the right panel/inspector; unifying the panel first means a shared change is made once, not twice, and removes the parallel-session collision entirely. It also builds the real graded capability, killing Defect 1 at the root.

**Current state (verified this session):** `lib/email/lab/capabilities.ts` + `capabilities.test.ts` exist as **booleans** (`authorEngine`, `gridCanvas`, `photoEditor`, `classicTemplates`, `socialCalendar`). **No** `EmailLabPanel` component, **no** `components/email-lab/panel/` yet.

**Work:**
1. **Reshape `capabilities.ts`** to the graded contract:
   - `ai: "fill" | "build+fill"` (free = content-patch only; paid = author engine + fill)
   - `socialCalendar: "basic" | "schedule"` (both tiers; paid adds create-in-canvas + Schedule)
   - `classicTemplates: boolean` (free-only rail)
   - paid-only booleans: `pasteImageUrl`, `photoEditor`, `nowEditingFraming`
   - Keep `Object.freeze`; `PAID_ONLY` lists keys + graded ranks (`build+fill > fill`, `schedule > basic`).
2. **Migrate `capabilities.test.ts`** to the graded invariant: `rank(PAID.ai) >= rank(FREE.ai)`, `rank(PAID.socialCalendar) >= rank(FREE.socialCalendar)`, every paid-only boolean true-in-paid/false-in-free, free values pinned. (This is the CI gate that stops a careless edit leaking paid into free.)
3. **Extract `components/email-lab/EmailLabPanel.tsx`** — stateless; takes doc/handlers/brand + a `capabilities` prop + a `panelHeader` slot; renders all sections (AI, Brand, seeds, blocks, photos, inspector) each gated by `capabilities`. Both shells render it. Canvas + overall layout stay per-tier (free linear `BlockCanvas`, paid 2D `GridCanvas`).
4. Pointer in `lib/email/CLAUDE.md`.

**Verify:** `bunx next build`; `bun test lib/email/lab/capabilities.test.ts`; both `/email-lab` (free) and `/email-lab/grid` (paid) render exactly as before.

---

## Phase 2 — Persistence: never lose work  ·  `grid_email_canvas_v2_live_verify`

**Why second:** losing work on tab close, and being unable to save/reload a named design, is the single biggest trust failure today. Depends only on the DB. **A1 gates A2.**

### A1 — Migration (idempotent; via `Bun.SQL`, `.dlt/secrets.toml` creds, `sslmode=require` — psql not installed)
```sql
ALTER TABLE deliverables ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS name text;   -- Defect 2: name lives here, NOT in instruction
NOTIFY pgrst, 'reload schema';                                 -- Defect 3: make the change visible to the REST API
```
then `bun run gen:types`. Verify `project_id` is nullable and `name` exists afterward.

**Storage model (verified):** a standalone design **is** a `deliverables` row with `project_id IS NULL` + `template = 'block-canvas'`, so it rides the same send/paywall pipeline (send is the paywall). Facts that make this clean:
- **Send works project-lessly.** The send route `app/api/deliverables/[id]/blast/route.ts` selects by id, requires `template ∈ {email, block-canvas}` + `status='ready'`, and the **only** use of `project_id` is `if (sent > 0 && deliverable.project_id)` at `:255` — a guarded activity-log breadcrumb that simply **skips** when null. `ContactPickerModal` (the send UI) needs only `deliverableId` (`EmailLabGridShell.tsx:1097-1102`). So a null-project design can be saved and **sent**.
- **Schedule stays project-gated** (`ScheduleSendModal` requires `projectId`, `EmailLabGridShell.tsx:1105-1112`) — acceptable; scheduling is inherently project-scoped. (A standalone design is not schedulable until it's attached to a project — a fine v1 boundary.)
- **No RLS surgery.** `deliverables` SELECT is `USING(true)` public (`docs/sql/20260613_deliverables.sql:37`). Ownership is enforced in **app code** via `.eq("user_id", user.id)`, never a project-join — so a null-`project_id` row is fully readable by its owner's filtered query. **Note:** the blast route's comment "RLS proves ownership" is inaccurate (select is public) — therefore the designs API **must** enforce `user_id` itself on every read/write; do not lean on RLS.
- **Blast-radius:** grep `deliverable.project_id` derefs before relying on the nullable column — the real audit set is the ~4 deliverables consumers (`blast`, `edit`, `refresh` routes, `app/p/[id]/page.tsx`); the blast route already guards. Confirm none hard-deref `project_id`.

### A2 — Designs API (`runtime = "nodejs"`; mirror the verified insert shape at `app/api/projects/[id]/materials/route.ts:53-64`)
- `GET /api/email-lab/designs` → `{ designs: { id, name, created_at }[] }` — cookie client, `.eq("user_id", user.id).eq("template","block-canvas").is("project_id", null).is("deleted_at", null)`, newest first, limit 50.
- `POST /api/email-lab/designs` `{ doc, name? }` → `{ id }` (201) — `EmailDocSchema.safeParse(doc)` (400 on fail); **service-role** insert (no owner INSERT policy on `deliverables`) with the full NOT-NULL set: `id` (`crypto.randomUUID()` — full entropy; designs are readable by id under the link=capability model), `user_id`, `project_id: null`, `template: "block-canvas"`, `doc`, **`name`** (= trimmed ≤100, default `"Untitled Email"`) ← NOT `instruction`, `data_as_of`, `narrative: { exec_summary:"", sections:[], inference_notes:[] }`, `items_snapshot: []`, `status: "ready"`.
- `GET /api/email-lab/designs/[id]` → `{ id, name, doc, created_at }` — 401/404/403 (ownership by `user_id`).
- `PATCH /api/email-lab/designs/[id]` `{ doc }` → `{ ok:true }` — ownership check, then service-role `update({ doc })`.
- Full `bun:test`: auth, validation, ownership, insert shape.

### A3 — Autosave (two layers)
- **Pre-first-save buffer (localStorage):** behind a new optional `draftKey?: string` prop on `EmailLabGridShell`. 3-second debounced write of `{ doc, savedAt }`; on mount (ref-guarded vs StrictMode), if a draft exists, is <7 days old, and `EmailDocSchema.safeParse`s, restore into history + show a `sonner` toast with a **Discard** action. Skip restore when loading via `?did=`. Clear on explicit save.
- **Post-first-save (server, the robust path):** once a design has an id, debounce a `PATCH /designs/[id]` on doc change (the Figma/Docs pattern; the A2 API already exists, so this is a small delta). localStorage remains the offline/pre-save buffer only. *Why both:* localStorage covers the "never named it yet" gap without littering the DB; server autosave gives cross-device + survives a cache/privacy-mode clear.

### A4 — Left rail: "My Designs"
New collapsible **left** rail (Canva/Figma convention): "New design" + lazy list from `GET /designs`; click a row → `GET /designs/[id]` → `safeParse` → `applyBrand` → `commit()`; `?did=` URL sync. First save opens a `SaveDesignModal` (name) → `POST`; later saves `PATCH`. Rename/delete are fast-follows. The Phase-3 layers list shares this rail. Keep the 3-pane layout usable at the paid target widths (`h-full`/`dvh`, never `h-screen`).

---

## Phase 3 — Canvas friction  ·  `grid_email_canvas_v2_live_verify`

**Why third:** removes day-to-day edit friction once work is safe. All new `GridCanvas` props **optional** (no existing caller breaks).

- **B1 resize-to-fit:** extract the inline per-block JSX into a `GridBlock` component owning a `useLayoutEffect` + `ResizeObserver` (native; already the pattern in 4 chart files). When `scrollHeight > offsetHeight`, show a "↕ Fit" pill → `onFitBlock(id, ceil(scrollHeight / GRID_ROW_HEIGHT) + 1)`; shell commits new `layout.h`. **Pass the real `doc.globalStyle`** to `BlockRenderer` (not `{} as never`).
- **B2 image drag-drop:** native `onDragOver`/`onDragLeave`/`onDrop` on the canvas outer `<div>` (teal drop highlight) → on image drop call `onImageDrop(file)` → existing `uploadNewPhoto(file)`. (react-dropzone optional; not required.)
- **B3 inline double-click edit:** a `position:fixed` `InlineTextEditor` textarea positioned from `getBoundingClientRect()`. **v1 set (only single, unambiguous, AI-writable fields per `types.ts:73`): `text → body` and `signal → title`.** `header`/`hero` stay inspector-only (`companyName` is user-owned `types.ts:71-72`; both are multi-field). *Upgrade path (v1.5):* per-element editing — tag each rendered field so double-clicking the title edits title and the body edits body (note `signal` also exposes `body`/`kicker` as AI-writable, the natural targets for that pass).
- **B4 layers panel (selection-only):** every block as a row (icon + label) in the left rail; click to select/locate on canvas (solves stacked/hard-to-click blocks). **No drag-reorder, no grouping, no dnd-kit** — `compile-grid.ts:106` orders by `y → x → array-index`, so reordering `doc.blocks` is a no-op in canvas *and* email. Pure selection + navigation.

---

## Phase 4 — Design power: typography + overlay  ·  `email_lab_text_styling_live_verify`

**Why here:** orthogonal feature work (block renderers / inspector / PDF) that can run in parallel with Phase 2/3; placed after Phase 1 so the inspector edits land once on the shared panel. All new props **USER-OWNED**, into their zod schemas (strip-mode landmine), round-tripped in `schema.test.ts`, never in author/patch schemas.

### Pillar 1 — Fonts (6 → 14), grouped, rendering on all engines
New families (crawl4ai 06/29/2026 — Google Fonts CSS2 tokens all HTTP 200): system `MODERN_SANS`(Inter)/`BOOK_SERIF`(Georgia)/`GEOMETRIC_SANS`(Century Gothic); web serif `PLAYFAIR_SERIF`/`CORMORANT_SERIF`/`MERRIWEATHER_SERIF`/`EB_GARAMOND_SERIF`; web sans `LATO_SANS`/`MONTSERRAT_SANS`/`RALEWAY_SANS`/`DM_SANS`/`NUNITO_SANS`; web display `OSWALD_SANS`(no italic)/`JOSEFIN_SANS`. Token pattern: `https://fonts.googleapis.com/css2?family=<Token>:wght@400;700&display=swap`.
Touch points: `types.ts` (`FontFamily` union +8) · `schema.ts` (`GlobalStyleSchema.fontFamily` `z.enum` — keep in lockstep or runtime reject) · `blocks/styles.ts` (`FONT_STACKS` Record forces all 14; `WEB_FONT_URLS` Partial + a test that every web font has an entry) · **both** pickers (`EmailLabGridShell` ~line 61 and `EmailLabShell` ~line 81) grouped by `<optgroup>` · `compile-grid.ts` (replace `createElement(Head, null)` with a `<Head>` injecting the family's `<link>`) · live-preview `<head>` injection · **PDF** `lib/pdf/fonts.ts` (`registerPdfFont(family)` lazily `Font.register`s the selected family).
PDF realities (crawl4ai 06/29/2026, @react-pdf 4.5.1 + advisor): **TTF/woff only — NOT woff2** (so `WEB_FONT_URLS` is unusable for PDF; register from a **pinned Fontsource CDN** static file — `public/` is NOT in the Vercel lambda fs); **no variable fonts** (register static weights); **react-pdf throws on an unresolved variant** (Oswald has no italic → a `pdfFontHasItalic(family)` guard must stop emitting `fontStyle:"italic"`); built-in fallback for the 3 system fonts. **PDF-real-fonts is the long pole — sequence it last.**

### Pillar 2 — Block-level formatting (whole-block)
Props (USER-OWNED, optional): `TextProps` + `MultiColumnColumn` get `textColor?/bold?/italic?/underline?`; `HeroProps` + `SignalProps` get `textColor?/bold?` only (italic/underline don't belong on display kicker/value). caniemail (06/29/2026): bold/italic/underline/color are email-safe incl. Outlook. Touch: `types.ts` (4 interfaces) · `schema.ts` (same 4 `*PropsSchema`) · renderers `TextBlock`/`HeroBlock`/`SignalBlock`/`MultiColumnBlock` (inline CSS — covers live + free + grid automatically) · `PdfBlock` matching branches · `BlockInspector` (B/I/U row + swatch for text/multi-column; Bold + swatch for hero/signal) · `schema.test.ts`.

### Pillar 3 — Image overlay opacity
Prop: `overlayBgOpacity?: number` (0–100) on `ImageProps` + `ImagePropsSchema` (`z.number().min(0).max(100).optional()`), USER-OWNED. `rgba()` and `background-image` are NOT Outlook-safe (caniemail) → Outlook-safe structure: outer Section opaque solid `backgroundColor: baseHex` **always** (so Outlook shows a readable solid panel) + the bg-image photo; inner scrim Section `rgba(base, overlayBgOpacity/100)` for modern clients. Back-compat: a saved `overlayBg: "rgba(...)"` with no `overlayBgOpacity` → inner uses it verbatim, outer uses an opaque approximation; default `base=#000000`, opacity `45`. Inspector: replace the raw scrim `TextField` with a `ColorField` (hex) + a 0–100 slider (live % + rgba preview). PDF: solid panel honoring `base`/opacity.

### Out of scope (Phase 4)
Inline rich text (spans *within* a paragraph — needs contentEditable; that's the B3 v1.5 per-element pass, separately scoped); per-character color; new block types.

---

## Phase 5 — AI section lever (the biggest AI-quality multiplier)  ·  `grid_email_canvas_v2_live_verify` (WS-C)

**Why:** the author engine insulates the model from coordinates (`author-doc.ts:22`), so better layouts come from a **richer compositional vocabulary**, not spatial tools — directly the "best for the AI builder" lever. C1 can start as pure content work in parallel with everything.

- **C1 — section-template library (build now, zero schema change):** expand `SEED_DOCS` (`lib/email/doc/default-docs.ts`) with section-sized reusable patterns — a 3-stat band, an agent-bio row (photo + bio + CTA), a listing trio, a "by-the-numbers" market block, a CTA banner. These raise the floor of both the example gallery and what the author engine can assemble. **Note:** email templates emit block props, not brain-vocabulary slugs — they touch neither `refinery/vocab` nor `refinery/packs`, so the pack/vocab pre-push gate does **not** apply (the source spec's "register vocab" line was spurious).
- **C2 — semantic `section` concept (DEFERRED — own design pass):** let the author emit a labeled, role-based section (intro / stats / listings / CTA) that the model plans at and code lays out — additive to `new_row`, no nesting, flattens to the flat array the renderer already consumes (the one Graphite idea worth borrowing: a group is a transform-owner that flattens at output). Not built from this spec; listed so it isn't lost.

---

## crawl4ai evidence (consolidated; dates noted)

- **This session (06/29/2026):** PostgREST schema-cache reload via `NOTIFY pgrst, 'reload schema'` (`docs.postgrest.org` schema-cache reference) + Supabase API guide (`supabase.com/docs`) → Defect 3. · react-dropzone `useDropzone` hook (npm / github react-dropzone) → optional B2 tool. · Puck `@puckeditor/core`, Craft.js `@craftjs/core`, Plate `udecode/plate` → evaluated and **rejected** for email (render React DOM, not Outlook-safe table HTML; we own the compiler).
- **Carried from the text-styling pass (06/29/2026):** Google Fonts CSS2 tokens (11 families HTTP 200) → Pillar 1. · caniemail: bold/italic/underline/color email-safe incl. Outlook; `rgba()`/`background-image` NOT in Outlook → Pillars 2/3. · @react-pdf 4.5.1 Font module: TTF/woff only (no woff2), no variable fonts, throws on missing variant → Pillar 1 PDF.

---

## Tools verdict (explicit)

Build the entire spec on **zero new dependencies**. Already present: `react-grid-layout` (canvas), `sonner` (toast), `zod` (validation), `@supabase/ssr` (API), native `ResizeObserver` (already used in charts). Autosave = hand-rolled debounce + `fetch` (no TanStack Query in repo). **Optional only:** `react-dropzone` if hand-rolled drag-drop proves flaky. Do **not** add Puck/Craft.js/Plate/dnd-kit for this work.

---

## Risks / open questions

1. **Phase 1 reshapes `capabilities.ts` + its test** — keep `PAID_ONLY` ranks; the CI invariant test must stay green (it's the guard against leaking paid into free).
2. **Server send accepts a null-project deliverable** — RESOLVED (blast route guards `project_id` at `:255`; only the activity-log skips).
3. **Designs API ownership** — `deliverables` SELECT is public, so the API must enforce `user_id` itself on every read/write (do not rely on RLS).
4. **Left-rail density** — the paid shell gains a third pane; confirm usable at target widths (`h-full`/`dvh`).
5. **PDF-real-fonts long pole** — heavier than the other surfaces; sequence last within Phase 4; ship email + live preview first.
6. **C2 under-designed** — do not build the semantic `section` from this spec.
7. **Parallel sessions** — this unified spec **replaces** the three; there is now one shell and one panel to coordinate on, removing the cross-spec collision that motivated the merge.

## Verification (per-phase, prod evidence per session loop)

- Phase 1 → `email_lab_shared_panel_live_verify`: both routes render unchanged; capabilities test green.
- Phase 2/3/5 → `grid_email_canvas_v2_live_verify`: autosave+restore, save→reload from the left rail, resize-fit, image drop, inline edit, layers-select, new section templates.
- Phase 4 → `email_lab_text_styling_live_verify`: each new font renders (not fallback) in preview + email + PDF; bold/italic/underline/color confirmed across the three; overlay hex + opacity shows an rgba scrim in a modern client and a readable solid panel in Outlook.
- Every push: `bunx next build` clean; `bun test lib/email/doc/schema.test.ts` (+ capabilities + PDF) green; close each check only on live prod evidence.
