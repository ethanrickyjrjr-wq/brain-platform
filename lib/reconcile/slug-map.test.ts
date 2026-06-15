import { test, expect } from "bun:test";
import { resolveMetricSlug } from "./slug-map";

const metrics = [
  { metric: "median_sale_price", label: "Median sale price" },
  { metric: "days_on_market", label: "Days on market" },
];

test("an exact label (case/space-insensitive) resolves to its slug", () => {
  expect(resolveMetricSlug("housing-swfl", "median sale price", metrics)).toBe("median_sale_price");
  expect(resolveMetricSlug("housing-swfl", "  Median  Sale Price ", metrics)).toBe(
    "median_sale_price",
  );
});

test("an unknown label resolves to null — never guess", () => {
  expect(resolveMetricSlug("housing-swfl", "list-to-sale ratio", metrics)).toBeNull();
});

test("two metrics sharing a normalized label → null (ambiguous, never guess)", () => {
  const dupe = [
    { metric: "price_a", label: "Median price" },
    { metric: "price_b", label: "median  price" },
  ];
  expect(resolveMetricSlug("x", "Median price", dupe)).toBeNull();
});

test("empty brain metrics → null", () => {
  expect(resolveMetricSlug("x", "Median sale price", [])).toBeNull();
});
