import { describe, expect, it } from "bun:test";
import { mapTierIndexed, type TierPivotedRow } from "./tier-divergence-series";

// The mapper rebases each tier's monthly median to 100 at the base month so the
// chart shows relative appreciation. These lock the indexer math, the base-month
// fallback, null-tolerance, and the empty-input degrade-to-empty contract.
describe("mapTierIndexed", () => {
  const rows: TierPivotedRow[] = [
    { month: "2019-01", median_top_tier: 100, median_bottom_tier: 200 }, // base
    { month: "2019-02", median_top_tier: 150, median_bottom_tier: 300 },
    { month: "2019-03", median_top_tier: 200, median_bottom_tier: 250 },
  ];

  it("rebases both tiers to 100 at 2019-01", () => {
    const { entries, baseMonth } = mapTierIndexed(rows);
    expect(baseMonth).toBe("2019-01");
    expect(entries[0]).toEqual({ month: "2019-01", luxury_index: 100, starter_index: 100 });
  });

  it("indexes later months off the base (relative, not absolute)", () => {
    const { entries, asOf } = mapTierIndexed(rows);
    expect(entries[1]).toEqual({ month: "2019-02", luxury_index: 150, starter_index: 150 });
    expect(entries[2]).toEqual({ month: "2019-03", luxury_index: 200, starter_index: 125 });
    expect(asOf).toBe("2019-03");
  });

  it("sorts input ascending before indexing", () => {
    const { entries } = mapTierIndexed([...rows].reverse());
    expect(entries.map((e) => e.month)).toEqual(["2019-01", "2019-02", "2019-03"]);
    expect(entries[0].luxury_index).toBe(100);
  });

  it("rounds to one decimal place", () => {
    const { entries } = mapTierIndexed([
      { month: "2019-01", median_top_tier: 300, median_bottom_tier: 300 },
      { month: "2019-02", median_top_tier: 400, median_bottom_tier: 350 },
    ]);
    // 400/300*100 = 133.33… → 133.3 ; 350/300*100 = 116.66… → 116.7
    expect(entries[1]).toEqual({ month: "2019-02", luxury_index: 133.3, starter_index: 116.7 });
  });

  it("falls back to the first available month when 2019-01 is absent", () => {
    const { entries, baseMonth } = mapTierIndexed([
      { month: "2020-05", median_top_tier: 500, median_bottom_tier: 250 },
      { month: "2020-06", median_top_tier: 600, median_bottom_tier: 250 },
    ]);
    expect(baseMonth).toBe("2020-05");
    expect(entries[0].luxury_index).toBe(100);
    expect(entries[1].luxury_index).toBe(120); // 600/500*100
  });

  it("drops rows missing either tier", () => {
    const { entries } = mapTierIndexed([
      { month: "2019-01", median_top_tier: 100, median_bottom_tier: 100 },
      { month: "2019-02", median_top_tier: null, median_bottom_tier: 300 },
      { month: "2019-03", median_top_tier: 200, median_bottom_tier: null },
    ]);
    expect(entries.map((e) => e.month)).toEqual(["2019-01"]);
  });

  it("degrades to empty on null / empty input", () => {
    expect(mapTierIndexed(null)).toEqual({ entries: [], baseMonth: "2019-01" });
    expect(mapTierIndexed([])).toEqual({ entries: [], baseMonth: "2019-01" });
  });
});
