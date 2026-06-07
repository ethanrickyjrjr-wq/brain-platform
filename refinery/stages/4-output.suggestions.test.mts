import { test, expect } from "bun:test";
import { suggestionsForMetric } from "./4-output.mts";

test("a numeric metric gets 2-3 suggestions incl. one cross-area compare", () => {
  const s = suggestionsForMetric(
    { metric: "median_price", value: "$525,000" } as any,
    "housing-swfl",
  );
  expect(s.length).toBeGreaterThanOrEqual(2);
  expect(s.some((q) => /compare|vs\.|other/i.test(q))).toBe(true);
});

test("non-housing slug returns exactly 2 suggestions", () => {
  const s = suggestionsForMetric(
    { metric: "vacancy_rate", value: "8.2%" } as any,
    "cre-swfl",
  );
  expect(s.length).toBe(2);
  expect(s.some((q) => /compare|vs\.|other/i.test(q))).toBe(true);
});

test("housing-swfl slug returns exactly 3 suggestions", () => {
  const s = suggestionsForMetric(
    { metric: "median_price", value: 525000 } as any,
    "housing-swfl",
  );
  expect(s.length).toBe(3);
  expect(s[2]).toMatch(/flood risk/i);
});

test("underscores in metric name are replaced with spaces in suggestions", () => {
  const s = suggestionsForMetric(
    { metric: "months_of_supply", value: 3.2 } as any,
    "housing-swfl",
  );
  expect(s[0]).toContain("months of supply");
});
