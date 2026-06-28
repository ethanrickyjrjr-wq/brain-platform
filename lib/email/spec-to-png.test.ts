import { test, expect } from "bun:test";
import { chartImageCaption } from "./spec-to-png";

// Rule 2: an as-of date is written MM/DD/YYYY, never the raw ISO/SWFL token. The chart
// SVG already obeys this; the email image-block caption (the line UNDER the chart) was
// leaking the raw ISO. These pin the caption builder to the same rule.

test("chart image caption renders as-of as MM/DD/YYYY, never the raw ISO (Rule 2)", () => {
  const cap = chartImageCaption({
    title: "SWFL Home Values (ZHVI)",
    source: { citation: "Zillow Home Value Index (ZHVI)" },
    asOf: "2026-04-30",
  });
  expect(cap).toContain("04/30/2026");
  expect(cap).not.toContain("2026-04-30");
  expect(cap).toContain("SWFL Home Values (ZHVI) — Zillow Home Value Index (ZHVI)");
});

test("chart image caption omits the as-of clause when no date", () => {
  const cap = chartImageCaption({ title: "Market data", source: { citation: "cre-swfl" } });
  expect(cap).toBe("Market data — cre-swfl");
});

test("chart image caption falls back to a default title", () => {
  expect(chartImageCaption({})).toBe("Market data");
});
