// lib/email/doc/grid-layouts.test.ts
import { describe, expect, test } from "bun:test";
import { ensureGridLayouts, hasGridLayouts } from "./grid-layouts";
import { GRID_COLS } from "@/lib/email/grid-schema";
import type { EmailDoc } from "./types";

function doc(blocks: EmailDoc["blocks"]): EmailDoc {
  return { globalStyle: { fontFamily: "MODERN_SANS" }, blocks } as EmailDoc;
}
const bare = (id: string, type: string) => ({ id, type, props: {} }) as EmailDoc["blocks"][number];
const laid = (id: string, type: string, y: number, h: number) =>
  ({ id, type, props: {}, layout: { x: 0, y, w: GRID_COLS, h } }) as EmailDoc["blocks"][number];

describe("hasGridLayouts", () => {
  test("true when every block has a layout", () => {
    expect(hasGridLayouts(doc([laid("a", "hero", 0, 4)]))).toBe(true);
  });
  test("false when any block lacks one", () => {
    expect(hasGridLayouts(doc([laid("a", "hero", 0, 4), bare("b", "text")]))).toBe(false);
  });
});

describe("ensureGridLayouts", () => {
  test("fully-laid doc returned unchanged (same reference)", () => {
    const d = doc([laid("a", "hero", 0, 4)]);
    expect(ensureGridLayouts(d)).toBe(d);
  });
  test("stacks layout-less blocks full-width under existing content", () => {
    const d = doc([laid("a", "hero", 0, 4), bare("b", "text"), bare("c", "text")]);
    const out = ensureGridLayouts(d, { text: 3 });
    expect(out.blocks[1]!.layout).toEqual({ x: 0, y: 4, w: GRID_COLS, h: 3 });
    expect(out.blocks[2]!.layout).toEqual({ x: 0, y: 7, w: GRID_COLS, h: 3 });
  });
  test("unknown type falls back to h=4", () => {
    const out = ensureGridLayouts(doc([bare("a", "mystery")]));
    expect(out.blocks[0]!.layout).toEqual({ x: 0, y: 0, w: GRID_COLS, h: 4 });
  });
});
