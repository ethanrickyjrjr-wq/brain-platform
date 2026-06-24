# Gulf Teal Design Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** ⚡ Sonnet — 8 tasks, keywords: architecture, overhaul

**Goal:** ONE CSS variable controls everything. `--gulf-teal` → `--brand-primary` → every pill, every popup, every dock, every button, every chart, every page header — zero divergent hex values left anywhere.

**Architecture:** Four cascading layers.
- **Layer 0 (DONE):** CSS root expansion — `--brand-primary`, `--brand-surface`, `--brand-border` etc. added to `globals.css`. Waterline also done. Changing `--gulf-teal` now cascades through all brand tokens automatically.
- **Layer 1 (DONE):** Core CSS value fixes — `--gulf-teal: #3DC9C0`, `btn-gradient`, `.input-modern:focus`, `--color-teal-primary` alias, `--color-navy-dark` alias.
- **Layer 2:** Hardcoded hex sweep — `#0a8078` (60+ files), `#00d4aa` (rogue in overlays + globals), `#1BB8C9` (rogue in email lab). These bypass the token system and won't auto-fix from Layer 0-1.
- **Layer 3:** Visual enhancements — icons, stat scale.

**Tech Stack:** Next.js 15 App Router, Tailwind CSS v4 (`@theme inline`), CSS custom properties, Lucide React icons.

## Global Constraints

- `bunx next build` must pass after every task — never push a broken build.
- `bun test` must stay green.
- Never touch `.env*` or secrets files.
- Email HTML templates (in `route.ts` files and `lib/templates/`) cannot use CSS variables — hardcode final hex `#3DC9C0`.
- Print stylesheet overrides in `globals.css` (`@media print`) are intentional — `text-white` in print context is a valid override.
- `--text-on-brand` / `--text-on-accent` = `#0A1419` (midnight dark). Text on ANY teal background must be dark — WCAG contrast with #3DC9C0 requires ~10:1; white fails at ~2.3:1.
- Stage explicit file paths only — never `git add -A`.
- Append SESSION_LOG.md entry and commit it before `node scripts/safe-push.mjs`.
- Test fixture files (`*.test.ts`, `*.test.tsx`) that use `#00d4aa` as USER BRAND data — DO NOT change those; they test user-submitted color values, not our system tokens.

---

## Replacement cheatsheet

| Old pattern | New Tailwind class | New CSS value |
|-------------|-------------------|---------------|
| `#0a8078` | `bg-brand` / `text-brand` / `border-brand` | `var(--brand-primary)` |
| `border-[#0a8078]/40` | `border-brand/40` | `var(--brand-border)` |
| `bg-[#0a8078]/10` | `bg-brand/10` | `var(--brand-surface)` |
| `bg-[#0a8078]/20` | `bg-brand/20` | `var(--brand-surface-hover)` |
| `focus:ring-[#0a8078]/40` | `focus:ring-brand/40` | — |
| `text-navy-dark` on teal bg | `text-text-on-accent` | `var(--text-on-brand)` |
| `bg-navy-dark` | `bg-gulf-midnight` | `var(--gulf-midnight)` |
| `#00d4aa` UI chrome | same replacements above | `var(--brand-primary)` |
| `#1BB8C9` UI chrome | same replacements above | `var(--brand-primary)` |
| `rgba(10,128,120,…)` | — | `rgba(61,201,192,…)` |

---

## File Map

| Task | Status | Files |
|------|--------|-------|
| T0+T1 | ✅ DONE | `app/globals.css` |
| T2 | ⬜ | `lib/charts/series.ts` |
| T3 | ⬜ | `components/landing/home-explorer.css` |
| T4a | ⬜ | ~60 files with `#0a8078` (full list in task) |
| T4b | ⬜ | `#00d4aa` in: `DeliverableHighlightPopup.tsx`, `app/alerts/[id]/page.tsx` |
| T4c | ⬜ | `#1BB8C9` in email lab UI: `EmailLabShell.tsx`, `BlockCanvas.tsx`, `BlockInspector.tsx`, `CanvasBlock.tsx` |
| **T4d** | ⬜ | **Project Workspace** — 11 workspace components ALL using `#00d4aa` (previously missed entirely) |
| **T4e** | ⬜ | **Materials Hub + Content pages** — `IntentLine`, `MaterialRow`, `TemplateRail`, `ProjectSearch`, `c/[id]`, `p/[id]/TemplateSwitcher`, `ProjectsRail`, `/r/method`, `/r/source`, `ProjectEmailLabClient` |
| **T4f** | ⬜ | **Email template root** — `scripts/email/types.ts` (`SWFL_THEME.accent`), `lib/email/doc/default-docs.ts`, `lib/deliverable/material-status.ts` |
| T5 | ⬜ | AI Overlay System — `components/highlighter/*` + `components/briefcase/*` |
| T6 | ⬜ | navy-dark sweep — `SiteFooter.tsx`, `DigestSubscribe.tsx`, `MCPInstall.tsx`, `Waitlist.tsx` + ~21 other files |
| T7 | ⬜ | text-white accessibility sweep (teal-bg contexts) |
| T8 | ⬜ | `components/landing/Capabilities.tsx` (Lucide icons) |
| T9 | ⬜ | `components/landing/home-explorer.css` (stat scale) |
| T10 | ⬜ | Final build + spot-check |

---

## ✅ Task 0+1: CSS Root Expansion + Core Fix (DONE)

**File:** `app/globals.css` — already updated.

Changes shipped:
- `--gulf-teal: #3DC9C0` (was `#0a8078`)
- `--gulf-teal-dim: #2A8C85` (kept, correct dim)
- Brand semantic tokens added to `:root`:
  ```css
  --brand-primary:       var(--gulf-teal);
  --brand-dim:           var(--gulf-teal-dim);
  --brand-surface:       rgba(61,201,192,0.08);
  --brand-surface-hover: rgba(61,201,192,0.15);
  --brand-border:        rgba(61,201,192,0.4);
  --brand-border-subtle: rgba(61,201,192,0.2);
  --text-on-brand:       var(--text-on-accent);
  ```
- Tailwind utilities added to `@theme inline`:
  ```css
  --color-teal-primary:    var(--gulf-teal);
  --color-navy-dark:       var(--gulf-midnight);
  --color-brand:           var(--brand-primary);
  --color-brand-dim:       var(--brand-dim);
  --color-text-on-accent:  var(--text-on-accent);
  ```
