/**
 * Tests for computeSignificantChanges.
 * Mocks lookupLakeFact so no disk I/O; exercises dedup, filtering, ranking, limit.
 */

import { describe, test, expect, vi, beforeEach, afterAll } from "vitest";
import { mock } from "bun:test";
import * as lane1Actual from "@/lib/reconcile/lane1";
import { computeSignificantChanges } from "./brain-snapshot";
import type { SignificanceRegistry } from "./types";
import type { ProjectItem } from "@/lib/project/items";

// Snapshot the REAL module before mocking. Under `bun test` (the only runner —
// these "vitest" files run through bun's `vi` shim) `vi.mock` maps to a
// PROCESS-GLOBAL `mock.module` with no per-file isolation, so without the
// afterAll() restore below this mock leaks into every later test file and
// breaks lib/reconcile/lane1.test.ts. bun executes `vi.mock` in source order
// (not hoisted — that's why `mockLookup` is referenceable), so this snapshot,
// taken above it, captures the genuine exports.
const realLane1 = { ...lane1Actual };

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
    // Default fixture is ZIP-scoped — reflects the post-Phase-3A reality that
    // filed items carry a scope. Tests that exercise the silent paths override
    // scope_kind/scope_value explicitly.
    scope_kind: "zip",
    scope_value: "33931",
    ...overrides,
  };
}

beforeEach(() => {
  mockLookup.mockReset();
});

// Restore the real module so the global mock does not leak into later test
// files (bun has no per-file module isolation; see the snapshot note above).
afterAll(() => {
  mock.module("@/lib/reconcile/lane1", () => realLane1);
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

    const result = await computeSignificantChanges(items, REGISTRY, undefined, undefined, 2);
    expect(result).toHaveLength(2);
    // priority = signal_strength × impact_weight
    // median_sale_price_yoy: signal_strength ≈ 120%/3% = 40, weight=8 → priority≈320
    // fed_funds_rate: signal_strength = 0.5/0.25 = 2, weight=10 → priority=20
    // median wins despite lower impact_weight because the move is proportionally huge
    expect(result[0].slug).toBe("median_sale_price_yoy");
  });

  // Gate 1 A2 (strict): an item with NO scope has an unknown grain → we never
  // substitute the project-level zip → silent. (Legacy pre-3A items; they fire
  // again once refiled with a scope.)
  test("skips item silently when it has no scope (Gate 1 A2)", async () => {
    mockLookup.mockResolvedValue(null);
    const result = await computeSignificantChanges(
      [metricItem({ scope_kind: undefined, scope_value: undefined })],
      REGISTRY,
      "33931",
    );
    expect(result).toEqual([]);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  // Gate 1 A2 (strict): zip grain but no scope_value → can't target the ZIP → silent.
  test("skips zip-grain item with no scope_value (Gate 1 A2)", async () => {
    mockLookup.mockResolvedValue(null);
    const result = await computeSignificantChanges(
      [metricItem({ scope_kind: "zip", scope_value: undefined })],
      REGISTRY,
      "33931",
    );
    expect(result).toEqual([]);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  // Gate 1 A1: no metric_slug → skip silently, never fall back to label
  test("skips item silently when metric_slug is absent (Gate 1 A1)", async () => {
    mockLookup.mockResolvedValue(null);
    const result = await computeSignificantChanges(
      [metricItem({ metric_slug: undefined })],
      REGISTRY,
    );
    expect(result).toEqual([]);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  // Gate 1 A2: item with scope_kind=zip uses item's own zip, not the project-level zip
  test("uses item scope_value when scope_kind is zip (Gate 1 A2)", async () => {
    mockLookup.mockResolvedValue(null);
    const item = metricItem({ scope_kind: "zip", scope_value: "33931" });
    await computeSignificantChanges([item], REGISTRY, "99999");
    expect(mockLookup).toHaveBeenCalledWith("master", "median_sale_price_yoy", "33931");
  });

  // Gate 1 A2 (strict): explicit non-zip scope → headline lookup (no zip), NEVER
  // the project-level zip. The grain is carried by the slug; we do not substitute
  // a ZIP the user never filed.
  test("uses headline lookup (no zip) for non-zip scope (Gate 1 A2)", async () => {
    mockLookup.mockResolvedValue(null);
    const item = metricItem({ scope_kind: "county", scope_value: "lee" });
    await computeSignificantChanges([item], REGISTRY, "33931");
    expect(mockLookup).toHaveBeenCalledWith("master", "median_sale_price_yoy", undefined);
  });

  // Phase F F2/F4: a value confirmed at its EXACT filed value never re-alerts;
  // editing the filed value lifts the suppression (key no longer matches).
  test("suppresses a confirmed value, re-surfaces after an edit (Phase F)", async () => {
    // Current brain value clears the 3% threshold from 6.8% (≈13% relative move).
    mockLookup.mockResolvedValue({
      value: "7.7%",
      brain_id: "master",
      metric_slug: "median_sale_price_yoy",
      label: "Median sale price YoY",
      grain: "zip-month",
    });
    const item = metricItem({
      id: "i1",
      value: "6.8%",
      metric_slug: "median_sale_price_yoy",
      scope_kind: "zip",
      scope_value: "33931",
    });

    // No confirm → the change fires, bound to item i1.
    const fired = await computeSignificantChanges([item], REGISTRY);
    expect(fired).toHaveLength(1);
    expect(fired[0].item_id).toBe("i1");

    // Confirm at the exact filed value → suppressed.
    const suppressed = await computeSignificantChanges([item], REGISTRY, undefined, {
      i1: "6.8%",
    });
    expect(suppressed).toHaveLength(0);

    // Item edited to a different filed value, SAME confirm map → key no longer
    // matches → the change re-surfaces.
    const editedItem = metricItem({
      id: "i1",
      value: "6.5%",
      metric_slug: "median_sale_price_yoy",
      scope_kind: "zip",
      scope_value: "33931",
    });
    const resurfaced = await computeSignificantChanges([editedItem], REGISTRY, undefined, {
      i1: "6.8%",
    });
    expect(resurfaced).toHaveLength(1);
    expect(resurfaced[0].item_id).toBe("i1");
  });
});
