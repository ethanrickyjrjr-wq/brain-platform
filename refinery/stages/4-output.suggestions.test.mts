import { test, expect } from "bun:test";
import { suggestionsForMetric } from "../lib/suggestion-rules.mts";

test("a numeric metric gets 2-3 suggestions incl. one cross-area compare", () => {
  const s = suggestionsForMetric({ metric: "median_price", value: "$525,000" }, "housing-swfl");
  expect(s.length).toBeGreaterThanOrEqual(2);
  expect(s.some((q) => /compare|vs\.|other/i.test(q))).toBe(true);
});

test("non-housing slug with chart-routable metric returns 3 suggestions (chart chip + 2)", () => {
  const s = suggestionsForMetric({ metric: "vacancy_rate", value: "8.2%" }, "cre-swfl");
  // vacancy_rate triggers a chart chip — total 3: chart + driving + compare
  expect(s.length).toBe(3);
  expect(s[0]).toMatch(/Chart/i);
  expect(s.some((q) => /compare|vs\.|other/i.test(q))).toBe(true);
});

test("housing-swfl slug returns exactly 3 suggestions", () => {
  const s = suggestionsForMetric({ metric: "median_price", value: 525000 }, "housing-swfl");
  expect(s.length).toBe(3);
  expect(s[2]).toMatch(/flood risk/i);
});

test("underscores in metric name are replaced with spaces in suggestions", () => {
  const s = suggestionsForMetric({ metric: "months_of_supply", value: 3.2 }, "housing-swfl");
  expect(s[0]).toContain("months of supply");
});