- `.btn-gradient` → `linear-gradient(135deg, #3DC9C0 0%, #2A8C85 100%)`
- `.input-modern:focus` → `border-color: var(--brand-border)` (was `#00d4aa`)
- Waterline `body::before` added (coral→teal, 2px, fixed top, z-1000)

- [ ] **Step 1: Commit what's done**

```powershell
git add app/globals.css
git commit -m "fix(design): gulf-teal #3DC9C0, brand token roots, waterline — globals.css"
```

---

## Task 2: Chart Series Colors

**File:** `lib/charts/series.ts`

All 4 series presets have `#0a8078` hardcoded. Replace with `#3DC9C0`.

- [ ] **Step 1: Replace all 4 series colors**

Full file replacement:

```typescript
import type { ChartSeriesDef } from "@/types/viz";

export const SWFL_METRO_SERIES: ChartSeriesDef[] = [
  { key: "cape_coral", label: "Cape Coral", color: "#3DC9C0", dash: "" },
  { key: "fort_myers", label: "Fort Myers", color: "#5bc97a", dash: "8 5" },
  { key: "naples",     label: "Naples",     color: "#d4b370", dash: "2 5" },
];

export const REGION_PASSENGER_SERIES: ChartSeriesDef[] = [
  { key: "passengers", label: "Passengers", color: "#3DC9C0", dash: "" },
];

export const REGION_AIR_TRAVEL_SERIES: ChartSeriesDef[] = [
  { key: "passengers", label: "Monthly passengers", color: "#3DC9C0", dash: "" },
  { key: "trend",      label: "12-month trend",     color: "#d4b370", dash: "8 5" },
];

export const TIER_INDEXED_SERIES: ChartSeriesDef[] = [
  { key: "luxury_index",  label: "Luxury homes",  color: "#3DC9C0", dash: "" },
  { key: "starter_index", label: "Starter homes", color: "#5bc97a", dash: "8 5" },
];
```

- [ ] **Step 2: Build + commit**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 10
git add lib/charts/series.ts
git commit -m "fix(charts): gulf-teal #3DC9C0 in all series color constants"
```

---

## Task 3: home-explorer.css — rgba hardcodes + text-on-accent

**File:** `components/landing/home-explorer.css`

Most classes already use `var(--gulf-teal)` and are auto-fixed by T0. Three rgba values and three teal-background text colors need manual fixes.

- [ ] **Step 1: Fix 3 rgba hardcodes**

Line 12 (search-bar focus shadow): `rgba(10,128,120,.15)` → `rgba(61,201,192,.15)`

```css
.home-explorer .search-bar:focus-within {border-color:var(--gulf-teal);box-shadow:0 0 0 3px rgba(61,201,192,.15)}
```

Line 43 (active metric row tint): `rgba(10,128,120,.08)` → `rgba(61,201,192,.08)`

```css
.home-explorer .metric-row.active-metric {background:rgba(61,201,192,.08);border-left:2px solid var(--gulf-teal);padding-left:16px}
```

Line 97 (comp-us card tint): `rgba(10,128,120,.06)` → `rgba(61,201,192,.06)`

```css
.home-explorer .comp-us {background:rgba(61,201,192,.06)}
```

- [ ] **Step 2: Fix text-on-accent for teal-background elements**

Line 16 (search button — bg is gulf-teal):
```css
.home-explorer .search-btn {background:var(--gulf-teal);border:none;border-radius:7px;padding:8px 18px;font-size:13px;font-weight:600;color:var(--text-on-accent);cursor:pointer;white-space:nowrap;transition:opacity .15s}
```

Line 21 (active filter pill — bg is gulf-teal):
```css
.home-explorer .filter-pill.active {background:var(--gulf-teal);border-color:var(--gulf-teal);color:var(--text-on-accent)}
```

Line 103 (cap-btn CTA — bg is gulf-teal):
```css
.home-explorer .cap-btn {display:inline-flex;align-items:center;gap:8px;background:var(--gulf-teal);color:var(--text-on-accent);border:none;border-radius:8px;padding:13px 28px;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s;letter-spacing:.01em}
```

- [ ] **Step 3: Build + commit**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 10
git add components/landing/home-explorer.css
git commit -m "fix(design): rgba teal + text-on-accent for bright teal backgrounds"
```

---

## Task 4a: Hardcoded #0a8078 Sweep — Pages + Components

**~60 files.** Every `#0a8078` and `#076358` in non-AI-overlay files.

