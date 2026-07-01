# Chart Palette Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** ⚡ Sonnet — 8 tasks, 10 files, keywords: architecture

**Goal:** A pure helper that always applies brand/chosen chart colors as-is and generates any *extra* fills a chart needs on-brand, distinct, and legibly labeled — never blocking a send, never recoloring a brand, never touching images.

**Architecture:** One new pure module `lib/charts/palette.ts` (WCAG-2.2 contrast math + OKLab conversion + `extendPalette` generator + `readableLabel`), then thin wiring at the existing per-surface color-assignment sites so both chat (recharts) and email (SVG→resvg) route multi-color assignment through it. Anchors (brand/chosen colors) always pass through untouched; generation only fires when a chart needs more colors than the anchors supply.

**Tech Stack:** TypeScript, `bun:test` (colocated `*.test.ts`, run `bun test <path>`), no new dependencies (zero-dep module).

## Global Constraints

- **Never blocks a send. Never recolors brand/chosen colors. Never inspects images.** Anchors are emitted verbatim; only generated extras are shaped.
- **Never invent a number** (FOCUS rule 1). The only first-party thresholds are the WCAG formulas and ΔE≈2.3=JND. Every generated-palette threshold constant is a documented *tunable* labeled "our choice," not sourced gospel.
- **Never refuse a chart** (FOCUS rule 4). `extendPalette` always returns exactly `count` colors; above the categorical cap it degrades to lightness-stepping, it never throws.
- Verbatim sourced constants: WCAG 2.2 relative luminance / contrast (W3C `TR/WCAG22/` Appendix A); OKLab forward+inverse matrices (Ottosson, 2021-01-25 revision). sRGB encode threshold `0.0031308 = 0.04045/12.92` (derived from the verified WCAG expansion constant).
- Colors are 6-digit hex (`#rrggbb`) or 3-digit shorthand; non-hex inputs are handled defensively (never throw).
- Spec: `docs/superpowers/specs/2026-07-01-chart-palette-extension-design.md`. Evidence: `_ASSISTANT/research/2026-07-01-taskB-wcag-contrast-verification.md`.

---

## File Structure

- **Create** `lib/charts/palette.ts` — the whole helper. Sections: (1) hex parse + sRGB linearize/encode, (2) WCAG `relativeLuminance`/`contrastRatio`, (3) OKLab/OKLCH conversion + `oklabDistance`, (4) `extendPalette`, (5) `readableLabel`, (6) exported tunable constants.
- **Create** `lib/charts/palette.test.ts` — `bun:test` suite: WCAG goldens, OKLab round-trip vs Ottosson pairs, `extendPalette` invariants, `readableLabel` picks.
- **Modify** (wiring — exact sites in Tasks 5+): the two `readableText` sites and the multi-color assignment seams enumerated by the code probe.

---

## Task 1: WCAG contrast math (relativeLuminance, contrastRatio)

**Files:**
- 🔴 Create: `lib/charts/palette.ts`
- 🔴 Test: `lib/charts/palette.test.ts`

**Interfaces:**
- Produces: `relativeLuminance(hex: string): number`, `contrastRatio(a: string, b: string): number`, and internal `parseHex(hex: string): [number, number, number] | null`, `srgbToLinear(hex: string): [number, number, number] | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test";
import { relativeLuminance, contrastRatio } from "./palette";

test("relative luminance: black=0, white=1 (W3C sRGB)", () => {
  expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
});

test("contrast ratio: black vs white = 21:1 (W3C worked value)", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
});

test("contrast ratio is symmetric", () => {
  expect(contrastRatio("#3dc9c0", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#3dc9c0"), 6);
});

test("gulf palette measured values (from verification note)", () => {
  // ink #0a2540 on each fill ~7.4-7.8:1; white on each fill ~2.0:1
  expect(contrastRatio("#0a2540", "#3dc9c0")).toBeGreaterThan(7);
  expect(contrastRatio("#ffffff", "#3dc9c0")).toBeLessThan(2.2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/charts/palette.test.ts`
