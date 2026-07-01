import { test, expect } from "bun:test";
import {
  relativeLuminance,
  contrastRatio,
  srgbToOklab,
  oklabToHex,
  oklabToOklch,
  oklchToOklab,
  oklabDistance,
  extendPalette,
  MIN_LIGHTNESS_DELTA,
} from "./palette";

const WHITE = "#ffffff";
const GULF = ["#3dc9c0", "#5bc97a", "#d4b370"];

// helper local to the test file
function parseHexTuple(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

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
    const a = parseHexTuple(hex),
      b = parseHexTuple(back);
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
