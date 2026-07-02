import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { BRAND_FONTS, CANVAS_FONT_FILES, CANVAS_DEFAULT_FAMILY, isFontFamily } from "./fonts";
import { fontStack, WEB_FONT_URLS } from "@/lib/email/blocks/styles";
import { FONT_ROUTING } from "@/lib/email/lab/capabilities";
import type { FontFamily } from "@/lib/email/doc/types";

const FAMILIES: FontFamily[] = [
  "MODERN_SANS",
  "BOOK_SERIF",
  "GEOMETRIC_SANS",
  "PLAYFAIR_SERIF",
  "LATO_SANS",
  "MONTSERRAT_SANS",
];

describe("brand font registry — the one root", () => {
  test("every FontFamily has a complete registry entry", () => {
    for (const f of FAMILIES) {
      const e = BRAND_FONTS[f];
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.stack).toContain(","); // a real fallback stack, never a lone family
      expect(["Helvetica", "Times-Roman"]).toContain(e.pdf);
      expect(["Liberation Sans", "Liberation Serif"]).toContain(e.canvasSvg);
      expect(e.previewStack).toContain(",");
    }
  });

  test("serif families map to serif everywhere; sans to sans", () => {
    for (const f of ["BOOK_SERIF", "PLAYFAIR_SERIF"] as FontFamily[]) {
      expect(BRAND_FONTS[f].pdf).toBe("Times-Roman");
      expect(BRAND_FONTS[f].canvasSvg).toBe("Liberation Serif");
    }
    for (const f of [
      "MODERN_SANS",
      "GEOMETRIC_SANS",
      "LATO_SANS",
      "MONTSERRAT_SANS",
    ] as FontFamily[]) {
      expect(BRAND_FONTS[f].pdf).toBe("Helvetica");
      expect(BRAND_FONTS[f].canvasSvg).toBe("Liberation Sans");
    }
  });

  test("every registry family is tier-routed (and vice versa — same keys)", () => {
    expect(Object.keys(BRAND_FONTS).sort()).toEqual(Object.keys(FONT_ROUTING).sort());
  });

  test("all canvas TTFs exist on disk (sans + serif, regular + bold)", () => {
    expect(CANVAS_FONT_FILES.length).toBe(4);
    for (const p of CANVAS_FONT_FILES) expect(existsSync(p)).toBe(true);
  });

  test("default canvas family is the bundled sans", () => {
    expect(CANVAS_DEFAULT_FAMILY).toBe("Liberation Sans");
  });

  test("isFontFamily guards unknown keys", () => {
    expect(isFontFamily("BOOK_SERIF")).toBe(true);
    expect(isFontFamily("COMIC_SANS")).toBe(false);
    expect(isFontFamily("")).toBe(false);
  });
});

describe("existing resolvers read the registry", () => {
  test("fontStack === registry stack for every family", () => {
    for (const f of FAMILIES) expect(fontStack(f)).toBe(BRAND_FONTS[f].stack);
  });
  test("WEB_FONT_URLS mirrors registry webfontUrl exactly (incl. absence)", () => {
    for (const f of FAMILIES) expect(WEB_FONT_URLS[f]).toBe(BRAND_FONTS[f].webfontUrl);
  });
});
