/**
 * Phase 2b — FranchiseSurvivalFrame data-adapter tests.
 *
 * No DOM test environment by repo design — we test the pure functions in
 * franchise-survival-utils.ts, not the React tree (mirrors registry.test.ts
 * and the S1/S2 testing deviation).
 */
import { describe, it, expect } from "bun:test";
import {
  prepareBrands,
  sortBrands,
  computeMedian,
  computeKPIs,
  barColor,
  fmtApproval,
  fmtPct,
  type FranchiseBrandRaw,
} from "./franchise-survival-utils";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOOD: FranchiseBrandRaw = {
  franchise_name: "Great Clips",
  survival_rate: 1.0,
  n_paid_in_full: 4,
  n_charged_off: 0,
  n_loans: 6,
  total_gross_approval: 778_000,
};
const BAD: FranchiseBrandRaw = {
  franchise_name: "Snap Fitness",
  survival_rate: 0.333,
  n_paid_in_full: 1,
  n_charged_off: 2,
  n_loans: 4,
  total_gross_approval: 1_200_000,
};
const NULL_BRAND: FranchiseBrandRaw = {
  franchise_name: "Mathnasium",
  survival_rate: null,
  n_paid_in_full: null,
  n_charged_off: null,
  n_loans: 1,
  total_gross_approval: 280_000,
};

// ---------------------------------------------------------------------------
// prepareBrands
// ---------------------------------------------------------------------------

describe("prepareBrands", () => {
  it("filters out brands with null survival_rate", () => {
    const result = prepareBrands([GOOD, NULL_BRAND]);
    expect(result.length).toBe(1);
    expect(result[0].franchise_name).toBe("Great Clips");
  });

  it("derives resolved = n_paid_in_full + n_charged_off", () => {
    const [b] = prepareBrands([BAD]);
    expect(b.resolved).toBe(3); // 1 paid + 2 co
  });

  it("derives chargeoff_rate = 1 - survival_rate", () => {
    const [b] = prepareBrands([BAD]);
    expect(b.chargeoff_rate).toBeCloseTo(0.667, 2);
  });

  it("returns empty array when all brands are null", () => {
    expect(prepareBrands([NULL_BRAND])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sortBrands
// ---------------------------------------------------------------------------

describe("sortBrands", () => {
  const prepared = prepareBrands([BAD, GOOD]);

  it("sorts by survival descending", () => {
    const sorted = sortBrands(prepared, "survival");
    expect(sorted[0].franchise_name).toBe("Great Clips");
  });

  it("sorts by chargeoff descending", () => {
    const sorted = sortBrands(prepared, "chargeoff");
    expect(sorted[0].franchise_name).toBe("Snap Fitness");
  });

  it("sorts by sample descending", () => {
    const sorted = sortBrands(prepared, "sample");
    expect(sorted[0].franchise_name).toBe("Great Clips"); // resolved = 4 > 3 = Snap Fitness
  });

  it("sorts by approval descending", () => {
    const sorted = sortBrands(prepared, "approval");
    expect(sorted[0].franchise_name).toBe("Snap Fitness"); // $1.2M > $0.778M
  });

  it("does not mutate the input array", () => {
    const original = [...prepared];
    sortBrands(prepared, "chargeoff");
    expect(prepared[0].franchise_name).toBe(original[0].franchise_name);
  });
});

// ---------------------------------------------------------------------------
// computeMedian
// ---------------------------------------------------------------------------

describe("computeMedian", () => {
  it("returns 0 on empty input", () => {
    expect(computeMedian([])).toBe(0);
  });

  it("returns single value for one brand", () => {
    const [b] = prepareBrands([GOOD]);
    expect(computeMedian([b])).toBe(1.0);
  });

  it("averages the two middle values for even-length arrays", () => {
    const brands = prepareBrands([GOOD, BAD]);
    // sorted rates: [0.333, 1.0] → median = (0.333 + 1.0) / 2 = 0.6665
    expect(computeMedian(brands)).toBeCloseTo(0.6665, 3);
  });
});

// ---------------------------------------------------------------------------
// computeKPIs
// ---------------------------------------------------------------------------

describe("computeKPIs", () => {
  const allRows = [GOOD, BAD, NULL_BRAND];
  const assessed = prepareBrands(allRows);

  it("brandsAssessed counts only assessable brands", () => {
    const kpis = computeKPIs(allRows, assessed);
    expect(kpis.brandsAssessed).toBe(2);
    expect(kpis.totalBrands).toBe(3);
  });

  it("totalResolved sums resolved loans", () => {
    const kpis = computeKPIs(allRows, assessed);
    // Great Clips: 4, Snap Fitness: 3
    expect(kpis.totalResolved).toBe(7);
  });

  it("overallSurvival = totalPaid / totalResolved", () => {
    const kpis = computeKPIs(allRows, assessed);
    // Great Clips: 4 paid, Snap Fitness: 1 paid → 5/7
    expect(kpis.overallSurvival).toBeCloseTo(5 / 7, 4);
  });

  it("totalApproval includes non-assessable brands", () => {
    const kpis = computeKPIs(allRows, assessed);
    expect(kpis.totalApproval).toBe(778_000 + 1_200_000 + 280_000);
  });
});

// ---------------------------------------------------------------------------
// barColor
// ---------------------------------------------------------------------------

describe("barColor", () => {
  it("returns mangrove green at or above median", () => {
    expect(barColor(0.9, 0.8)).toBe("#5bc97a");
    expect(barColor(0.8, 0.8)).toBe("#5bc97a"); // exactly at median
  });

  it("returns neutral gold between 50% and median", () => {
    expect(barColor(0.6, 0.8)).toBe("#d4b370");
  });

  it("returns sunset coral below 50%", () => {
    expect(barColor(0.3, 0.8)).toBe("#e08158");
  });
});

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

describe("fmtApproval", () => {
  it("formats millions with one decimal", () => {
    expect(fmtApproval(1_200_000)).toBe("$1.2M");
  });

  it("formats thousands rounded", () => {
    expect(fmtApproval(778_000)).toBe("$778K");
  });
});

describe("fmtPct", () => {
  it("formats a ratio as percent with one decimal", () => {
    expect(fmtPct(0.919)).toBe("91.9%");
    expect(fmtPct(1.0)).toBe("100.0%");
    expect(fmtPct(0)).toBe("0.0%");
  });
});
