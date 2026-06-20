import { test, expect } from "bun:test";
import type { SignificantChange } from "@/lib/signals/types";
import { collisionChipText } from "./collision-copy";

const change: SignificantChange = {
  slug: "mortgage_rate",
  item_id: "i1",
  label: "30-yr rate",
  previous_value: "6.8%",
  current_value: "7.3%",
  delta_description: "rose 7.4%",
  signal_strength: 2,
  impact_weight: 8,
  priority: 16,
};

test("states both numbers, never asserts the user is wrong", () => {
  const t = collisionChipText(change);
  expect(t).toContain("7.3%");
  expect(t).toContain("6.8%");
  expect(t).toContain("your number stays");
  expect(t.toLowerCase()).not.toContain("correct value");
  expect(t.toLowerCase()).not.toContain("wrong");
});
