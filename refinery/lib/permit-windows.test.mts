import { describe, it, expect } from "vitest";
import {
  generateHistoricalWindows,
  generateCurrentWindow,
  countPermitsInWindow,
  rateNormalize,
  computeZScore,
  type PermitWindow,
} from "./permit-windows.mts";

const NOW = new Date("2026-05-22T00:00:00Z");

describe("generateHistoricalWindows", () => {
  it("returns 13 non-overlapping 28-day windows immediately preceding the current 90d window", () => {
    const windows = generateHistoricalWindows(NOW);
    expect(windows).toHaveLength(13);
    const ninetyDaysAgo = new Date(NOW.getTime() - 90 * 86400_000);
    expect(windows[0].end_exclusive.getTime()).toBeCloseTo(
      ninetyDaysAgo.getTime(),
      -3,
    );
    for (const w of windows) {
      const span_days =
        (w.end_exclusive.getTime() - w.start_inclusive.getTime()) / 86400_000;
      expect(span_days).toBeCloseTo(28, 5);
    }
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].end_exclusive.getTime()).toBe(
        windows[i - 1].start_inclusive.getTime(),
      );
    }
  });
});

describe("generateCurrentWindow", () => {
  it("returns a single 90-day window ending at NOW", () => {
    const w = generateCurrentWindow(NOW);
    const span_days =
      (w.end_exclusive.getTime() - w.start_inclusive.getTime()) / 86400_000;
    expect(span_days).toBeCloseTo(90, 5);
    expect(w.end_exclusive.getTime()).toBe(NOW.getTime());
  });
});

describe("countPermitsInWindow", () => {
  it("counts permits whose issued_date falls in [start, end_exclusive)", () => {
    const w: PermitWindow = {
      start_inclusive: new Date("2026-01-01T00:00:00Z"),
      end_exclusive: new Date("2026-02-01T00:00:00Z"),
    };
    const permits = [
      { issued_date: "2025-12-31" },
      { issued_date: "2026-01-01" },
      { issued_date: "2026-01-15" },
      { issued_date: "2026-01-31" },
      { issued_date: "2026-02-01" },
    ];
    expect(countPermitsInWindow(permits, w)).toBe(3);
  });
});

describe("rateNormalize", () => {
  it("returns count / observed_days_in_window", () => {
    const w: PermitWindow = {
      start_inclusive: new Date("2026-01-01T00:00:00Z"),
      end_exclusive: new Date("2026-01-29T00:00:00Z"),
    };
    expect(rateNormalize(28, w)).toBeCloseTo(1.0, 5);
    expect(rateNormalize(14, w)).toBeCloseTo(0.5, 5);
    expect(rateNormalize(0, w)).toBe(0);
  });

  it("returns 0 when window is zero-duration", () => {
    const w: PermitWindow = {
      start_inclusive: new Date("2026-01-01T00:00:00Z"),
      end_exclusive: new Date("2026-01-01T00:00:00Z"),
    };
    expect(rateNormalize(5, w)).toBe(0);
  });
});

describe("computeZScore", () => {
  it("returns 0 when stdev is 0 (all historical rates identical)", () => {
    const z = computeZScore(2.0, [1.0, 1.0, 1.0, 1.0]);
    expect(z).toBe(0);
  });

  it("computes a non-zero z when stdev > 0", () => {
    const z = computeZScore(2.0, [1.0, 0.5, 1.5, 1.0]);
    expect(z).toBeGreaterThan(2);
    expect(z).toBeLessThan(3.5);
  });

  it("returns 0 when historical array is empty", () => {
    expect(computeZScore(5.0, [])).toBe(0);
  });
});
