/**
 * Tests for applyRefresh — focused on Phase F "A": a confirmed value is never
 * overwritten by a newer brain value, while an unconfirmed item still refreshes.
 */

import { test, expect } from "bun:test";
import { applyRefresh, refreshKey, type BrainValueMap } from "./refresh-on-access";
import type { ProjectItem } from "./items";

function metricItem(overrides: Partial<Extract<ProjectItem, { kind: "metric" }>> = {}): ProjectItem {
  return {
    kind: "metric",
    id: "i1",
    added_at: "2026-06-01T00:00:00Z",
    origin: "web",
    report_id: "master",
    label: "Median sale price YoY",
    value: "6.8%",
    // Filed on the 1st; the brain map below carries a NEWER (19th) token.
    freshness_token: "SWFL-7421-v4-20260601",
    metric_slug: "median_sale_price_yoy",
    scope_kind: "zip",
    scope_value: "33931",
    ...overrides,
  };
}

// Brain map keyed exactly as the refresh logic keys it, carrying a newer value + token.
function brainMap(item: Extract<ProjectItem, { kind: "metric" }>): BrainValueMap {
  return {
    [refreshKey(item.report_id, item.metric_slug ?? item.label, item.scope_value)]: {
      value: "7.7%",
      freshness_token: "SWFL-7421-v5-20260619",
    },
  };
}

test("confirmed metric is not overwritten by a newer brain value", () => {
  const item = metricItem();
  const brainValues = brainMap(item as Extract<ProjectItem, { kind: "metric" }>);

  const result = applyRefresh([item], brainValues, { i1: "6.8%" });

  expect(result.refreshed).toBe(0);
  const out = result.items[0] as Extract<ProjectItem, { kind: "metric" }>;
  expect(out.value).toBe("6.8%");
  expect(out.freshness_token).toBe("SWFL-7421-v4-20260601");
});

test("unconfirmed metric is overwritten by the newer brain value", () => {
  const item = metricItem();
  const brainValues = brainMap(item as Extract<ProjectItem, { kind: "metric" }>);

  const result = applyRefresh([item], brainValues, {});

  expect(result.refreshed).toBe(1);
  const out = result.items[0] as Extract<ProjectItem, { kind: "metric" }>;
  expect(out.value).toBe("7.7%");
  expect(out.freshness_token).toBe("SWFL-7421-v5-20260619");
});
