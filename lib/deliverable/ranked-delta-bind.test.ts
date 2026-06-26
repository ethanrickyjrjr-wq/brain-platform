import { describe, expect, test } from "bun:test";
import { bindRankedDeltaSpec } from "./ranked-delta-bind";
import {
  findRankedDeltaPair,
  isTimeSeriesTable,
  isDeltaColumn,
} from "../../refinery/lib/chart-from-metrics.mts";
import type { BrainOutput, BrainOutputDetailTable } from "../../refinery/types/brain-output.mts";

// ---------------------------------------------------------------------------
// Fixtures — the binder reads only refined_at / detail_tables.
// ---------------------------------------------------------------------------

const src = {
  url: "https://example.gov/source",
  fetched_at: "2026-06-01T00:00:00Z",
  tier: 1 as const,
  citation: "Example provenance citation",
};

function table(p: Partial<BrainOutputDetailTable>): BrainOutputDetailTable {
  return {
    id: "t",
    title: "Table",
    grain: "zip",
    columns: [],
    rows: [],
    source: src,
    ...p,
  } as BrainOutputDetailTable;
}

function output(
  detail_tables: BrainOutputDetailTable[],
  refined_at = "2026-04-30T12:00:00Z",
): BrainOutput {
  return { refined_at, key_metrics: [], detail_tables } as unknown as BrainOutput;
}

// A real-shaped cross-section: ZHVI level + YoY% + a constant latest_period stamp.
const zhviTable = table({
  id: "home_values_by_zip",
  title: "SWFL ZHVI home value by ZIP — latest period 2026-04-30",
  grain: "zip",
  columns: [
    { id: "latest_period", label: "Latest period" },
    { id: "home_value_zhvi", label: "Home value (USD)", display_format: "currency", units: "USD" },
    { id: "value_yoy_pct", label: "Value YoY %", display_format: "percent", units: "percent" },
  ],
  rows: [
    {
      key: "33901",
      label: "33901",
      cells: { latest_period: "2026-04-30", home_value_zhvi: 264506, value_yoy_pct: -9.61 },
    },
    {
      key: "33903",
      label: "33903",
      cells: { latest_period: "2026-04-30", home_value_zhvi: 312000, value_yoy_pct: -4.0 },
    },
    {
      key: "33907",
      label: "33907",
      cells: { latest_period: "2026-04-30", home_value_zhvi: 389000, value_yoy_pct: 2.5 },
    },
  ],
});

describe("isDeltaColumn", () => {
  test("flags YoY / MoM / change columns, not levels", () => {
    expect(isDeltaColumn({ id: "value_yoy_pct" })).toBe(true);
    expect(isDeltaColumn({ id: "dom_yy", label: "DOM Y/Y" })).toBe(true);
    expect(isDeltaColumn({ id: "x", label: "Inventory change" })).toBe(true);
    expect(isDeltaColumn({ id: "home_value_zhvi", label: "Home value (USD)" })).toBe(false);
    expect(isDeltaColumn({ id: "listing_count" })).toBe(false);
  });
});

describe("isTimeSeriesTable", () => {
  test("a constant latest_period stamp is NOT a time series", () => {
    expect(isTimeSeriesTable(zhviTable)).toBe(false);
  });
  test("a date column with >1 distinct value IS a time series", () => {
    const ts = table({
      grain: "month",
      columns: [
        { id: "month", label: "Month" },
        { id: "value", label: "Value", display_format: "currency" },
      ],
      rows: [
        { key: "1", label: "Jan", cells: { month: "2026-01", value: 10 } },
        { key: "2", label: "Feb", cells: { month: "2026-02", value: 20 } },
        { key: "3", label: "Mar", cells: { month: "2026-03", value: 30 } },
      ],
    });
    expect(isTimeSeriesTable(ts)).toBe(true);
  });
});

