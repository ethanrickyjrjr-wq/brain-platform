// Wave-2 (brand-tokens-one-root): the canvas reads 8 brand slots from the SAME
// branding record email reads — fonts resolve through the one registry, the
// hardcoded Arial const is gone, and dark templates paint the brand's dark
// surface (default identical to the old primary default, so unbranded output
// is unchanged).
import { describe, expect, test } from "bun:test";
import { tokensFromBranding, SOCIAL_TEMPLATES } from "../templates";
import { BRAND_FONTS } from "@/lib/brand/fonts";

describe("tokensFromBranding — 8 slots", () => {
  test("defaults: sand surfaces + Modern Sans stacks, never the Arial literal", () => {
    const tk = tokensFromBranding({});
    expect(tk.surface).toBe("#f0ede6");
    expect(tk.surfaceDark).toBe("#0f1d24");
    expect(tk.fontDisplay).toBe(BRAND_FONTS.MODERN_SANS.previewStack);
    expect(tk.fontBody).toBe(BRAND_FONTS.MODERN_SANS.previewStack);
  });

  test("brand tokens resolve to preview stacks + hex", () => {
    const tk = tokensFromBranding({
      FONT_DISPLAY: "PLAYFAIR_SERIF",
      FONT_BODY: "LATO_SANS",
      SURFACE: "#ffffff",
      SURFACE_DARK: "#101010",
    });
    expect(tk.fontDisplay).toBe(BRAND_FONTS.PLAYFAIR_SERIF.previewStack);
    expect(tk.fontBody).toBe(BRAND_FONTS.LATO_SANS.previewStack);
    expect(tk.surfaceDark).toBe("#101010");
  });

  test("an unknown FONT_* token falls back to the default stack, never raw text", () => {
    const tk = tokensFromBranding({ FONT_DISPLAY: "Comic Sans MS" });
    expect(tk.fontDisplay).toBe(BRAND_FONTS.MODERN_SANS.previewStack);
  });

  test("no template element carries a bare-Arial font, and ids are stable", () => {
    const tk = tokensFromBranding({ FONT_DISPLAY: "BOOK_SERIF" });
    for (const t of SOCIAL_TEMPLATES) {
      for (const fmt of t.formats) {
        const d = t.build(tk, fmt);
        for (const el of d.elements) {
          if ("fontFamily" in el) expect(el.fontFamily).not.toBe("Arial");
          expect(el.id).toMatch(/^[a-z][a-z0-9-]*[0-9]?$/);
        }
      }
    }
  });

  test("headline/kicker take the display stack; subhead takes the body stack", () => {
    const tk = tokensFromBranding({ FONT_DISPLAY: "PLAYFAIR_SERIF", FONT_BODY: "LATO_SANS" });
    const headlineCta = SOCIAL_TEMPLATES.find((t) => t.id === "headline-cta")!;
    const d = headlineCta.build(tk, "square");
    const byId = Object.fromEntries(d.elements.map((e) => [e.id, e]));
    expect((byId.headline as { fontFamily: string }).fontFamily).toBe(
      BRAND_FONTS.PLAYFAIR_SERIF.previewStack,
    );
    expect((byId.subhead as { fontFamily: string }).fontFamily).toBe(
      BRAND_FONTS.LATO_SANS.previewStack,
    );
  });

  test("dark templates background = surfaceDark (default identical to old primary default)", () => {
    const d = SOCIAL_TEMPLATES[0].build(tokensFromBranding({}), SOCIAL_TEMPLATES[0].formats[0]);
    expect(d.background).toBe("#0f1d24");
    const branded = SOCIAL_TEMPLATES[0].build(
      tokensFromBranding({ SURFACE_DARK: "#101010" }),
      SOCIAL_TEMPLATES[0].formats[0],
    );
    expect(branded.background).toBe("#101010");
  });
});
