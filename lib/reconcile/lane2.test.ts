import { test, expect } from "bun:test";
import { toAssertion } from "./lane2";
import type { ProjectItem } from "../project/items";

const base = { id: "i1", added_at: "2026-06-10T00:00:00Z", origin: "mcp" as const };

test("a metric item → a populated assertion (origin sourced from the base)", () => {
  const item: ProjectItem = {
    ...base,
    kind: "metric",
    report_id: "housing-swfl",
    label: "Median sale price",
    value: "362000",
    freshness_token: "SWFL-7421-v5-20260610",
    source_url: "https://www.swfldatagulf.com/r/housing-swfl",
  };
  const a = toAssertion(item);
  expect(a).not.toBeNull();
  expect(a!.report_id).toBe("housing-swfl");
  expect(a!.label).toBe("Median sale price");
  expect(a!.value).toBe("362000");
  expect(a!.freshness_token).toBe("SWFL-7421-v5-20260610");
  expect(a!.source_url).toBe("https://www.swfldatagulf.com/r/housing-swfl");
  expect(a!.origin).toBe("mcp");
  expect(a!.metric_slug).toBeUndefined();
});

test("an item's metric_slug rides into the assertion when set", () => {
  const item: ProjectItem = {
    ...base,
    origin: "web",
    kind: "metric",
    report_id: "housing-swfl",
    label: "Median sale price",
    value: "362000",
    freshness_token: "SWFL-7421-v5-20260610",
    metric_slug: "median_sale_price",
  };
  const a = toAssertion(item);
  expect(a!.metric_slug).toBe("median_sale_price");
  expect(a!.origin).toBe("web");
});

test("a note item → null (no freshness token to assert)", () => {
  const item: ProjectItem = { ...base, kind: "note", text: "remember this" };
  expect(toAssertion(item)).toBeNull();
});

test("a source item → null", () => {
  const item: ProjectItem = {
    ...base,
    kind: "source",
    table: "data_lake.housing",
    url: "https://example.com",
    label: "Source",
  };
  expect(toAssertion(item)).toBeNull();
});
