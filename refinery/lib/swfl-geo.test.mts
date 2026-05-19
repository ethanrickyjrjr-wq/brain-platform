import { describe, expect, it } from "vitest";
import {
  BARRIER_ISLAND_ZIPS,
  SWFL_COUNTY_FIPS,
  barrierClassFor,
  capRateBpsFor,
  capRateBpsRangeFor,
  validateClassification,
} from "./swfl-geo.mts";

describe("swfl-geo barrier-island classification", () => {
  it("classifies Fort Myers Beach 33931 as barrier with score 1.0", () => {
    const out = barrierClassFor("33931");
    expect(out.classification).toBe("barrier");
    expect(out.score).toBe(1.0);
    expect(out.record?.county_fips).toBe("12071");
  });

  it("classifies Fort Myers downtown 33901 as coastal-mainland with score 0.5", () => {
    const out = barrierClassFor("33901");
    expect(out.classification).toBe("coastal-mainland");
    expect(out.score).toBe(0.5);
  });

  it("classifies East Naples 34112 as inland with score 0.0", () => {
    const out = barrierClassFor("34112");
    expect(out.classification).toBe("inland");
    expect(out.score).toBe(0.0);
  });

  it("defaults unknown ZIPs to inland 0.0 (conservative — does not trigger flood-veto)", () => {
    const out = barrierClassFor("99999");
    expect(out.classification).toBe("inland");
    expect(out.score).toBe(0.0);
    expect(out.record).toBeNull();
  });

  it("has no orphan counties — every record's county_fips is in SWFL_COUNTY_FIPS", () => {
    for (const [, record] of BARRIER_ISLAND_ZIPS) {
      expect(SWFL_COUNTY_FIPS.has(record.county_fips)).toBe(true);
    }
  });

  it("classification field matches barrier_score by construction", () => {
    for (const [, record] of BARRIER_ISLAND_ZIPS) {
      if (record.barrier_score === 1.0) {
        expect(record.classification).toBe("barrier");
      } else if (record.barrier_score === 0.5) {
        expect(record.classification).toBe("coastal-mainland");
      } else {
        expect(record.classification).toBe("inland");
      }
    }
  });
});

describe("swfl-geo cap-rate basis-point lookup", () => {
  it("returns 0 bps for inland score 0.0", () => {
    expect(capRateBpsFor(0.0)).toBe(0);
  });

  it("returns 27.5 bps midpoint for coastal-mainland score 0.5", () => {
    expect(capRateBpsFor(0.5)).toBe(27.5);
  });

  it("returns 60 bps midpoint for barrier score 1.0", () => {
    expect(capRateBpsFor(1.0)).toBe(60);
  });

  it("returns the published range string for each score", () => {
    expect(capRateBpsRangeFor(1.0)).toContain("+50-70");
    expect(capRateBpsRangeFor(0.5)).toContain("+20-35");
    expect(capRateBpsRangeFor(0.0)).toContain("no flood cap-rate adjustment");
  });
});

describe("swfl-geo stale-table validator", () => {
  it("returns no warnings when every top-20% ZIP is classified", () => {
    const aals = new Map([
      ["33931", 3000],
      ["34145", 2000],
      ["33914", 300],
      ["33901", 250],
      ["34112", 50],
    ]);
    expect(validateClassification(aals)).toEqual([]);
  });

  it("warns when an unclassified ZIP ranks in the top 20%", () => {
    // 5 ZIPs → top 20% = top 1 by AAL. 99998 (unclassified) is highest.
    const aals = new Map([
      ["99998", 5000], // unknown, highest AAL → should warn
      ["33931", 2000],
      ["33914", 300],
      ["33901", 250],
      ["34112", 50],
    ]);
    const warnings = validateClassification(aals);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("99998");
    expect(warnings[0]).toContain("not classified");
  });

  it("returns empty for empty input", () => {
    expect(validateClassification(new Map())).toEqual([]);
  });
});
