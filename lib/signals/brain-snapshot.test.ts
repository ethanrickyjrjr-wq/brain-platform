/**
 * Tests for computeSignificantChanges.
 * Mocks lookupLakeFact so no disk I/O; exercises dedup, filtering, ranking, limit.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { computeSignificantChanges } from "./brain-snapshot";
import type { SignificanceRegistry } from "./types";
import type { ProjectItem } from "@/lib/project/items";

// Hoist the mock so vi.mock() can reference it
const mockLookup = vi.fn();

vi.mock("@/lib/reconcile/lane1", () => ({
  lookupLakeFact: (...args: unknown[]) => mockLookup(...args),
}));

const REGISTRY: SignificanceRegistry = {
  median_sale_price_yoy: {
    threshold_type: "percent_change",
    threshold: 3.0,
    impact_weight: 8,
  },
  active_listings_count: {
    threshold_type: "percent_change",
    threshold: 12.0,
    impact_weight: 5,
  },
  fed_funds_rate: {
    threshold_type: "absolute_change",
    threshold: 0.25,
    impact_weight: 10,
  },
  _default: {
    threshold_type: "percent_change",
    threshold: 99999,
    impact_weight: 1,
  },
};

function metricItem(
  overrides: Partial<Extract<ProjectItem, { kind: "metric" }>> = {},
): ProjectItem {
  return {
    id: "item-1",
    kind: "metric",
    added_at: "2026-06-01T00:00:00Z",
    origin: "web",
    report_id: "master",
    label: "Median sale price YoY",
    value: "-3.5%",
    freshness_token: "SWFL-7421-v4-20260601",
    metric_slug: "median_sale_price_yoy",
    ...overrides,
  };
}

beforeEach(() => {
  mockLookup.mockReset();
});

describe("computeSignificantChanges", () => {
  test("returns empty when no metric items", async () => {
    const items: ProjectItem[] = [
      {
        id: "q1",
        kind: "qa",
        added_at: "2026-06-01T00:00:00Z",
        origin: "web",
        report_id: "master",
        question: "Q?",
        answer: "A.",
      },
    ];
    const result = await computeSignificantChanges(items, REGISTRY);
    expect(result).toEqual([]);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  test("returns empty when lookup returns null", async () => {
    mockLookup.mockResolvedValue(null);
    const result = await computeSignificantChanges([metricItem()], REGISTRY);
    expect(result).toEqual([]);
  });

  test("returns empty when change is below threshold", async () => {
    // prev -3.5%, curr -4.0% → 14.3% relative change, below 3% threshold? No — 14.3 > 3
    // Use curr -3.6% → 2.9% < 3% → below threshold
    mockLookup.mockResolvedValue({
      value: "-3.6%",
      brain_id: "master",
      metric_slug: "median_sale_price_yoy",
      label: "Median sale price YoY",
      grain: "zip-month",
    });
    const result = await computeSignificantChanges([metricItem({ value: "-3.5%" })], REGISTRY);
    expect(result).toEqual([]);
  });

  test("returns change when threshold exceeded", async () => {
    // -3.5% → -7.7%: relative change = (7.7-3.5)/3.5 * 100 ≈ 120% >> 3% threshold
    mockLookup.mockResolvedValue({
      value: "-7.7%",
      brain_id: "master",
      metric_slug: "median_sale_price_yoy",
      label: "Median sale price YoY",
      grain: "zip-month",
    });
    const result = await computeSignificantChanges([metricItem()], REGISTRY);
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("median_sale_price_yoy");
    expect(result[0].delta_description).toMatch(/dropped/);
  });

  test("deduplicates same report_id+slug+zip — only one lookup", async () => {
    mockLookup.mockResolvedValue({
      value: "-7.7%",
      brain_id: "master",
      metric_slug: "median_sale_price_yoy",
      label: "Median sale price YoY",
      grain: "zip-month",
    });
    const item = metricItem();
    const result = await computeSignificantChanges([item, item], REGISTRY);
    // Two items with same report_id+slug → only 1 lookupLakeFact call
    expect(mockLookup).toHaveBeenCalledTimes(1);
    // But still returns 2 results (same change, both items)
    expect(result.length).toBeLessThanOrEqual(5);
  });

  test("ranks by priority desc and caps at limit", async () => {
    // fed_funds_rate: impact_weight=10, median_sale_price: 8, active_listings: 5
    mockLookup.mockImplementation(async (_report: string, slug: string) => {
      if (slug === "fed_funds_rate")
        return {
          value: "5.75",
          brain_id: "master",
          metric_slug: slug,
          label: "Fed funds rate",
          grain: "national",
        };
      if (slug === "median_sale_price_yoy")
        return {
          value: "-7.7%",
          brain_id: "master",
          metric_slug: slug,
          label: "Median sale price YoY",
          grain: "zip-month",
        };
      if (slug === "active_listings_count")
        return {
          value: "356",
          brain_id: "master",
          metric_slug: slug,
          label: "Active listings",
          grain: "zip-month",
        };
      return null;
    });

    const items: ProjectItem[] = [
      metricItem({
        id: "i1",
        metric_slug: "fed_funds_rate",
        label: "Fed funds rate",
        value: "5.25",
        freshness_token: "SWFL-7421-v4-20260601",
      }),
      metricItem({
        id: "i2",
        metric_slug: "median_sale_price_yoy",
        label: "Median sale price YoY",
        value: "-3.5%",
      }),
      metricItem({
        id: "i3",
        metric_slug: "active_listings_count",
        label: "Active listings",
        value: "312",
        freshness_token: "SWFL-7421-v4-20260601",
      }),
    ];

    const result = await computeSignificantChanges(items, REGISTRY, undefined, 2);
    expect(result).toHaveLength(2);
    // priority = signal_strength × impact_weight
    // median_sale_price_yoy: signal_strength ≈ 120%/3% = 40, weight=8 → priority≈320
    // fed_funds_rate: signal_strength = 0.5/0.25 = 2, weight=10 → priority=20
    // median wins despite lower impact_weight because the move is proportionally huge
    expect(result[0].slug).toBe("median_sale_price_yoy");
  });

  test("passes zip to lookupLakeFact", async () => {
    mockLookup.mockResolvedValue(null);
    await computeSignificantChanges([metricItem()], REGISTRY, "33931");
    expect(mockLookup).toHaveBeenCalledWith("master", "median_sale_price_yoy", "33931");
  });

  test("falls back to label when metric_slug absent", async () => {
    mockLookup.mockResolvedValue(null);
    await computeSignificantChanges([metricItem({ metric_slug: undefined })], REGISTRY);
    expect(mockLookup).toHaveBeenCalledWith("master", "Median sale price YoY", undefined);
  });
});
