import { describe, expect, it } from "bun:test";
import { mapAirportRows } from "./airport-series";

// public.rsw_airport_monthly is a single-series monthly feed (RSW enplanements).
// This mapper turns its DATE rows into the same { month, <series> } shape the
// pivoted-view charts use, so one chart component renders both.
describe("mapAirportRows", () => {
  it("maps date rows to { month, passengers }, sorted ascending, asOf = latest", () => {
    const rows = [
      { report_month: "2026-03-01", value: 760820 },
      { report_month: "2026-01-01", value: 539194 },
      { report_month: "2026-02-01", value: 575995 },
    ];

    const r = mapAirportRows(rows);

    expect(r.entries.map((e) => e.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(r.entries[2].passengers).toBe(760820);
    expect(r.asOf).toBe("2026-03");
    expect(r.rowCount).toBe(3);
  });

  it("drops a null value but still counts it in rowCount", () => {
    const rows = [
      { report_month: "2026-01-01", value: 539194 },
      { report_month: "2026-02-01", value: null },
    ];

    const r = mapAirportRows(rows);

    expect(r.entries.map((e) => e.month)).toEqual(["2026-01"]);
    expect(r.rowCount).toBe(2);
  });

  it("degrades safely on null/empty input", () => {
    expect(mapAirportRows(null).entries).toEqual([]);
    expect(mapAirportRows([]).asOf).toBeUndefined();
    expect(mapAirportRows([]).rowCount).toBe(0);
  });
});