describe("findRankedDeltaPair", () => {
  test("pairs a value column with its OWN delta by shared token stem", () => {
    const pair = findRankedDeltaPair(zhviTable);
    expect(pair).not.toBeNull();
    expect(pair!.valueColId).toBe("home_value_zhvi");
    expect(pair!.deltaColId).toBe("value_yoy_pct");
    expect(pair!.deltaIsPercent).toBe(true);
  });

  test("no mispairing: a delta that shares no stem with any value column → null", () => {
    // market-heat shape: the heat score's neighbors are deltas about OTHER metrics.
    const heat = table({
      grain: "zip",
      columns: [
        { id: "market_heat_score", label: "Heat Tilt", display_format: "raw" },
        { id: "active_listing_count", label: "Active Listings", display_format: "count" },
        { id: "inventory_yy", label: "Inventory Y/Y", display_format: "percent" },
        { id: "pending_ratio_yy", label: "Pending Ratio Y/Y", display_format: "percent" },
      ],
      rows: [
        {
          key: "a",
          label: "A",
          cells: {
            market_heat_score: 70,
            active_listing_count: 100,
            inventory_yy: 5,
            pending_ratio_yy: 2,
          },
        },
        {
          key: "b",
          label: "B",
          cells: {
            market_heat_score: 55,
            active_listing_count: 120,
            inventory_yy: -3,
            pending_ratio_yy: 1,
          },
        },
        {
          key: "c",
          label: "C",
          cells: {
            market_heat_score: 60,
            active_listing_count: 90,
            inventory_yy: 4,
            pending_ratio_yy: -1,
          },
        },
      ],
    });
    expect(findRankedDeltaPair(heat)).toBeNull();
  });

  test("a time series never yields a ranked-delta pair", () => {
    const ts = table({
      grain: "month",
      columns: [
        { id: "month", label: "Month" },
        { id: "value", label: "Value", display_format: "currency" },
        { id: "value_yoy_pct", label: "Value YoY", display_format: "percent" },
      ],
      rows: [
        { key: "1", label: "Jan", cells: { month: "2026-01", value: 10, value_yoy_pct: 1 } },
        { key: "2", label: "Feb", cells: { month: "2026-02", value: 20, value_yoy_pct: 2 } },
        { key: "3", label: "Mar", cells: { month: "2026-03", value: 30, value_yoy_pct: 3 } },
      ],
    });
    expect(findRankedDeltaPair(ts)).toBeNull();
  });
});

describe("bindRankedDeltaSpec", () => {
  test("binds a ranked-delta spec: USD value, YoY% delta → absolute $ change, ranked desc", () => {
    const spec = bindRankedDeltaSpec(output([zhviTable]));
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("ranked-delta");
    expect(spec!.asOf).toBe("2026-04-30");
    expect(spec!.value_format).toBe("usd");
    expect(spec!.options!.value_format).toBe("usd"); // web frame == email PNG scale
    expect(spec!.source?.citation).toBe("Example provenance citation");

    const items = spec!.options!.items as { label: string; value: number; delta?: number }[];
    // ranked descending by value
    expect(items.map((i) => i.label)).toEqual(["33907", "33903", "33901"]);
    // the -9.61% YoY on $264,506 → implied prior 264506/0.9039 ≈ 292,627 → ≈ -28,121
    const z01 = items.find((i) => i.label === "33901")!;
    expect(z01.delta).toBeLessThan(0);
    expect(z01.delta!).toBeCloseTo(264506 - 264506 / (1 - 9.61 / 100), 0);
    // a positive YoY → a positive (gain) delta
    expect(items.find((i) => i.label === "33907")!.delta!).toBeGreaterThan(0);
  });

  test("a percent VALUE keeps its delta as points (no $ conversion)", () => {
    const vac = table({
      grain: "zip",
      columns: [
        { id: "vacancy_rate", label: "Vacancy rate", display_format: "percent" },
        { id: "vacancy_yoy", label: "Vacancy YoY (pts)", display_format: "percent" },
      ],
      rows: [
        { key: "a", label: "A", cells: { vacancy_rate: 8, vacancy_yoy: -2 } },
        { key: "b", label: "B", cells: { vacancy_rate: 6, vacancy_yoy: 1 } },
        { key: "c", label: "C", cells: { vacancy_rate: 7, vacancy_yoy: 0 } },
      ],
    });
    const spec = bindRankedDeltaSpec(output([vac]));
    expect(spec).not.toBeNull();
    expect(spec!.value_format).toBe("percent");
    expect(spec!.options!.value_format).toBe("pct");
    const items = spec!.options!.items as { label: string; delta?: number }[];
    // -2 stays -2 (points), not converted through the percent-of-percent formula
    expect(items.find((i) => i.label === "A")!.delta).toBe(-2);
  });

  test("no value+delta pair → null (caller keeps the plain bar)", () => {
    const plain = table({
      grain: "county",
      columns: [
        { id: "city", label: "City" },
        { id: "permits", label: "Permits", display_format: "count" },
      ],
      rows: [
        { key: "fm", label: "Fort Myers", cells: { city: "Fort Myers", permits: 120 } },
        { key: "np", label: "Naples", cells: { city: "Naples", permits: 90 } },
        { key: "cc", label: "Cape Coral", cells: { city: "Cape Coral", permits: 150 } },
      ],
    });
    expect(bindRankedDeltaSpec(output([plain]))).toBeNull();
  });

  test("fewer than 3 rows → null", () => {
    const tiny = table({
      grain: "zip",
      columns: [
        { id: "home_value_zhvi", label: "Home value", display_format: "currency" },
        { id: "value_yoy_pct", label: "Value YoY", display_format: "percent" },
      ],
      rows: [
        { key: "a", label: "A", cells: { home_value_zhvi: 100, value_yoy_pct: 1 } },
        { key: "b", label: "B", cells: { home_value_zhvi: 200, value_yoy_pct: 2 } },
      ],
    });
    expect(bindRankedDeltaSpec(output([tiny]))).toBeNull();
  });

  test("no refined_at → null (cannot stamp an as-of)", () => {
    expect(bindRankedDeltaSpec(output([zhviTable], ""))).toBeNull();
  });
});
