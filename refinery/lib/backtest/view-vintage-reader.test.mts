import { describe, it, expect } from "vitest";
import {
  periodToObservationDate,
  viewVintagesToVintages,
  type ViewVintageRow,
} from "./view-vintage-reader.mts";
import { initialVintages, pitInitial } from "./grid.mts";

describe("periodToObservationDate", () => {
  it("maps 'YYYY-MM' to that month's last day", () => {
    expect(periodToObservationDate("2026-04")).toBe("2026-04-30");
    expect(periodToObservationDate("2026-02")).toBe("2026-02-28");
    expect(periodToObservationDate("2026-12")).toBe("2026-12-31");
  });

  it("handles leap February", () => {
    expect(periodToObservationDate("2024-02")).toBe("2024-02-29");
  });

  it("passes an already-full date through unchanged", () => {
    expect(periodToObservationDate("2026-04-30")).toBe("2026-04-30");
  });
});

describe("viewVintagesToVintages", () => {
  const rows: ViewVintageRow[] = [
    // 2026-04 first seen on the 2026-06-26 capture …
    {
      view_name: "zhvi_pivoted",
      as_of: "2026-06-26",
      period: "2026-04",
      series_key: "cape_coral",
      value: 400_000,
    },
    // … then RE-REPORTED (Zillow revised history) on the 2026-07-26 capture.
    {
      view_name: "zhvi_pivoted",
      as_of: "2026-07-26",
      period: "2026-04",
      series_key: "cape_coral",
      value: 405_000,
    },
    // a different series on the same view
    {
      view_name: "zhvi_pivoted",
      as_of: "2026-06-26",
      period: "2026-04",
      series_key: "naples",
      value: 600_000,
    },
    // a different view entirely
    {
      view_name: "zori_pivoted",
      as_of: "2026-06-26",
      period: "2026-04",
      series_key: "cape_coral",
      value: 2_100,
    },
  ];

  it("filters by (view_name, series_key) and maps as_of→realtime_start, period→observation_date", () => {
    const out = viewVintagesToVintages(rows, "zhvi_pivoted", "cape_coral");
    expect(out).toEqual([
      { observation_date: "2026-04-30", value: 400_000, realtime_start: "2026-06-26" },
      { observation_date: "2026-04-30", value: 405_000, realtime_start: "2026-07-26" },
    ]);
  });

  it("does not bleed across series or views", () => {
    expect(viewVintagesToVintages(rows, "zhvi_pivoted", "naples")).toHaveLength(1);
    expect(viewVintagesToVintages(rows, "zori_pivoted", "cape_coral")).toHaveLength(1);
    expect(viewVintagesToVintages(rows, "zhvi_pivoted", "missing")).toHaveLength(0);
  });

  it("composes with grid.mts PIT logic: initial vintage = first capture, no revision look-ahead", () => {
    const vints = viewVintagesToVintages(rows, "zhvi_pivoted", "cape_coral");
    const initials = initialVintages(vints);
    // The initial (as-first-reported) value for 2026-04 is the 2026-06-26 capture's.
    expect(initials).toEqual([
      { observation_date: "2026-04-30", value: 400_000, realtime_start: "2026-06-26" },
    ]);
    // A read as-of before the first capture sees nothing (no published vintage yet).
    expect(pitInitial(initials, "2026-06-25")).toBeNull();
    // A read as-of on/after the first capture sees the as-first-reported value,
    // NOT the later 405k revision.
    expect(pitInitial(initials, "2026-09-01")).toEqual({
      observation_date: "2026-04-30",
      value: 400_000,
    });
  });
});
