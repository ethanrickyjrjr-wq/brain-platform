import { describe, expect, test } from "bun:test";
import { brandGlobalStyle } from "./apply-brand-style";
import type { EmailGlobalStyle } from "@/lib/email/doc/types";

const BASE: EmailGlobalStyle = {
  primaryColor: "#0f1d24",
  accentColor: "#3DC9C0",
  fontFamily: "MODERN_SANS",
  textColor: "#242424",
  backdropColor: "#F8F8F8",
};

describe("brandGlobalStyle", () => {
  test("maps all wave-2 tokens onto globalStyle", () => {
    const gs = brandGlobalStyle(BASE, {
      PRIMARY: "#111111",
      FONT_BODY: "LATO_SANS",
      FONT_DISPLAY: "PLAYFAIR_SERIF",
      SURFACE: "#f0ede6",
      SURFACE_DARK: "#0f1d24",
    });
    expect(gs.primaryColor).toBe("#111111");
    expect(gs.fontFamily).toBe("LATO_SANS");
    expect(gs.displayFontFamily).toBe("PLAYFAIR_SERIF");
    expect(gs.surfaceColor).toBe("#f0ede6");
    expect(gs.surfaceDarkColor).toBe("#0f1d24");
  });

  test("absent tokens leave every field untouched (today's behavior)", () => {
    expect(brandGlobalStyle(BASE, {})).toEqual(BASE);
  });

  test("an invalid FONT_* token value is ignored, never applied", () => {
    const gs = brandGlobalStyle(BASE, { FONT_BODY: "papyrus" });
    expect(gs.fontFamily).toBe("MODERN_SANS");
  });
});