**Replace with:** Tailwind → `bg-brand` / `text-brand` / `border-brand` / `ring-brand`. Inline style → `var(--brand-primary)`. Email template → `#3DC9C0` (hardcoded, CSS vars don't work in email clients).

- [ ] **Step 1: Grep to see current state**

```powershell
Get-ChildItem -Recurse -Path "app","components","lib","mcp-widget" -Include "*.tsx","*.ts","*.css" |
  Select-String "#0a8078|#076358" |
  Select-Object Filename, LineNumber |
  Format-Table -AutoSize
```

- [ ] **Step 2: Fix app/ directory files**

Files to fix (all `#0a8078` → `bg-brand`/`text-brand`/`border-brand`/`var(--brand-primary)`):

- `app/alerts/page.tsx` — hover link colors: `text-[#0a8078]` → `text-brand`
- `app/ask/AskPage.tsx` — inline styles, focus rings: `'#0a8078'` → `var(--brand-primary)`
- `app/charts/page.tsx` — chart config color: `"#0a8078"` → `"#3DC9C0"`; `bg-navy-dark` → `bg-gulf-midnight`
- `app/charts/AddChartToProject.tsx` — buttons: `bg-[#0a8078]` → `bg-brand`
- `app/claim/page.tsx` + `app/claim/_components/ClaimOnLogin.tsx` — CTA buttons: `bg-[#0a8078]` → `bg-brand`
- `app/contacts/page.tsx` — buttons + focus: `bg-[#0a8078]` → `bg-brand`, `border-[#0a8078]` → `border-brand`
- `app/contacts/upload/UploadForm.tsx` — inline styles + focus: `'#0a8078'` → `var(--brand-primary)`
- `app/demo/page.tsx` — CTA: `bg-[#0a8078]` → `bg-brand`
- `app/embed/waitlist/page.tsx` + `app/embed/footer-token/page.tsx` — embed buttons
- `app/install-tabs.tsx` — tab border: `borderColor: '#0a8078'` → `borderColor: 'var(--brand-primary)'`
- `app/api/deliverables/[id]/blast/route.ts` — **EMAIL HTML**: `'#0a8078'` → `'#3DC9C0'` (hardcoded)
- `app/api/mcp/route.ts` — MCP response: check if it's brand color in HTML output → `#3DC9C0`
- `app/p/[id]/page.tsx` — action buttons
- `app/p/[id]/SendWeeklyHandle.tsx` + `app/p/[id]/SendToContactsHandle.tsx` — buttons
- `app/p/[id]/StatCard.tsx` — stat accent
- `app/project/NewProjectButton.tsx` — create button
- `app/project/page.tsx` — link hovers
- `app/r/_components/color-legend.tsx` — legend swatch
- `app/r/_components/location-ui.tsx` — search/CTA button
- `app/r/_components/metrics-table.tsx` — metric accent
- `app/r/_components/report-shell.tsx` — shell accent
- `app/r/page.tsx` — search bar
- `app/r/[slug]/page.tsx` — CTA
- `app/r/cre-swfl/[corridor]/page.tsx` + `app/r/cre-swfl/CREMetricsExplorer.tsx` + `app/r/cre-swfl/CREMarketBeatChart.tsx` — tokens, badges
- `app/r/zip-report/[zip]/page.tsx` — inline `color: '#0a8078'` → `var(--brand-primary)`
- `app/waitlist-form.tsx` — form focus + button
- `app/welcome/_components/AnswerBlock.tsx` — cursor: `background: '#0a8078'` → `var(--brand-primary)`
- `app/welcome/_components/CitationChip.tsx` — already uses `var(--brand-primary,#0a8078)` pattern — update fallback: `var(--brand-primary,#3DC9C0)` or just `var(--brand-primary)`
- `app/welcome/_components/FreshnessBadge.tsx` — same as above

- [ ] **Step 3: Fix components/ directory files**

- `components/CitationList.tsx` — citation links: `text-[#0a8078]` → `text-brand-dim`
- `components/charts/ChartBlockView.tsx` — chart config color
- `components/charts/ZHVIAreaChart.tsx` — chart config
- `components/charts/MapCanvas.tsx` — map accent
- `components/contacts/ContactPickerModal.tsx` + `components/contacts/PhoneContactPicker.tsx` — inputs + buttons
- `components/landing/Charts.tsx` + `components/landing/PixelTextAnimation.tsx` — gradient accent
- `components/nav/GlobalNav.tsx` — nav accent
- `components/nav/SiteShell.tsx` — nav CTA (8 occurrences)
- `components/nav/StandaloneBackBar.tsx` — back bar accent
- `components/PrintButton.tsx` — button
- `components/project/UploadDrop.tsx` — focus ring
- `components/ui/badge.tsx` — badge variant

- [ ] **Step 4: Fix lib/ + mcp-widget/ files**

- `lib/charts/gallery-loaders.ts` — chart color config
- `lib/landing/home-map-data.ts` — map color config
- `lib/templates/manifest.ts` + `lib/templates/token-contracts.ts` — **EMAIL/TEMPLATE**: use `#3DC9C0` hardcoded
- `lib/templates/render-html-template.test.ts` — update test expectation from `#0a8078` → `#3DC9C0`
- `mcp-widget/src/widget.ts` — widget accent color

- [ ] **Step 5: Fix CSS files**

- `app/r/zip-report/[zip]/zip-report.css` — any `#0a8078` rgba
- `app/z/[zip]/zip-page.css` — any `#0a8078` rgba
- `docs/design-reference/colors_and_type.css` — update reference doc

- [ ] **Step 6: Build + tests**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 20
bun test 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```powershell
# Stage only the files you touched (list them explicitly — never git add -A)
git add (get list from: git diff --name-only)
git commit -m "fix(design): replace all #0a8078 with brand token across 60 files"
```

---

## Task 4b: Rogue Teal #00d4aa Cleanup

**2 files.** `#00d4aa` appears in UI chrome for the deliverable overlay and alerts page. These should be `var(--brand-primary)`.

**Do NOT change:** test fixture files that use `#00d4aa` as a sample user-submitted brand color — those test user data, not our system.

- [ ] **Step 1: Fix DeliverableHighlightPopup.tsx**

File: `components/highlighter/DeliverableHighlightPopup.tsx`

Find and replace all `#00d4aa`:
```tsx
// All border-[#00d4aa] → border-brand
// All border-[#00d4aa]/60 → border-[var(--brand-border)]  (or keep opacity literal)
// All text-[#00d4aa] → text-brand
// All bg-[#00d4aa]/10 → bg-[var(--brand-surface)]
// All bg-[#00d4aa]/15 → bg-[var(--brand-surface-hover)]
// All bg-[#00d4aa]/80 → bg-brand/80
// focus:border-[#00d4aa] → focus:border-brand
// hover:text-[#00d4aa]/80 → hover:text-brand/80
// hover:border-[#00d4aa]/60 → hover:border-brand/40
// border-[#00d4aa]/40 → border-[var(--brand-border)]
// animate-spin border border-[#00d4aa] → border-brand
// border-b-2 border-[#00d4aa] → border-b-2 border-brand
```

- [ ] **Step 2: Fix app/alerts/[id]/page.tsx**

File: `app/alerts/[id]/page.tsx`

```tsx
// hover:text-[#00d4aa] → hover:text-brand
// border-[#00d4aa]/40 → border-[var(--brand-border)]
// text-[#00d4aa] → text-brand
// hover:bg-[#00d4aa]/10 → hover:bg-[var(--brand-surface)]
```

- [ ] **Step 3: Build + commit**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 10
git add components/highlighter/DeliverableHighlightPopup.tsx app/alerts/[id]/page.tsx
git commit -m "fix(design): #00d4aa rogue teal → brand token in overlay + alerts"
```

---

## Task 4c: Rogue Teal #1BB8C9 Cleanup — Email Lab

**4 files in `components/email-lab/`.** The email lab UI chrome uses `#1BB8C9` for interactive elements. These should be `var(--gulf-teal)`.

**Note:** Email CONTENT (rendered into actual email HTML) must use hardcoded hex — but the SHELL/UI chrome around the canvas uses CSS vars just fine.

**Note on color picker placeholder:** `components/email-lab/BlockInspector.tsx:348` has `placeholder="#1BB8C9"` on a color input — this is descriptive text, update to `placeholder="#3DC9C0"`.

- [ ] **Step 1: Fix EmailLabShell.tsx**

File: `components/email-lab/EmailLabShell.tsx`

Find and replace all `#1BB8C9`:
```tsx
// text-[#1BB8C9] → text-brand
// bg-[#1BB8C9] → bg-brand  (the "Generate" button — also needs color:var(--text-on-brand))
// bg-[#1BB8C9]/20 → bg-[var(--brand-surface-hover)]
// bg-[#1BB8C9]/15 → bg-[var(--brand-surface)]
// bg-[#1BB8C9]/10 → bg-[var(--brand-surface)]
// focus:ring-[#1BB8C9] → focus:ring-brand
// focus:border-[#1BB8C9]/50 → focus:border-[var(--brand-border)]
// border-[#1BB8C9]/30 → border-[var(--brand-border-subtle)]
// border-[#1BB8C9] → border-brand
// border-[#1BB8C9]/40 → border-[var(--brand-border)]
// border-t-[#1BB8C9] (spinner) → border-t-brand
// hover:bg-[#17a3b3] (hover of bg-[#1BB8C9] button) → hover:bg-brand-dim
// hover:border-[#1BB8C9]/50 → hover:border-[var(--brand-border)]
// hover:text-[#1BB8C9]/70 → hover:text-brand/70
// animate-pulse bg-[#1BB8C9] → animate-pulse bg-brand
```

Special case — the Generate button text: `text-[#070f14]` is correct (dark text on bright teal bg → fine as-is, it's the same semantic as `text-on-brand`).

- [ ] **Step 2: Fix BlockCanvas.tsx**

File: `components/email-lab/BlockCanvas.tsx`

```tsx
// border-dashed border-[#1BB8C9]/30 → border-dashed border-[var(--brand-border-subtle)]
// text-[#1BB8C9] → text-brand
// bg-[#1BB8C9]/20 → bg-[var(--brand-surface-hover)]
// bg-[#1BB8C9]/10 → bg-[var(--brand-surface)]
// h-0.5 bg-[#1BB8C9] (drop indicator line) → h-0.5 bg-brand
// border border-[#1BB8C9] → border border-brand
```

- [ ] **Step 3: Fix BlockInspector.tsx**

File: `components/email-lab/BlockInspector.tsx`

```tsx
// focus:border-[#1BB8C9] → focus:border-brand
// focus:ring-[#1BB8C9] → focus:ring-brand
// placeholder="#1BB8C9" → placeholder="#3DC9C0"
```

- [ ] **Step 4: Fix CanvasBlock.tsx**

File: `components/email-lab/CanvasBlock.tsx`

```tsx
// ring-[#1BB8C9] → ring-brand
```

- [ ] **Step 5: Build + commit**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 10
git add components/email-lab/EmailLabShell.tsx components/email-lab/BlockCanvas.tsx \
  components/email-lab/BlockInspector.tsx components/email-lab/CanvasBlock.tsx
git commit -m "fix(design): #1BB8C9 rogue teal → brand token in email lab UI"
```

---

## Task 4d: Project Workspace System — `#00d4aa` Throughout

**11 files — ALL completely missed in prior plan.**

The `/project/[id]/workspace/` system uses `#00d4aa` (rogue teal #3) as system chrome throughout. Every button, badge, link, input border in the workspace needs to become `var(--brand-primary)` / `bg-brand` / `text-brand`.

**Special case — BrandingBlock.tsx:** Has TWO types of `#00d4aa` usage:
1. `"#00d4aa"` in the default swatch palette array + `useState("#00d4aa")` → update to `"#3DC9C0"` (these represent OUR color that we show users as a default)
2. UI chrome (`focus:border-[#00d4aa]/40`, button `bg-[#00d4aa]`, etc.) → update to brand tokens

- [ ] **Step 1: Fix `ProjectActionBar.tsx`** (highest priority — AI action bar, 10+ occurrences)

```tsx
// border-[#00d4aa]/40 → border-[var(--brand-border)]
// text-[#00d4aa] → text-brand
// bg-[#00d4aa] text-[#04121b] (confirm button) → bg-brand text-text-on-accent
// bg-[#00d4aa]/5 → bg-[var(--brand-surface)]
// border-[#00d4aa]/30 → border-[var(--brand-border-subtle)]
// border-[#00d4aa]/20 → border-[var(--brand-border-subtle)]
// hover:text-[#00d4aa]/80 → hover:text-brand/80
// underline underline-offset-2 text-[#00d4aa] → text-brand
```

- [ ] **Step 2: Fix `ConnectMcpBlock.tsx`** (5 occurrences — primary CTA buttons)

```tsx
// bg-[#00d4aa] text-[#04121b] → bg-brand text-text-on-accent  (all 4 CTA variants)
// border-[#00d4aa]/40 text-[#00d4aa] (outline button) → border-brand text-brand
```

- [ ] **Step 3: Fix `BrandingBlock.tsx`** (dual role — see note above)

```tsx
// Swatch palette array + useState default: "#00d4aa" → "#3DC9C0"
// focus:border-[#00d4aa]/40 → focus:border-[var(--brand-border)]
// hover:border-[#00d4aa]/50 → hover:border-[var(--brand-border)]
// text-[#00d4aa] / border-[#00d4aa]/40 → text-brand / border-[var(--brand-border)]
// bg-[#00d4aa] text-[#04121b] (Save button) → bg-brand text-text-on-accent
// hover:bg-[#00d4aa]/10 → hover:bg-[var(--brand-surface)]
// bg-[#00d4aa]/10 → bg-[var(--brand-surface)]
// border-[#00d4aa] (active swatch indicator) → border-brand
```

- [ ] **Step 4: Fix `ProjectTitle.tsx`**

```tsx
// focus:border-[#00d4aa]/40 → focus:border-[var(--brand-border)]
// bg-[#00d4aa] text-[#04121b] (Save button) → bg-brand text-text-on-accent
```

- [ ] **Step 5: Fix `DeliverableEditPanel.tsx`**

```tsx
// const DEFAULT_COLOR = "#00d4aa" → "#3DC9C0"
// focus:border-[#00d4aa] → focus:border-brand
// accent-[#00d4aa] (checkbox) → accent-brand
```

- [ ] **Step 6: Fix remaining 6 workspace files**

`ItemCard.tsx`: `border-[#00d4aa]/40 text-[#00d4aa]` badge → `border-[var(--brand-border)] text-brand`

`ItemDetail.tsx`: 4× `text-[#00d4aa] underline` links → `text-brand underline`

`DeliverableLanes.tsx`: `bg-[#00d4aa]/15 text-[#00d4aa]` chip → `bg-[var(--brand-surface-hover)] text-brand`

`DeliverableModal.tsx`: 3× `text-[#00d4aa] underline` → `text-brand underline`

`DeliverableThumbnail.tsx`: 2× `text-[#00d4aa] underline` → `text-brand underline`

`ProjectsRail.tsx`: `text-[#00d4aa]` links + badges → `text-brand`; `bg-[#00d4aa]/15` → `bg-[var(--brand-surface)]`; `bg-[#00d4aa]/15 text-white` active → `bg-[var(--brand-surface-hover)] text-text-primary`

- [ ] **Step 7: Build + commit**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 10
git add app/project/[id]/workspace/ProjectActionBar.tsx \
  app/project/[id]/workspace/ConnectMcpBlock.tsx \
  app/project/[id]/workspace/BrandingBlock.tsx \
  app/project/[id]/workspace/ProjectTitle.tsx \
  app/project/[id]/workspace/DeliverableEditPanel.tsx \
  app/project/[id]/workspace/ItemCard.tsx \
  app/project/[id]/workspace/ItemDetail.tsx \
  app/project/[id]/workspace/DeliverableLanes.tsx \
  app/project/[id]/workspace/DeliverableModal.tsx \
  app/project/[id]/workspace/DeliverableThumbnail.tsx \
  app/project/ProjectsRail.tsx
git commit -m "fix(design): brand token in workspace system — ProjectActionBar, ConnectMcp, Branding, etc"
```

---

## Task 4e: Materials Hub + Content Pages

**10 files — all missed.**

- [ ] **Step 1: Fix `IntentLine.tsx`** (`#1BB8C9` — AI intent input in materials hub)

```tsx
// focus-within:ring-[#1BB8C9]/40 → focus-within:ring-brand/40
// text-[#1BB8C9] (3 occurrences — spark icon, send button, done text) → text-brand
```

- [ ] **Step 2: Fix `TemplateRail.tsx`** (`#1BB8C9` — template picker chips)

```tsx
// focus:ring-[#1BB8C9]/40 → focus:ring-brand/40
// hover:border-[#1BB8C9]/60 → hover:border-[var(--brand-border)]
// hover:bg-[#1BB8C9]/[0.06] → hover:bg-[var(--brand-surface)]
// border-[#1BB8C9]/50 → border-[var(--brand-border)]
// bg-[#1BB8C9]/[0.05] → bg-[var(--brand-surface)]
// (second chip group) focus:ring-[#1BB8C9]/40 → focus:ring-brand/40
```

- [ ] **Step 3: Fix `MaterialRow.tsx`** (`#1BB8C9` — focus ring on rows)

```tsx
// focus:ring-[#1BB8C9]/40 → focus:ring-brand/40
```

- [ ] **Step 4: Fix `ProjectSearch.tsx`** (`#00d4aa` — badge + focus border)

```tsx
// border-[#00d4aa]/40 text-[#00d4aa] → border-[var(--brand-border)] text-brand
// focus:border-[#00d4aa]/40 → focus:border-[var(--brand-border)]
```

- [ ] **Step 5: Fix `ProjectEmailLabClient.tsx`** (`#1BB8C9` — status text)

```tsx
// text-[#1BB8C9] → text-brand
```

- [ ] **Step 6: Fix content/conversation pages**

`app/c/[id]/page.tsx`: `text-[#00d4aa]` link → `text-brand`

`app/c/[id]/AddToProject.tsx`: `text-[#00d4aa]` + `hover:text-[#00d4aa]/80` → `text-brand` + `hover:text-brand/80`

`app/p/[id]/TemplateSwitcher.tsx`: `bg-[#00d4aa] text-black` active chip → `bg-brand text-text-on-accent`

`app/r/method/[metric]/page.tsx`: 3× `text-[#00d4aa]` links → `text-brand`

`app/r/source/[table]/page.tsx`: 2× `text-[#00d4aa]` + `decoration-[#00d4aa]/40` links → `text-brand`

- [ ] **Step 7: Build + commit**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 10
git add components/project/IntentLine.tsx components/project/TemplateRail.tsx \
  components/project/MaterialRow.tsx components/project/ProjectSearch.tsx \
  app/project/[id]/email-lab/ProjectEmailLabClient.tsx \
  app/c/[id]/page.tsx app/c/[id]/AddToProject.tsx \
  app/p/[id]/TemplateSwitcher.tsx app/r/method/[metric]/page.tsx \
  app/r/source/[table]/page.tsx
git commit -m "fix(design): brand token in materials hub + content/conversation pages"
```

---

## Task 4f: Email Template Root — SWFL_THEME.accent

**3 files — ONE change cascades to every email template.**

`SWFL_THEME.accent` in `scripts/email/types.ts` is `"#1BB8C9"`. This feeds:
- `lib/email/templates/components/_shared.ts` → `COMPONENT_DEFAULTS.accent`
- `lib/email/templates/charts/chart-defaults.ts` → chart accent
- `lib/email/templates/token-defaults.ts` → `ACCENT` token in all email HTML
- `lib/email/__fixtures__/golden/*.html` → will need regeneration

**Note:** Email HTML uses hardcoded hex (CSS vars don't work in email clients) — `#3DC9C0` is correct here, not `var(--brand-primary)`.

- [ ] **Step 1: Fix `scripts/email/types.ts`**

Find the `SWFL_THEME` object and change:
```typescript
// BEFORE:
accent: "#1BB8C9",
// AFTER:
accent: "#3DC9C0",
```

This ONE change propagates to all 3 email template layers automatically via `SWFL_THEME.accent`.

- [ ] **Step 2: Fix `lib/email/doc/default-docs.ts`**

```typescript
// BEFORE:
accentColor: "#1BB8C9",
// AFTER:
accentColor: "#3DC9C0",
```

- [ ] **Step 3: Fix `lib/deliverable/material-status.ts`**

```typescript
// BEFORE:
"block-canvas": { label: "email", color: "#1BB8C9", bg: "bg-[#1BB8C9]/15" },
"client-email": { label: "email", color: "#1BB8C9", bg: "bg-[#1BB8C9]/15" },
// AFTER:
"block-canvas": { label: "email", color: "#3DC9C0", bg: "bg-brand/15" },
"client-email": { label: "email", color: "#3DC9C0", bg: "bg-brand/15" },
```

Note: `bg-brand/15` works here because Tailwind v4 has `--color-brand` in `@theme inline`.

- [ ] **Step 4: Regenerate golden email fixtures**

The golden HTML snapshots in `lib/email/__fixtures__/golden/` hardcode `#1BB8C9` in their rendered output. After changing `SWFL_THEME.accent`, run:

```powershell
bun test lib/email --update-snapshots 2>&1 | tail -10
```

If tests don't have snapshot update mode, manually update the `accent` hex in each `.html` file in that directory from `#1BB8C9` → `#3DC9C0`.

- [ ] **Step 5: Build + full test suite**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 10
bun test 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```powershell
git add scripts/email/types.ts lib/email/doc/default-docs.ts \
  lib/deliverable/material-status.ts lib/email/__fixtures__/golden/
git commit -m "fix(design): SWFL_THEME.accent #3DC9C0 — email template teal root update"
```

---

## Task 5: AI Overlay System — THE MOST MISSED SYSTEM

**Files: `components/highlighter/*` + `components/briefcase/*`** — every AI pill, popup, dock that appears on EVERY page.

These are the interactive AI overlays visible to users on every report, every deliverable, every page. They all use hardcoded `#0a8078` (20+ occurrences each). With bright teal (#3DC9C0) now in the CSS root, these overlays still show the old dark teal because they bypass the token system entirely.

### Components in scope

| Component | What it is | # occurrences |
|-----------|-----------|---------------|
| `AskAiDock.tsx` | The fixed AI chat dock that slides up | ~16 |
| `HighlightPopup.tsx` | Popup when user highlights text on any report | ~20 |
| `FactChip.tsx` | Inline chip that underlines cited facts | 4 |
| `DiscoveryTicker.tsx` | Ticker tape showing live discoveries (✦ spark) | 1 |
| `FirstTouchHint.tsx` | First-visit hint overlay (✦ icon) | 1 |
| `AiBriefcasePill.tsx` | Floating briefcase pill + notification badge | 3 |
| `BriefcasePanel.tsx` | Slide-out panel showing AI briefcase items | 5 |
| `BriefcaseChat.tsx` | Chat interface within briefcase panel | 5 |
| `ChatScheduleCard.tsx` | Schedule card inside briefcase chat | 5 |
| `MCPInstallCard.tsx` | MCP install CTA card | 4 |

### Replacement patterns for this system

**Popup containers (borders, backgrounds):**
```tsx
// border-[#0a8078] → border-brand
// bg-[#2c3539] — keep (dark panel bg, correct)
// bg-[#0f1d24] — keep (dark panel bg, correct)
```

**Header/title brand labels:**
```tsx
// text-[#0a8078] (on "SWFL Data Gulf" label, "AI + Briefcase" label) → text-brand
```

**Action chips / suggestion buttons:**
```tsx
// border-[#0a8078] bg-[#0a8078]/10 → border-brand bg-[var(--brand-surface)]
// hover:bg-[#0a8078]/20 hover:text-[#0a8078] → hover:bg-[var(--brand-surface-hover)] hover:text-brand
```

**Dividers:**
```tsx
// border-[#0a8078]/30 → border-[var(--brand-border-subtle)]
// border-[#0a8078]/20 → border-[var(--brand-border-subtle)]
// border-[#0a8078]/10 → border-[var(--brand-border-subtle)]
```

**Input fields:**
```tsx
// border-[#0a8078] focus:border-[#0a8078] focus:ring-[#0a8078]/40
// → border-brand focus:border-brand focus:ring-brand/40
```

**Links + small action text:**
```tsx
// text-[#0a8078] → text-brand
// hover:text-[#0a8078] → hover:text-brand
// hover:text-[#0a8078]/80 → hover:text-brand/80
```

**Cursor/pulse animation:**
```tsx
// bg-[#0a8078]/80 (inline typing cursor) → bg-brand/80
```

**Schedule chips (ChatScheduleCard):**
```tsx
// chip outline: border-[#0a8078]/60 text-[#0a8078] → border-[var(--brand-border)] text-brand
// chip active: bg-[#0a8078] text-navy-dark → bg-brand text-text-on-accent
// shell border: border-[#0a8078]/30 bg-[#0a8078]/5 → border-[var(--brand-border-subtle)] bg-[var(--brand-surface)]
```

**MCP install card:**
```tsx
// border-[#0a8078]/40 → border-[var(--brand-border)]
// text-[#0a8078] (code text) → text-brand
// border-[#0a8078]/60 text-[#0a8078] (copy button) → border-[var(--brand-border)] text-brand
// hover:bg-[#0a8078]/15 → hover:bg-[var(--brand-surface-hover)]
```

**Notification badge (AiBriefcasePill):**
```tsx
// bg-navy-dark text-[#0a8078] → bg-gulf-midnight text-brand
```

**FactChip underline:**
```tsx
// decoration-[#0a8078]/50 → decoration-brand/50
// hover:bg-[#0a8078]/10 → hover:bg-[var(--brand-surface)]
// hover:decoration-[#0a8078] → hover:decoration-brand
// focus-visible:ring-[#0a8078]/60 → focus-visible:ring-brand/60
```

**✦ Spark icons (DiscoveryTicker + FirstTouchHint):**
```tsx
// text-[#0a8078] → text-brand
```

- [ ] **Step 1: Fix AskAiDock.tsx**

Apply the replacement patterns above. Key lines: 265, 266, 288, 302, 330, 340, 355, 370, 386, 411, 459, 471, 479, 491, 498, 515, 529.

After: `bunx next build 2>&1 | Select-String "error" | head -5`

- [ ] **Step 2: Fix HighlightPopup.tsx**

Apply the replacement patterns above. Key lines: 429, 430, 437, 444, 454, 486, 490, 515, 528, 535, 544, 563, 611, 623, 656, 673, 690, 705, 738, 745, 753.

After: `bunx next build 2>&1 | Select-String "error" | head -5`

- [ ] **Step 3: Fix FactChip.tsx, DiscoveryTicker.tsx, FirstTouchHint.tsx**

Apply spark/underline patterns above (1-4 changes each).

- [ ] **Step 4: Fix AiBriefcasePill.tsx**

Lines 86, 103, 130. Also `bg-navy-dark` on notification badge → `bg-gulf-midnight`.

- [ ] **Step 5: Fix BriefcasePanel.tsx**

Lines 88, 116, 137, 148. Apply the patterns above.

- [ ] **Step 6: Fix BriefcaseChat.tsx**

Lines 254, 264, 326, 363, 390. Apply input/chip/link patterns.

- [ ] **Step 7: Fix ChatScheduleCard.tsx**

Lines 62, 64, 155, 166, 177, 188. Apply chip/shell patterns above. Ensure `bg-brand text-text-on-accent` on active chip (was `bg-[#0a8078] text-navy-dark`).

- [ ] **Step 8: Fix MCPInstallCard.tsx**

Lines 27, 32, 38. Apply card/code/button patterns.

- [ ] **Step 9: Build + tests**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 20
bun test 2>&1 | tail -5
```

- [ ] **Step 10: Commit**

```powershell
git add components/highlighter/AskAiDock.tsx components/highlighter/HighlightPopup.tsx \
  components/highlighter/FactChip.tsx components/highlighter/DiscoveryTicker.tsx \
  components/highlighter/FirstTouchHint.tsx \
  components/briefcase/AiBriefcasePill.tsx components/briefcase/BriefcasePanel.tsx \
  components/briefcase/BriefcaseChat.tsx components/briefcase/ChatScheduleCard.tsx \
  components/briefcase/MCPInstallCard.tsx
git commit -m "fix(design): brand token in ALL AI pills, popups, dock — highlighter + briefcase"
```

---

## Task 6: navy-dark Sweep

**~25 files.** After T0, `--color-navy-dark` aliases to `var(--gulf-midnight)` so `bg-navy-dark` renders correctly. This task renames to canonical token and ensures `text-navy-dark` on teal buttons becomes `text-text-on-accent`.

- [ ] **Step 1: Grep occurrences**

```powershell
Get-ChildItem -Recurse -Path "app","components" -Include "*.tsx","*.ts","*.css" |
  Select-String "navy-dark|#0a0e1a|#076358" |
  Select-Object Filename, LineNumber, Line | Format-Table -AutoSize
```

- [ ] **Step 2: Apply replacements**

| Pattern | Replace with | Note |
|---------|-------------|------|
| `bg-navy-dark` | `bg-gulf-midnight` | Rename to canonical |
| `text-navy-dark` on teal bg | `text-text-on-accent` | WCAG — dark text on bright teal |
| `text-navy-dark` on dark bg | `text-gulf-midnight` | If it's text color on dark bg (rare) |
| `style={{ background: '#0a0e1a' }}` | `style={{ background: 'var(--gulf-midnight)' }}` | |
| `#076358` gradient stop | `#2A8C85` or `var(--gulf-teal-dim)` | |

Files in scope (verified by grep):
- `app/ask/page.tsx` + `app/ask/AskPage.tsx`
- `app/charts/page.tsx` (bg-navy-dark)
- `app/p/[id]/SendWeeklyHandle.tsx` (text-navy-dark on teal, ×3)
- `app/p/[id]/SendToContactsHandle.tsx`
- `app/project/[id]/ProjectWorkspace.tsx`
- `app/project/[id]/workspace/BuildActions.tsx`
- `app/project/[id]/workspace/DeliverableEditPanel.tsx`
- `app/r/[slug]/page.tsx`
- `app/r/_components/location-ui.tsx`
- `app/r/_components/report-shell.tsx`
- `app/r/cre-swfl/[corridor]/page.tsx`
- `app/r/zip-report/[zip]/page.tsx` (×2)
- `components/briefcase/AiBriefcasePill.tsx` — handled in T5
- `components/briefcase/BriefcaseChat.tsx` — handled in T5
- `components/briefcase/BriefcasePanel.tsx` — handled in T5
- `components/briefcase/ChatScheduleCard.tsx` — handled in T5
- `components/email/DigestSubscribe.tsx` — `btn-gradient text-navy-dark` → `text-text-on-accent`
- `components/highlighter/AskAiDock.tsx` — handled in T5
- `components/highlighter/DeliverableHighlightPopup.tsx` — handled in T4b
- `components/highlighter/HighlightPopup.tsx` — handled in T5
- `components/landing/Charts.tsx` (×4)
- `components/landing/MCPInstall.tsx` — `btn-gradient text-navy-dark` → `text-text-on-accent`
- `components/landing/Waitlist.tsx` (×3) — `btn-gradient text-navy-dark` → `text-text-on-accent`
- **`components/nav/SiteFooter.tsx`** — `bg-navy-dark` on footer → `bg-gulf-midnight` ← THE FOOTER
- `components/nav/SiteShell.tsx` (×8)

- [ ] **Step 3: Build + commit**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 20
git add (explicit file list)
git commit -m "fix(design): navy-dark → gulf-midnight sweep across all pages"
```

---

## Task 7: text-white Accessibility Sweep (Teal Backgrounds)

**Critical:** With bright teal (#3DC9C0), `text-white` on teal background = ~2.3:1 contrast. WCAG AA requires 4.5:1. `text-text-on-accent` (#0A1419 dark) on teal = ~10:1. This is NOT optional.

**In scope:** Elements where both a teal background AND white text appear together.
**Out of scope:** `text-white` on dark backgrounds (gulf-midnight, gulf-deep) — those are correct, no change needed.
**Print stylesheet:** `text-white` in `@media print` block is intentional — do NOT change.

- [ ] **Step 1: Find teal-bg + text-white combos**

```powershell
Get-ChildItem -Recurse -Path "app","components" -Include "*.tsx" |
  Where-Object {
    $content = Get-Content $_ -Raw
    ($content -match "bg-brand|bg-gulf-teal|bg-\[#3DC9C0\]|bg-teal-primary|bg-\[#0a8078\]") -and
    ($content -match "text-white")
  } | Select-Object Name, FullName
```

- [ ] **Step 2: Fix each file**

For each file: find elements where teal bg + white text coexist on the SAME element or immediate parent.

```tsx
// BEFORE:
<button className="bg-brand text-white px-4 py-2 rounded">
// AFTER:
<button className="bg-brand text-text-on-accent px-4 py-2 rounded">
```

Priority files:
- `components/nav/SiteShell.tsx` — nav CTA button
- `components/landing/Waitlist.tsx` — submit button
- `app/embed/waitlist/page.tsx` — embed button
- `app/r/cre-swfl/[corridor]/page.tsx` — action buttons
- `app/p/[id]/SendWeeklyHandle.tsx` — send buttons (likely text-navy-dark already, verify)

- [ ] **Step 3: Build + commit**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 20
git add (explicit list)
git commit -m "fix(a11y): text-on-accent for bright teal backgrounds — WCAG AA contrast"
```

---

## Task 8: Capabilities.tsx — Lucide Icons

**File:** `components/landing/Capabilities.tsx`

Replace ⚡📋📂🕑 with Lucide icons color-matched to each card's top-accent color.

- [ ] **Step 1: Replace emoji spans with Lucide icons**

```tsx
import { Zap, FileText, Users, CalendarClock } from "lucide-react";
```

Replace cap-icon spans:
- Card 1 (teal top-border): `<Zap size={22} aria-hidden style={{ color: "var(--gulf-teal)" }} />`
- Card 2 (mangrove): `<FileText size={22} aria-hidden style={{ color: "var(--mangrove)" }} />`
- Card 3 (gold): `<Users size={22} aria-hidden style={{ color: "var(--neutral-gold)" }} />`
- Card 4 (coral): `<CalendarClock size={22} aria-hidden style={{ color: "var(--sunset-coral)" }} />`

Also update `home-explorer.css` `.cap-icon` to support SVG:
```css
.home-explorer .cap-icon {width:22px;height:22px;margin-bottom:14px;display:block;flex-shrink:0}
```

- [ ] **Step 2: Build + commit**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 10
git add components/landing/Capabilities.tsx components/landing/home-explorer.css
git commit -m "feat(design): Lucide icons replace emojis in capabilities grid"
```

---

## Task 9: Hero Stats — Display Scale

**File:** `components/landing/home-explorer.css`

`.stat-value` is currently 20px. Make it 32px — a number you can read from 10 feet away.

- [ ] **Step 1: Update stat-value**

```css
/* BEFORE (line ~70): */
.home-explorer .stat-value {font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600}

/* AFTER: */
.home-explorer .stat-value {font-family:'JetBrains Mono',monospace;font-size:32px;font-weight:700;letter-spacing:-.02em;line-height:1}
```

Mobile guard (in the `@media (max-width: 860px)` block):
```css
.home-explorer .stat-value { font-size: 26px; }
```

- [ ] **Step 2: Build + commit**

```powershell
bunx next build 2>&1 | Select-String "error" | Select-Object -First 10
git add components/landing/home-explorer.css
git commit -m "feat(design): stat-value 32px display scale"
```

---

## Task 10: Final Build, Tests, and Spot-Check

- [ ] **Step 1: Clean build**

```powershell
bunx next build
```

Expected: 0 errors.

- [ ] **Step 2: Full test suite**

```powershell
bun test
```

Expected: all tests pass.

- [ ] **Step 3: Dev server spot-check**

Start with `bun dev` and verify:

| Page | What to check |
|------|--------------|
| `/` | Waterline at top (2px coral→teal); hero badge bright teal; search button has DARK text on teal; stats 32px; Lucide icons in capabilities |
| `/r/33931` | Report shell bg; CTA button bright teal with dark text; metrics accent bright |
| `/r/zip-report/33931` | ZIP report inline color bright teal |
| `/r/cre-swfl/` | Corridor badges bright teal |
| `/charts` | Cape Coral line bright teal (#3DC9C0), not dark |
| `/p/[any-id]` | Action buttons bright teal; HighlightPopup border bright on text select |
| `/project/[id]` | Build button bright teal; MaterialsHub teal elements bright |
| `/project/[id]/email-lab` | Email lab shell — teal UI elements bright; generate button dark text on teal |
| `/ask` | AskAiDock popup border bright teal |
| `/welcome` | FreshnessBadge bright teal, AnswerBlock cursor bright teal |
| `Any page` | ✦ spark in discovery ticker + first touch hint is bright teal |
| `Briefcase pill` | Notification badge bg and briefcase panel borders bright teal |
| `Any modal` | Waterline 2px line visible above modals OR modal z-index > 1000 |

- [ ] **Step 4: SESSION_LOG + push**

```powershell
# Append entry to SESSION_LOG.md first
git add SESSION_LOG.md
git commit -m "chore: SESSION_LOG gulf-teal design overhaul"
node scripts/safe-push.mjs
```

---

## Self-Review — Full Coverage Audit (v2, after live grep)

**Total files verified by live grep: 90+ unique source files.**

| System | Task | Verified? |
|--------|------|-----------|
| CSS root `globals.css` + waterline | T0+T1 ✅ DONE | ✅ |
| Chart series | T2 | ✅ |
| home-explorer.css rgba + text-on-accent | T3 | ✅ |
| `#0a8078` in app/pages (~60 files) | T4a | ✅ |
| `#00d4aa` in overlay (DeliverableHighlightPopup, alerts) | T4b | ✅ |
| `#1BB8C9` in email lab UI (4 files) | T4c | ✅ |
| **Project Workspace system** (11 files, was 100% missed) | **T4d** | ✅ NEW |
| **Materials Hub + content/conversation pages** (10 files, was 100% missed) | **T4e** | ✅ NEW |
| **SWFL_THEME.accent email template root** (3 files + golden fixtures) | **T4f** | ✅ NEW |
| AI pills, popups, dock — highlighter + briefcase (10 files) | T5 | ✅ |
| navy-dark sweep (25 files, SiteFooter confirmed added) | T6 | ✅ |
| text-white accessibility (teal-bg contexts) | T7 | ✅ |
| Lucide icons in Capabilities | T8 | ✅ |
| 32px stat display scale | T9 | ✅ |

**Confirmed intentional exclusions:**
- Test files (`*.test.ts`) using `#00d4aa`/`#1BB8C9` as user-submitted brand data — do NOT change
- `docs/`, `HOMEPAGE/`, `scratch-email.html`, `style-gallery-preview.html` — design reference, not shipped code
- `lib/email/__fixtures__/golden/*.html` — auto-regenerate after T4f via bun test
- `@media print` block in globals.css — intentional