Expected: FAIL — `Cannot find module './palette'` / export missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/charts/palette.ts
// WCAG 2.2 relative luminance + contrast ratio — verbatim W3C TR/WCAG22 Appendix A.
// See _ASSISTANT/research/2026-07-01-taskB-wcag-contrast-verification.md for provenance.

/** Parse #rgb / #rrggbb → [r,g,b] 0-255, or null for non-hex input (never throws). */
export function parseHex(hex: string): [number, number, number] | null {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** sRGB 8-bit channel → linear-light. WCAG: c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4. */
function channelToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function srgbToLinear(hex: string): [number, number, number] | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return [channelToLinear(rgb[0]), channelToLinear(rgb[1]), channelToLinear(rgb[2])];
}

/** WCAG relative luminance: L = 0.2126R + 0.7152G + 0.0722B (linear channels). */
export function relativeLuminance(hex: string): number {
  const lin = srgbToLinear(hex);
  if (!lin) return 0;
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio (L1+0.05)/(L2+0.05), L1=lighter. Range 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const L1 = Math.max(la, lb);
  const L2 = Math.min(la, lb);
  return (L1 + 0.05) / (L2 + 0.05);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/charts/palette.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/charts/palette.ts lib/charts/palette.test.ts
git commit -m "feat(charts): WCAG 2.2 contrast math for palette helper"
```

---

## Task 2: OKLab / OKLCH conversion + distance

**Files:**
- 🔴 Modify: `lib/charts/palette.ts`
- 🔴 Test: `lib/charts/palette.test.ts`

**Interfaces:**
- Consumes: `parseHex`, `srgbToLinear`, `channelToLinear` from Task 1.
- Produces: `srgbToOklab(hex): Oklab | null`, `oklabToHex(lab): string`, `oklabToOklch(lab): Oklch`, `oklchToOklab(lch): Oklab`, `oklabDistance(a: Oklab, b: Oklab): number`; types `Oklab = {L,a,b}`, `Oklch = {L,C,h}` (h in degrees).

- [ ] **Step 1: Write the failing test**

```ts
import { srgbToOklab, oklabToHex, oklabToOklch, oklchToOklab, oklabDistance } from "./palette";

test("OKLab: white ~ L=1, a≈0, b≈0 (Ottosson)", () => {
  const w = srgbToOklab("#ffffff")!;
  expect(w.L).toBeCloseTo(1, 2);
  expect(w.a).toBeCloseTo(0, 2);
  expect(w.b).toBeCloseTo(0, 2);
});

test("OKLab hex round-trip is stable", () => {
  for (const hex of ["#3dc9c0", "#5bc97a", "#d4b370", "#0a2540", "#808080"]) {
    const back = oklabToHex(srgbToOklab(hex)!);
    // allow ±1 per channel for rounding
    const a = parseHexTuple(hex), b = parseHexTuple(back);
    for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(1);
  }
});

test("OKLCH round-trips through OKLab", () => {
  const lab = srgbToOklab("#3dc9c0")!;
  const back = oklchToOklab(oklabToOklch(lab));
  expect(back.L).toBeCloseTo(lab.L, 6);
  expect(back.a).toBeCloseTo(lab.a, 6);
  expect(back.b).toBeCloseTo(lab.b, 6);
});

test("oklabDistance: identical=0, iso-luminant gulf pair is nonzero but small in L", () => {
  const teal = srgbToOklab("#3dc9c0")!;
  const mang = srgbToOklab("#5bc97a")!;
  expect(oklabDistance(teal, teal)).toBeCloseTo(0, 6);
  expect(Math.abs(teal.L - mang.L)).toBeLessThan(0.05); // confirms iso-luminant trap
});

// helper local to the test file
function parseHexTuple(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/charts/palette.test.ts`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Write minimal implementation** (append to `lib/charts/palette.ts`)

```ts
// OKLab — verbatim Ottosson linear-sRGB↔OKLab matrices (2021-01-25 revision).
export interface Oklab { L: number; a: number; b: number }
export interface Oklch { L: number; C: number; h: number } // h in degrees 0..360

export function srgbToOklab(hex: string): Oklab | null {
  const lin = srgbToLinear(hex);
  if (!lin) return null;
  const [r, g, b] = lin;
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

/** Linear-light channel → sRGB 8-bit. Inverse of channelToLinear; threshold 0.0031308 = 0.04045/12.92. */
function linearToChannel(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

export function oklabToHex(lab: Oklab): string {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.L - 0.0894841775 * lab.a - 1.2914855480 * lab.b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const hx = (n: number) => linearToChannel(n).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

export function oklabToOklch(lab: Oklab): Oklch {
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L: lab.L, C, h };
}

export function oklchToOklab(lch: Oklch): Oklab {
  const rad = (lch.h * Math.PI) / 180;
  return { L: lch.L, a: lch.C * Math.cos(rad), b: lch.C * Math.sin(rad) };
}

export function oklabDistance(a: Oklab, b: Oklab): number {
  const dL = a.L - b.L, da = a.a - b.a, db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/charts/palette.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/charts/palette.ts lib/charts/palette.test.ts
git commit -m "feat(charts): OKLab/OKLCH conversion + perceptual distance"
```

---

## Task 3: extendPalette (generate on-brand distinct extras)

**Files:**
- 🔴 Modify: `lib/charts/palette.ts`
- 🔴 Test: `lib/charts/palette.test.ts`

**Interfaces:**
- Consumes: `srgbToOklab`, `oklabToHex`, `oklabToOklch`, `oklchToOklab`, `oklabDistance`, `contrastRatio`, `parseHex` from Tasks 1-2.
- Produces: `extendPalette(anchors: string[], count: number, opts?: { background?: string }): string[]`; exported constants `MIN_OKLAB_DISTANCE`, `MIN_LIGHTNESS_DELTA`, `MIN_BG_CONTRAST`, `SOFT_MAX_CATEGORICAL`, `HARD_MAX_CATEGORICAL`.

- [ ] **Step 1: Write the failing test**

```ts
import { extendPalette, srgbToOklab, oklabDistance, contrastRatio, MIN_LIGHTNESS_DELTA } from "./palette";

const WHITE = "#ffffff";
const GULF = ["#3dc9c0", "#5bc97a", "#d4b370"];

test("count <= anchors: returns anchors unchanged, in order", () => {
  expect(extendPalette(GULF, 2, { background: WHITE })).toEqual(["#3dc9c0", "#5bc97a"]);
  expect(extendPalette(GULF, 3, { background: WHITE })).toEqual(GULF);
});

test("always returns exactly count colors", () => {
  for (const n of [1, 4, 6, 8, 12, 20]) {
    expect(extendPalette(["#3dc9c0"], n, { background: WHITE })).toHaveLength(n);
  }
});

test("anchors appear first and byte-identical when generating extras", () => {
  const out = extendPalette(GULF, 6, { background: WHITE });
  expect(out.slice(0, 3)).toEqual(GULF);
});

test("generated extras clear the lightness-delta grayscale test vs every other color", () => {
  const out = extendPalette(["#3dc9c0"], 5, { background: WHITE });
  const labs = out.map((h) => srgbToOklab(h)!);
  for (let i = 1; i < labs.length; i++) {
    for (let j = 0; j < i; j++) {
      // at least one axis clearly separates them; lightness is the guarded one
      const dL = Math.abs(labs[i].L - labs[j].L);
      const dist = oklabDistance(labs[i], labs[j]);
      expect(dL >= MIN_LIGHTNESS_DELTA || dist >= 0.1).toBe(true);
    }
  }
});

test("generated extras are visible against the background (>=3:1)", () => {
  const out = extendPalette(["#3dc9c0"], 5, { background: WHITE });
  for (const c of out.slice(1)) expect(contrastRatio(c, WHITE)).toBeGreaterThanOrEqual(2.9);
});

test("degenerate anchor (near-black) still returns count without throwing", () => {
  expect(() => extendPalette(["#000000"], 8, { background: WHITE })).not.toThrow();
  expect(extendPalette(["#000000"], 8, { background: WHITE })).toHaveLength(8);
});

test("empty anchors falls back to a default and still returns count", () => {
  expect(extendPalette([], 4, { background: WHITE })).toHaveLength(4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/charts/palette.test.ts`
Expected: FAIL — `extendPalette` not defined.

- [ ] **Step 3: Write minimal implementation** (append to `lib/charts/palette.ts`)

```ts
// Tunable product constants — OUR choices, grounded in but NOT verbatim from sources.
// See verification note: only ΔE≈2.3=JND is first-party; these are conservative multiples.
export const MIN_OKLAB_DISTANCE = 0.1;   // clearly-distinct floor in OKLab (~several× a nominal JND)
export const MIN_LIGHTNESS_DELTA = 0.11; // min OKLab-L separation (the grayscale/CVD guard)
export const MIN_BG_CONTRAST = 3;        // SC 1.4.11 non-text, applied to generated extras only
export const SOFT_MAX_CATEGORICAL = 6;   // Adobe Spectrum
export const HARD_MAX_CATEGORICAL = 10;  // D3 Tableau10/Category10
const DEFAULT_ANCHOR = "#3dc9c0";        // gulf teal, used only when anchors is empty

function clampL(L: number): number { return Math.max(0.28, Math.min(0.9, L)); }

/** Is `cand` clearly distinct from every color in `others` and visible on `bg`? */
function accepts(cand: Oklab, others: Oklab[], bg: string): boolean {
  if (contrastRatio(oklabToHex(cand), bg) < MIN_BG_CONTRAST) return false;
  for (const o of others) {
    // reject only when BOTH lightness AND overall distance are too small (accept if EITHER separates)
    if (Math.abs(cand.L - o.L) < MIN_LIGHTNESS_DELTA && oklabDistance(cand, o) < MIN_OKLAB_DISTANCE) {
      return false;
    }
  }
  return true;
}

/**
 * Brand/chosen `anchors` are returned first, verbatim. Any extras beyond them are
 * generated ON-BRAND: LIGHTNESS is the primary distinctness axis (Datawrapper: vary
 * lightness, not hue — the grayscale test), with only SMALL neighbor hue offsets
 * (≤40°, never "all over the wheel") so extras stay in the brand family. Greedily
 * accept candidates clearing the distinctness + visibility guards. Never throws;
 * always returns exactly `count`.
 */
export function extendPalette(
  anchors: string[],
  count: number,
  opts?: { background?: string },
): string[] {
  const bg = opts?.background ?? "#ffffff";
  const clean = anchors.filter((a) => parseHex(a));
  const out = clean.slice(0, count);
  if (out.length >= count) return out;

  const base = oklabToOklch(srgbToOklab(clean[0] ?? DEFAULT_ANCHOR) ?? srgbToOklab(DEFAULT_ANCHOR)!);
  const C = Math.max(0.04, base.C); // keep the family's chroma feel, avoid washing out to gray
  const accepted: Oklab[] = out.map((h) => srgbToOklab(h)!).filter(Boolean) as Oklab[];

  // Candidate grid: lightness spread across a legible band FIRST (primary axis),
  // hue kept in the brand family via small neighbor offsets (secondary).
  const Ls = [0.86, 0.72, 0.58, 0.44, 0.34, 0.8, 0.66, 0.52, 0.4];
  const hueOffsets = [0, 20, -20, 40, -40];
  for (const off of hueOffsets) {
    for (const L of Ls) {
      if (out.length >= count) break;
      const cand = oklchToOklab({ L: clampL(L), C, h: (base.h + off + 360) % 360 });
      if (accepts(cand, accepted, bg)) {
        out.push(oklabToHex(cand));
        accepted.push(cand);
      }
    }
  }
  // Backstop: if the guarded grid under-filled (tiny gamut / near-black anchor), pad with a
  // pure lightness ramp of the base hue so we ALWAYS return `count` (never refuse a chart).
  let r = 1;
  while (out.length < count) {
    const L = clampL(0.3 + 0.6 * (r / (count + 1)));
    out.push(oklabToHex(oklchToOklab({ L, C, h: base.h })));
    r++;
  }
  return out.slice(0, count);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/charts/palette.test.ts`
Expected: PASS. If the lightness-delta test fails for a specific generated pair, tighten `lightSteps`/`clampL` — do NOT loosen `MIN_LIGHTNESS_DELTA` below the documented starting value without noting it.

- [ ] **Step 5: Commit**

```bash
git add lib/charts/palette.ts lib/charts/palette.test.ts
git commit -m "feat(charts): extendPalette — on-brand distinct extra fills"
```

---

## Task 4: readableLabel (real WCAG text-on-fill pick)

**Files:**
- 🔴 Modify: `lib/charts/palette.ts`
- 🔴 Test: `lib/charts/palette.test.ts`

**Interfaces:**
- Consumes: `contrastRatio` from Task 1.
- Produces: `readableLabel(fill: string, opts?: { light?: string; dark?: string }): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { readableLabel, contrastRatio } from "./palette";

test("readableLabel picks the higher-contrast of dark/light", () => {
  // gulf fills are light → dark ink wins (ink ~7.5:1 vs white ~2:1)
  for (const fill of ["#3dc9c0", "#5bc97a", "#d4b370"]) {
    const label = readableLabel(fill);
    expect(contrastRatio(label, fill)).toBeGreaterThan(contrastRatio(label === "#0a2540" ? "#ffffff" : "#0a2540", fill) - 1e-9);
  }
});

test("dark fill → light label", () => {
  expect(readableLabel("#0a2540")).toBe("#ffffff");
});

test("custom light/dark honored", () => {
  const label = readableLabel("#111111", { light: "#eeeeee", dark: "#222222" });
  expect(label).toBe("#eeeeee");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/charts/palette.test.ts`
Expected: FAIL — `readableLabel` not defined.

- [ ] **Step 3: Write minimal implementation** (append to `lib/charts/palette.ts`)

```ts
/**
 * Legible text color on `fill` — the WCAG-2 pick of dark ink vs white, whichever
 * has higher contrast (prefers the one clearing 4.5:1 when both do).
 * WCAG 2, not APCA: APCA is the WCAG-3 candidate but still in development; for a
 * binary ink-vs-white pick the two agree on the winner. Revisit when WCAG 3 ratifies.
 */
export function readableLabel(fill: string, opts?: { light?: string; dark?: string }): string {
  const light = opts?.light ?? "#ffffff";
  const dark = opts?.dark ?? "#0a2540"; // BRAND_INK
  return contrastRatio(dark, fill) >= contrastRatio(light, fill) ? dark : light;
}

export const BRAND_INK = "#0a2540";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/charts/palette.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/charts/palette.ts lib/charts/palette.test.ts
git commit -m "feat(charts): readableLabel — real WCAG text-on-fill pick"
```

---

## Wiring overview (from the code probe, RULE 0.5)

There is **no shared categorical palette** — each renderer hardcodes. The genuinely *categorical* multi-color seams (where "extra fills beyond the brand" happen) are three, and they cover both surfaces:

- **`lib/charts/svg/donut-share.ts` `colorOf` (:127-129)** — the SAME builder backs the chat donut (`DonutShareFrame`) and the email PNG (`spec-to-png.ts`). One edit, both surfaces. White background. Monochromatic today (accent tinted toward white) → becomes on-brand lightness-stepped (call it out).
- **`components/charts/registry/frames/CompositionFrame.tsx` `DEFAULT_COLORS` (:54-88/:98)** — chat composition, **dark** `neutral-900` background (`#171717`). Polychromatic today → on-brand.
- **`lib/email/templates/charts/chart-renderer.ts` `renderStackedBar` (:216/:226)** — email family-B stacked bar; consumes `seg.color` with **no fallback** (renders blank without a color) — a real gap, needs a palette source.

Plus the independent label-legibility fix: the two `readableText` rec601 heuristics → `readableLabel`.

**Out of scope (not categorical):** the value-driven ramps — `SeasonalRadialChart`, `CorridorRentChart`, `CorridorMarketScatter`, `ZGaugeFrame`, heat-row — are sequential/diverging, keyed on a value, not "extra categorical fills." They belong to a future palette-*type*-selection feature (Task C territory), not this helper. The single-accent SVG frames (ranked-delta, dot-plot, line-band, spark-grid, timeline) and semantic tiers (`HBarChart`) are one-color and untouched.

---

## Task 5: Wire the donut (both surfaces) through extendPalette

**Files:**
- Modify: `lib/charts/svg/donut-share.ts:48-59` (delete dead `lighten`), `:127-129` (`colorOf`)
- Test: `lib/charts/svg/donut-share.test.ts`

**Interfaces:**
- Consumes: `extendPalette` (Task 3).

- [ ] **Step 1: Write the failing test** (append to `donut-share.test.ts`)

```ts
import { extendPalette } from "@/lib/charts/palette";

test("donut: uncolored segments get distinct on-brand fills", () => {
  const svg = donutShareSvg(
    [
      { label: "A", value: 40 },
      { label: "B", value: 30 },
      { label: "C", value: 20 },
      { label: "D", value: 10 },
    ],
    { title: "T", accent: "#3dc9c0" },
  );
  // extract every fill="#rrggbb" used on arc paths / legend swatches
  const fills = [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase());
  const seg = extendPalette(["#3dc9c0"], 4, { background: "#ffffff" }).map((c) => c.toLowerCase());
  for (const c of seg) expect(fills).toContain(c);
  expect(new Set(seg).size).toBe(4); // 4 distinct
});

test("donut: explicit segment color still wins", () => {
  const svg = donutShareSvg([{ label: "A", value: 1, color: "#ff0000" }], { title: "T", accent: "#3dc9c0" });
  expect(svg.toLowerCase()).toContain("#ff0000");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/charts/svg/donut-share.test.ts`
Expected: FAIL — colors come from the old tint ramp, not `extendPalette`.

- [ ] **Step 3: Confirm `lighten` has no other users, then edit**

Run: `rg "lighten\(" lib/charts/svg/donut-share.ts` → expect the only call is inside `colorOf`.

Replace `:127-129`:

```ts
  // Resolve a color per segment: explicit segment color wins; else an on-brand,
  // grayscale-distinct extension of the accent. White canvas.
  const generated = extendPalette([accent], rows.length, { background: "#ffffff" });
  const colorOf = (i: number, s: DonutSegment) => s.color ?? generated[i] ?? accent;
```

Delete the now-dead `lighten` helper (`:48-59`). Add the import at the top:

```ts
import { extendPalette } from "@/lib/charts/palette";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/charts/svg/donut-share.test.ts`
Expected: PASS. Also run `bunx tsc --noEmit` scoped check per repo norms to confirm no unused-symbol error from removing `lighten`.

- [ ] **Step 5: Commit**

```bash
git add lib/charts/svg/donut-share.ts lib/charts/svg/donut-share.test.ts
git commit -m "feat(charts): route donut (chat+email) through on-brand extendPalette"
```

---

## Task 6: Wire chat CompositionFrame through a pure color resolver

**Files:**
- Modify: `components/charts/registry/frames/CompositionFrame.tsx:53-61` (`DEFAULT_COLORS`), `:88`, `:98`
- Test: `components/charts/registry/frames/CompositionFrame.test.ts`

**Interfaces:**
- Consumes: `extendPalette` (Task 3), `ChartSpec['theme']`.
- Produces: pure `resolveCompositionColors(segments: { color?: string }[], theme?: ChartTheme): string[]` (exported, DOM-free — matches this repo's "no jsdom" test pattern).

- [ ] **Step 1: Write the failing test** (append to `CompositionFrame.test.ts`)

```ts
import { resolveCompositionColors } from "./CompositionFrame";

describe("resolveCompositionColors", () => {
  it("gives distinct on-brand colors when segments have none", () => {
    const segs = [{}, {}, {}, {}].map(() => ({}));
    const colors = resolveCompositionColors(segs, { accent: "#3dc9c0" });
    expect(colors).toHaveLength(4);
    expect(new Set(colors).size).toBe(4);
  });
  it("honors an explicit segment color", () => {
    const colors = resolveCompositionColors([{ color: "#ff0000" }, {}], { accent: "#3dc9c0" });
    expect(colors[0]).toBe("#ff0000");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test components/charts/registry/frames/CompositionFrame.test.ts`
Expected: FAIL — `resolveCompositionColors` not exported.

- [ ] **Step 3: Add the pure resolver and consume it**

Replace `DEFAULT_COLORS` (`:53-61`) with:

```ts
import { extendPalette } from "@/lib/charts/palette";
import type { ChartTheme } from "../chart-spec";

// CompositionFrame renders on a dark neutral-900 (#171717) canvas.
const COMPOSITION_BG = "#171717";

/** Resolved fill per segment: explicit seg.color wins, else on-brand distinct extras. */
export function resolveCompositionColors(
  segments: { color?: string }[],
  theme?: ChartTheme,
): string[] {
  const anchor = theme?.accent ?? theme?.primary ?? "#3dc9c0";
  const gen = extendPalette([anchor], segments.length, { background: COMPOSITION_BG });
  return segments.map((s, i) => s.color ?? gen[i] ?? anchor);
}
```

In the component body, compute once and index it (`:64` area):

```ts
  const { segments, callout } = extractCompositionData(spec.options ?? {});
  const colors = resolveCompositionColors(segments, spec.theme);
```

Replace `:88` `backgroundColor: seg.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]` → `backgroundColor: colors[i]`, and `:98` `const color = seg.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]` → `const color = colors[i]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test components/charts/registry/frames/CompositionFrame.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/charts/registry/frames/CompositionFrame.tsx components/charts/registry/frames/CompositionFrame.test.ts
git commit -m "feat(charts): CompositionFrame colors via on-brand extendPalette"
```

---

## Task 7: Give email renderStackedBar a palette source

**Files:**
- Modify: `lib/email/templates/charts/chart-renderer.ts:202-231` (`renderStackedBar`)
- Test: `lib/email/templates/charts/chart-renderer.test.ts` (create if absent)

**Interfaces:**
- Consumes: `extendPalette` (Task 3), public `renderChart(spec, theme?)` (`:279`).

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test";
import { renderChart } from "./chart-renderer";
import { extendPalette } from "@/lib/charts/palette";

test("stacked-bar: uncolored segments get distinct on-brand fills", () => {
  const svg = renderChart({
    type: "stacked-bar",
    title: "Share",
    segments: [
      { label: "A", value: 40 },
      { label: "B", value: 35 },
      { label: "C", value: 25 },
    ],
  } as any);
  const gen = extendPalette(["#3DC9C0"], 3, { background: "#ffffff" }).map((c) => c.toLowerCase());
  const lower = svg.toLowerCase();
  for (const c of gen) expect(lower).toContain(c);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/email/templates/charts/chart-renderer.test.ts`
Expected: FAIL — segments render with empty `background:` (no color source).

- [ ] **Step 3: Compute a palette and use it as the fallback**

At the top of `renderStackedBar` (after `:204`), add:

```ts
  const palette = extendPalette([theme.accent], spec.segments.length, { background: "#ffffff" });
```

Change `:216` `background:${esc(seg.color)}` → `background:${esc(seg.color ?? palette[i])}` and `:226` `background:${esc(seg.color)}` → `background:${esc(seg.color ?? palette[i])}` (the legend `.map` must expose its index — use `(seg, i)`).

Add the import:

```ts
import { extendPalette } from "@/lib/charts/palette";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/email/templates/charts/chart-renderer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates/charts/chart-renderer.ts lib/email/templates/charts/chart-renderer.test.ts
git commit -m "feat(charts): stacked-bar email chart gets on-brand palette fallback"
```

---

## Task 8: Replace the two rec601 readableText heuristics with real WCAG readableLabel

**Files:**
- Modify: `lib/email/templates/components/_shared.ts:51-61`, `lib/email/templates/charts/chart-renderer.ts:97-102`
- Test: `lib/email/templates/components/_shared.test.ts` (create if absent)

**Interfaces:**
- Consumes: `readableLabel` (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test";
import { readableText } from "./_shared";

// On a mid-light fill where rec601 luma and real WCAG disagree, the WCAG pick must win.
test("readableText delegates to WCAG readableLabel (dark #111827 preserved)", () => {
  expect(readableText("#ffffff")).toBe("#111827"); // white bg → dark text
  expect(readableText("#000000")).toBe("#ffffff"); // black bg → white text
});
```

- [ ] **Step 2: Run test to verify it fails / passes trivially**

Run: `bun test lib/email/templates/components/_shared.test.ts`
Expected: PASS on the two extremes even before the change (they agree); this test locks behavior. The real change is internal (rec601 → WCAG) — verify no regression.

- [ ] **Step 3: Delegate both `readableText` to `readableLabel`**

In `_shared.ts` (`:55`), replace the body:

```ts
import { readableLabel } from "@/lib/charts/palette";

/** Dark (#111827) or white text, whichever has real WCAG contrast on `bg`. */
export function readableText(bg: string): string {
  return readableLabel(bg, { dark: "#111827", light: "#ffffff" });
}
```

In `chart-renderer.ts` (`:97-102`), replace the internal `readableText` the same way (keep it internal, delegate to `readableLabel` with `{ dark: "#111827" }`), and add the import.

- [ ] **Step 4: Run test + audit the affected surfaces**

Run: `bun test lib/email/templates/components/_shared.test.ts lib/email/templates/charts/chart-renderer.test.ts`
Expected: PASS. Manually diff-audit the two consumers that pick label color on a colored fill — heat-row cells (`chart-renderer.ts:261`) and the badge (`badge.ts:8`) — confirm the label color only changes where rec601 was actually wrong.

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates/components/_shared.ts lib/email/templates/charts/chart-renderer.ts lib/email/templates/components/_shared.test.ts
git commit -m "fix(charts): real WCAG label contrast, replacing rec601 readableText"
```

---

## Self-Review

**Spec coverage:** `relativeLuminance`/`contrastRatio` (T1) · OKLab/OKLCH + distance (T2) · `extendPalette` with hue+lightness variation, distinctness+lightness+visibility guards, caps, graceful fallback (T3) · `readableLabel` WCAG-2-not-APCA (T4) · wiring both surfaces at the categorical seams — donut both-surfaces (T5), composition (T6), stacked-bar (T7) — and the readableText swap (T8). Spec's "never blocks a send / never recolors a brand / never touches images": honored — anchors pass through verbatim, only generated extras are shaped, no image code touched. Caps `SOFT_MAX_CATEGORICAL=6`/`HARD_MAX_CATEGORICAL=10` exported (T3). ✔ All spec sections have a task.

**Placeholder scan:** no TBD/TODO; every code step shows real code with verbatim matrix constants. ✔

**Type consistency:** `Oklab`/`Oklch` defined T2, used consistently T2/T3. `extendPalette(anchors, count, {background})` signature identical across T3/T5/T6/T7. `readableLabel(fill, {light,dark})` identical T4/T8. `resolveCompositionColors` defined+consumed T6. ✔

**Known follow-ups (out of scope, logged not silently dropped):** the value-driven sequential/diverging ramps and the latent `chart-image.ts barChartSvg.series` seam are deferred to the palette-type-selection feature (Task C). The `MIN_OKLAB_DISTANCE`/`MIN_LIGHTNESS_DELTA` starting values (0.1 / 0.11) are tunable; T3's tests are the floor — if a generated pair looks too close in a real render, tighten the candidate grid, don't loosen the guard silently.

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 1, Task 2, Task 3, Task 4 | `lib/charts/palette.ts`, `lib/charts/palette.test.ts` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
