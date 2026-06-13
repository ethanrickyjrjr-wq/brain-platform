import { describe, expect, it } from "bun:test";
import { formatChartValue, formatAxisTick, formatAsOf } from "./format";

// The chart component takes a serializable valueFormat TOKEN (not a function —
// see the RSC-boundary note in format.ts) and resolves it here. These lock the
// three formats the public /charts page uses.
describe("formatChartValue", () => {
  it("usd: abbreviates millions, comma-groups otherwise", () => {
    expect(formatChartValue("usd", 1_250_000)).toBe("$1.25M");
    expect(formatChartValue("usd", 415_000)).toBe("$415,000");
  });

  it("rent: comma-grouped dollars, never abbreviated", () => {
    expect(formatChartValue("rent", 2_450)).toBe("$2,450");
    expect(formatChartValue("rent", 980)).toBe("$980");
  });

  it("count: k / M abbreviations for passenger volumes", () => {
    expect(formatChartValue("count", 640_135)).toBe("640k");
    expect(formatChartValue("count", 1_200_000)).toBe("1.2M");
    expect(formatChartValue("count", 512)).toBe("512");
  });
});

describe("formatAxisTick (compact, so phone Y-axis labels don't clip)", () => {
  it("usd: abbreviates to $k / $M (the clipped-'10,000' bug)", () => {
    expect(formatAxisTick("usd", 110_000)).toBe("$110k");
    expect(formatAxisTick("usd", 460_000)).toBe("$460k");
    expect(formatAxisTick("usd", 1_200_000)).toBe("$1.2M");
    expect(formatAxisTick("usd", 0)).toBe("$0");
  });
  it("rent: keeps full dollars (short enough to fit; rounding would collide ticks)", () => {
    expect(formatAxisTick("rent", 2_000)).toBe("$2,000");
  });
  it("count: stays abbreviated", () => {
    expect(formatAxisTick("count", 640_135)).toBe("640k");
  });
});

describe("formatAsOf", () => {
  it("formats YYYY-MM to 'Mon YYYY'", () => {
    expect(formatAsOf("2026-04")).toBe("Apr 2026");
    expect(formatAsOf("2025-12")).toBe("Dec 2025");
  });

  it("passes through undefined and unexpected input untouched", () => {
    expect(formatAsOf(undefined)).toBeUndefined();
    expect(formatAsOf("whenever")).toBe("whenever");
  });
});
