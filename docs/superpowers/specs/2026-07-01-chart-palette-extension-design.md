# On-brand chart palette extension + legible labels (Task B)

**Date:** 2026-07-01
**Slug / check:** `chart-palette-extension` · `chart_palette_extension_live_verify`
**Companions:** research `_ASSISTANT/research/2026-07-01-ai-deliverable-design-quality-research.md` §2.2 ·
handoff `_ASSISTANT/research/2026-07-01-design-quality-BCD-handoff.md` (Task B) ·
first-party verification `_ASSISTANT/research/2026-07-01-taskB-wcag-contrast-verification.md`

## Problem

Charts on both surfaces (chat = recharts registry; email/PDF = SVG→resvg PNG) assign colors per-surface with
no shared logic. When a chart needs more distinct colors than the brand supplies (e.g. 5 categories, 2 brand
colors), there is no on-brand way to produce the extras — they are either hardcoded presets or a single
`accent`. Two things are actually wrong today:

1. **No principled way to generate additional fills.** Nothing keeps extra colors in the brand's family, and
   nothing stops two generated fills (or a generated fill and a brand color) from coming out near-identical.
2. **Label legibility is faked.** The only "readable text on a fill" logic is two `readableText(bg)`
   heuristics (`lib/email/templates/charts/chart-renderer.ts:97`, `lib/email/templates/components/_shared.ts:55`)
   using **rec601 luma**, not a real contrast check. It happens to land correct on the current gulf palette
   (ink ≈ 7.5:1) but is not a real WCAG pick and will mis-fire on other fills.

**Explicit non-problems** (scope corrected with operator 2026-07-01): this is **not** a WCAG compliance gate.
It never blocks a send, never recolors brand or user-chosen colors, and never inspects images/photos. Brand
colors always win.

## Goal

