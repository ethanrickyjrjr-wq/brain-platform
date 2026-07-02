// lib/email/lab/canvas-pref.test.ts
import { describe, expect, test } from "bun:test";
import { emailCanvasPref, nextCanvasAfterChoice } from "./canvas-pref";

describe("emailCanvasPref (ui_state.email_canvas round-trip)", () => {
  test("absent / null uiState → grid (the default canvas)", () => {
    expect(emailCanvasPref(undefined)).toBe("grid");
    expect(emailCanvasPref(null)).toBe("grid");
    expect(emailCanvasPref({})).toBe("grid");
  });
  test("stored block preference honored", () => {
    expect(emailCanvasPref({ email_canvas: "block" })).toBe("block");
  });
  test("junk value → grid", () => {
    expect(emailCanvasPref({ email_canvas: "classic" })).toBe("grid");
    expect(emailCanvasPref({ email_canvas: 42 })).toBe("grid");
  });
});

describe("nextCanvasAfterChoice (unsaved-toggle dialog paths)", () => {
  test("save and discard both switch", () => {
    expect(nextCanvasAfterChoice("grid", "save")).toBe("block");
    expect(nextCanvasAfterChoice("grid", "discard")).toBe("block");
    expect(nextCanvasAfterChoice("block", "save")).toBe("grid");
  });
  test("cancel stays", () => {
    expect(nextCanvasAfterChoice("grid", "cancel")).toBe("grid");
    expect(nextCanvasAfterChoice("block", "cancel")).toBe("block");
  });
});
