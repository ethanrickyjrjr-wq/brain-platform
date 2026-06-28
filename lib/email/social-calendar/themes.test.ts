import { test, expect } from "bun:test";
import { DAY_THEMES } from "./themes";

const VALID_CARD_BLOCKS = new Set([
  "hero",
  "stats",
  "signal",
  "text",
  "image",
  "agent-card",
  "agent-hero",
  "social-icons",
  "button",
  "divider",
]);

test("there are exactly 5 themes in Mon–Fri order", () => {
  expect(DAY_THEMES.map((t) => t.day)).toEqual(["mon", "tue", "wed", "thu", "fri"]);
});

test("every theme has a label, a non-empty addendum, and >=1 card block", () => {
  for (const t of DAY_THEMES) {
    expect(t.label.length).toBeGreaterThan(0);
    expect(t.systemAddendum.trim().length).toBeGreaterThan(0);
    expect(t.cardBlocks.length).toBeGreaterThan(0);
  }
});

test("no card uses a header or footer block, and every block type is valid", () => {
  for (const t of DAY_THEMES) {
    for (const b of t.cardBlocks) {
      expect(b).not.toBe("header");
      expect(b).not.toBe("footer");
      expect(VALID_CARD_BLOCKS.has(b)).toBe(true);
    }
  }
});