A single pure helper that, given the brand/chosen colors and how many distinct colors a chart needs:
- returns the brand/chosen colors first, unchanged;
- generates any additional fills **in the same palette scheme** (OKLCH, varying hue **and** lightness off
  the brand's chroma), each **visible** against the background and **clearly distinct** — in both hue and
  grayscale-lightness — from the brand colors, from each other, and from the background;
- picks a **genuinely legible** label color for any fill.

Deterministic, offline-testable, zero send-blocking, zero brand mutation.

## What we're building

### Module: `lib/charts/palette.ts` (pure, zero deps)

Three concerns, each independently testable:

**(1) Color math — sourced constants only.**
- `relativeLuminance(hex): number` and `contrastRatio(a, b): number` — verbatim WCAG 2.2 (W3C
  `TR/WCAG22/` Appendix A): linearize each channel `c8/255 → (c≤0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4)`,
  `L = 0.2126R + 0.7152G + 0.0722B`, ratio `(L1+0.05)/(L2+0.05)`.
- `srgbToOklab(hex): {L,a,b}` / `oklabToOklch` / `oklchToHex` — verbatim Ottosson linear-sRGB↔OKLab matrix
  (2021-01-25 revision). The linearization step is shared with `relativeLuminance` (same gamma expansion).
- `oklabDistance(a, b): number` — Euclidean distance in OKLab (perceptually uniform).

**(2) `extendPalette(anchors: string[], count: number, opts: { background: string }): string[]`.**
- Returns exactly `count` hex colors. `anchors` (brand/chosen) are emitted first, **verbatim, never mutated**.
- If `count > anchors.length`, generate `count - anchors.length` extras from the **primary (first) anchor's**
  OKLCH chroma as the family base, varying **both hue AND lightness** — NOT constant-lightness hue rotation.
  Research verdict (Datawrapper, and confirmed by the measured gulf-palette failure): distinctness must
  include a **lightness** difference — two colors of the same lightness are identical in grayscale and to
  colorblind viewers (the exact iso-luminant trap: gulf teal/mangrove/gold = 1.02:1). So extras step hue by
  moderate increments (few hues + neighbors, avoid all-wheel) **and** step lightness so each extra reads as a
  distinct gray. When anchors disagree in L/C, the primary anchor sets the family feel; anchors stay
  unchanged.
- **Distinctness guard (backstop):** each generated extra must clear (a) `MIN_OKLAB_DISTANCE` from every
  anchor, every already-accepted extra, and the background; (b) `MIN_LIGHTNESS_DELTA` in OKLab L from every
  anchor + accepted extra (the grayscale test); (c) a **visibility** floor `MIN_BG_CONTRAST` vs background.
  On failure, nudge OKLCH lightness (primary) then hue and retry a bounded number of times; if the budget is
  exhausted (tiny gamut), return the best candidate anyway. **Never throws, never returns fewer than
  `count`.** Only generated extras are ever adjusted — anchors are inviolable.
- **Count caps + graceful fallback (never refuse a chart — FOCUS rule 4):** `SOFT_MAX_CATEGORICAL = 6`
  (Adobe: comprehension degrades at 6, "extremely difficult" at 12), `HARD_MAX_CATEGORICAL = 10` (D3
  Tableau10/Category10). Below the soft cap, prefer hue+lightness variation. At/above it, stop introducing
  new hues and instead ramp lightness within the established few hues (a categorical→lightness-stepped
  fallback), and the caller may group tail categories as "Other". The helper still returns `count` colors —
  it never errors, it degrades. (Emit a soft `log`/warn when `count > SOFT_MAX_CATEGORICAL` so the surface
  can consider positional encoding, per Adobe.)
- **Cheap colorblind wins (Q5, "keep simple"):** the lightness variation above is itself the primary CVD
  aid (grayscale-distinct ⇒ CVD-distinct). Additionally prefer hue steps along the blue↔warm axis and avoid
  placing a generated pure-green adjacent to a red/orange anchor. No full CVD simulation in MVP.

**(3) `readableLabel(fill: string, opts?: { light?, dark? }): string`.**
- Returns whichever of `dark` (default brand ink `#0a2540`) / `light` (`#ffffff`) has the higher
  `contrastRatio` against `fill`, preferring one that clears 4.5:1 (SC 1.4.3). Replaces both rec601
  `readableText` call sites.
- **WCAG 2, not APCA (decided from research).** APCA (the WCAG 3 candidate) is perceptually better but
  "still in development" and not ratified — adopting a draft as a hard dependency is premature. For a binary
  ink-vs-white *pick*, WCAG 2 and APCA agree on the winner in nearly all cases; the divergence is at absolute
  thresholds we don't rely on. Leave a code comment to revisit APCA when WCAG 3 ratifies.

### Tunable constants (documented provenance)

- `MIN_OKLAB_DISTANCE` — conservative product constant grounded in the JND principle (the ONLY first-party
  number is **ΔE ≈ 2.3 = JND**, per colorjs.io [CSS Color 4/5 co-editors] and CIE). Set to a comfortable
  multiple above JND so categories read as *clearly* distinct, and calibrated to the OKLab scale (L∈[0,1]).
  **Labeled our choice, not a first-party number** (FOCUS rule 1). It is a backstop — hue+lightness variation
  does the primary work. Starting value pinned in the plan with a fixture test; expose as a tunable const.
- `MIN_LIGHTNESS_DELTA` — minimum OKLab-L separation between any two colors in a chart (the grayscale/CVD
  test from Datawrapper). The single most important guard, because it's the exact gulf-palette failure mode.
  Tunable; starting value pinned in the plan.
- `MIN_BG_CONTRAST` — start at 3:1 (SC 1.4.11 non-text), tunable. Applies to generated extras only.
- `SOFT_MAX_CATEGORICAL = 6` (Adobe), `HARD_MAX_CATEGORICAL = 10` (D3). Caps on hue proliferation; above
  them the helper degrades to lightness-stepping, never errors.
- `BRAND_INK` = `#0a2540`, default dark label color (existing gulf ink).

None of these ever block a send. They only shape the *generated* extras; anchors bypass all of them.

### Wiring (call sites enumerated in the implementation plan)

`palette.ts` becomes the shared source every color-assignment site calls. Brand/chosen colors flow straight
through `extendPalette` as `anchors`; generation only fires when a surface needs more colors than anchors
supply. Candidate sites to wire (confirm + name exact lines in the plan): `lib/charts/series.ts` presets,
email single-`accent` builders (`lib/email/chart-image.ts`, `lib/charts/svg/ranked-delta.ts`),
`HBarChart.tsx` tier colors, `SWFL_CHART_DEFAULTS`, and the two `readableText` sites → `readableLabel`.
Because chat and email both consume the same assigned colors on the shared `ChartSpec`, one helper covers
both surfaces.

## What this does NOT do

- No send gate. No hard failure. No regeneration-blocking.
- No recoloring of brand or user-chosen colors — anchors are always emitted unchanged.
- No image/photo inspection.
- No colorblind/dash enforcement — the existing `series.ts` second-channel (`dash`) rationale (WCAG 1.4.1)
  is untouched and out of scope here.

## Testing

- **WCAG goldens:** `contrastRatio` against W3C worked values (black/white = 21:1; known pairs). Gulf palette
  ink-on-fill ≈ 7.4–7.8:1, white-on-fill ≈ 2.0:1 (from verification note) as fixtures.
- **OKLab round-trip:** `srgbToOklab` against Ottosson's published XYZ/OKLab example pairs (±rounding);
  `hex → oklch → hex` stable.
- **`extendPalette`:** always returns `count`; `anchors` appear first and byte-identical; every generated
  extra clears `MIN_OKLAB_DISTANCE`, `MIN_LIGHTNESS_DELTA` (grayscale test — assert no two chart colors share
  a gray), and `MIN_BG_CONTRAST`; `count ≤ anchors.length` returns anchors untouched; `count` above
  `HARD_MAX_CATEGORICAL` still returns `count` via lightness-stepping without throw; degenerate gamut (near-
  black anchor, tiny gamut) still returns `count`.
- **`readableLabel`:** picks the higher-contrast option; prefers the ≥4.5:1 one when both exist.

## Blast radius

Low, given the scope correction. The helper is additive; wiring only changes output where a surface
previously had no principled way to pick extra colors. **It must not change any chart that uses only brand
colors** — a regression test asserts anchor pass-through. The `readableText → readableLabel` swap can change a
label color where rec601 and real WCAG disagree; audit the affected charts (heat-row cells, badges) in the
plan before shipping.

## Evidence (fetched live via crawl4ai this session; tiered first-party vs secondary in the verification note)

- W3C `https://www.w3.org/TR/WCAG22/` — relative luminance + contrast ratio + SC 1.4.3/1.4.11 (verbatim).
- Ottosson `https://bottosson.github.io/posts/oklab/` — linear-sRGB↔OKLab matrices (verbatim).
- `https://colorjs.io/docs/color-difference` (CSS Color 4/5 co-editors) — uniform-space distance; ΔE 2.3 = JND.
- `https://en.wikipedia.org/wiki/Color_difference` (citing CIE) — ΔE=1 JND convention / 2.3 CIE76.
- `https://spectrum.adobe.com/page/color-for-data-visualization/` (Adobe) — "up to 6 categorical colors",
  positional fallback beyond, CVD-optimized palette.
- `https://carbondesignsystem.com/data-visualization/color-palettes/` (IBM Carbon) — sequence maximizes
  neighbor contrast.
- `https://observablehq.com/@d3/color-schemes` (D3) — Tableau10/Category10 (~10-color practical cap).
- `https://blog.datawrapper.de/beautifulcolors/` (Datawrapper) — vary lightness not just hue (grayscale
  test); few hues + neighbors; blue↔warm is CVD-safe, pure green is risky.
- `https://git.apcacontrast.com/documentation/WhyAPCA.html` (APCA/Myndex) — APCA is the WCAG-3 candidate,
  still in development → adopt stable WCAG 2 now, revisit later.
- `https://xdgov.github.io/data-design-standards/components/colors` — sequential/qualitative/diverging + 508
  palette guidance (informs future palette-type selection; not required for this helper's MVP).
