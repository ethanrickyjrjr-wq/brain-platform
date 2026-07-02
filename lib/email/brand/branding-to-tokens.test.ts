import { describe, expect, test } from "bun:test";
import { brandingToTokens } from "./branding-to-tokens";

describe("brandingToTokens — wave-2 font + surface slots", () => {
  test("valid font keys and surface colors map through", () => {
    const t = brandingToTokens({
      font_display: "PLAYFAIR_SERIF",
      font_body: "LATO_SANS",
      surface_color: "#f0ede6",
      surface_dark_color: "#0f1d24",
    });
    expect(t.FONT_DISPLAY).toBe("PLAYFAIR_SERIF");
    expect(t.FONT_BODY).toBe("LATO_SANS");
    expect(t.SURFACE).toBe("#f0ede6");
    expect(t.SURFACE_DARK).toBe("#0f1d24");
  });

  test("an unknown font key is SKIPPED — no user text becomes CSS", () => {
    const t = brandingToTokens({ font_display: "Comic Sans MS, cursive" });
    expect(t.FONT_DISPLAY).toBeUndefined();
  });

  test("absent fields emit no tokens (existing behavior preserved)", () => {
    const t = brandingToTokens({ primary_color: "#111111" });
    expect(t.PRIMARY).toBe("#111111");
    expect(t.FONT_DISPLAY).toBeUndefined();
    expect(t.SURFACE).toBeUndefined();
  });
});
