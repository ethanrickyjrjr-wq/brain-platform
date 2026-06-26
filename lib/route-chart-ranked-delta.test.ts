import { describe, expect, test } from "bun:test";
import { routeRankedDelta } from "./route-chart";

describe("routeRankedDelta", () => {
  test("ranking intent + a value-delta topic → the brain slug to bind ranked-delta", () => {
    expect(routeRankedDelta("Rank SWFL ZIPs by home value with year-over-year change")).toBe(
      "home-values-swfl",
    );
    expect(routeRankedDelta("Which ZIPs have the highest home values right now?")).toBe(
      "home-values-swfl",
    );
    expect(routeRankedDelta("Compare ZIPs by investor rent yield")).toBe("investor-zip-swfl");
    expect(routeRankedDelta("Which areas are the hottest sellers' market?")).toBe(
      "market-heat-swfl",
    );
  });

  test("a TREND question keeps the zhvi area chart (no ranking intent) → null", () => {
    expect(routeRankedDelta("How are SWFL home values trending over the past year?")).toBeNull();
    expect(routeRankedDelta("What's the read on home values?")).toBeNull();
  });

  test("ranking intent but NO value-delta topic → null (doesn't hijack other brains)", () => {
    expect(routeRankedDelta("Rank SWFL ZIPs by flood risk")).toBeNull();
    expect(routeRankedDelta("Which ZIPs have the most permits?")).toBeNull();
  });

  test("empty / non-string → null", () => {
    expect(routeRankedDelta("")).toBeNull();
    expect(routeRankedDelta(undefined as unknown as string)).toBeNull();
  });
});
