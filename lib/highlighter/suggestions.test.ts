import { test, expect } from "bun:test";
import {
  suggestionsForMetric,
  suggestionsForSpan,
  suggestionsForSelection,
  isFreshnessToken,
  isLikelyDate,
} from "./suggestions";
import { resolveMethod } from "../../refinery/lib/methodology-registry.mts";

test("returns at least two suggestions", () => {
  const out = suggestionsForMetric({ metric: "median_sale_price", value: "$525,000" }, "cre-swfl");
  expect(out.length).toBeGreaterThanOrEqual(2);
});

test("one suggestion invites a comparison", () => {
  const out = suggestionsForMetric({ metric: "median_sale_price", value: "$525,000" }, "cre-swfl");
  expect(out.some((s) => /compare|other|vs\./i.test(s))).toBe(true);
});

test("humanizes the metric name (underscores → spaces)", () => {
  const out = suggestionsForMetric({ metric: "cap_rate", value: "6.2%" }, "cre-swfl");
  expect(out[0]).toContain("cap rate");
});

test("housing-swfl gets a third flood-risk suggestion", () => {
  const out = suggestionsForMetric(
    { metric: "median_sale_price", value: "$525,000" },
    "housing-swfl",
  );
  expect(out.length).toBe(3);
  expect(out.some((s) => /flood/i.test(s))).toBe(true);
});

test("value span => break down the figure, no definitional chip", () => {
  const c = suggestionsForSpan({ entry: resolveMethod("asking_rent_psf_median"), value: "$27.51" });
  expect(c[0]).toBe("Break down the $27.51");
  expect(c.some((s) => /^what is/i.test(s))).toBe(false);
});

test("need-component surfaces a find action", () => {
  const c = suggestionsForSpan({
    entry: resolveMethod("asking_rent_nnn_marketbeat_marco_island"),
    value: "$27.9",
    place: "Marco Island",
  });
  expect(c.some((s) => /^Find Marco Island's/.test(s))).toBe(true);
});

test("freshness token is detected", () => {
  expect(isFreshnessToken("SWFL-7421-v5-20260607")).toBe(true);
  expect(isFreshnessToken("$525,000")).toBe(false);
  expect(isFreshnessToken("Lee County")).toBe(false);
});

test("freshness-token selection never gets a 'what's driving' chip", () => {
  const c = suggestionsForSelection("SWFL-7421-v5-20260607", "place");
  expect(c.some((s) => /driving/i.test(s))).toBe(false);
  expect(c.some((s) => /fresh|current/i.test(s))).toBe(true);
});

test("place selection asks about the place, not 'what's driving' it", () => {
  const c = suggestionsForSelection("Lee County", "place");
  expect(c.some((s) => /driving/i.test(s))).toBe(false);
  expect(c.some((s) => /Lee County/.test(s))).toBe(true);
});

test("a date/year is detected and never gets a 'what's driving' chip", () => {
  expect(isLikelyDate("2026-06-09")).toBe(true);
  expect(isLikelyDate("06/09/2026")).toBe(true);
  expect(isLikelyDate("2026")).toBe(true);
  expect(isLikelyDate("$525,000")).toBe(false);
  expect(isLikelyDate("22.29")).toBe(false);
  // classifyFact treats a date as "metric" (digits); the date guard must win.
  const c = suggestionsForSelection("2026-06-09", "metric");
  expect(c.some((s) => /driving/i.test(s))).toBe(false);
  expect(c.some((s) => /current|updated/i.test(s))).toBe(true);
});
