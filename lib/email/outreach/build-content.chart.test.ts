// lib/email/outreach/build-content.chart.test.ts
import { describe, expect, test } from "bun:test";
import { chartFromReport } from "./build-content";
import type { AssembledReport } from "@/lib/email/activation/snapshot";

const report = {
  in_scope: true,
  zip: "34103",
  primaryPlace: "Park Shore",
  countyName: "Collier",
  freshness_token: "SWFL-7421-v5-20260702",
  metrics: [
    { key: "housing.median_sale_price", label: "Median sale price", value: 912000, unit: "$" },
    { key: "housing.median_dom", label: "Median days on market", value: 41, unit: " days" },
    { key: "housing.homes_sold", label: "Homes sold", value: 58, unit: "" },
    { key: "housing.inventory", label: "Inventory", value: 402, unit: "" },
  ],
  lines: [],
  coverage_caveats: [],
  snapshot: { zip: "34103", freshness_token: null, captured_at: "", metrics: [], lines: [] },
} as unknown as AssembledReport;

describe("chartFromReport", () => {
  test("largest same-unit group, custom subtitle, no raw token", () => {
    const chart = chartFromReport(report, "as of 07/02/2026");
    expect(chart?.type).toBe("bar");
    expect(chart?.subtitle).toBe("as of 07/02/2026");
    expect(chart?.data.map((d) => d.label)).toEqual(["Homes sold", "Inventory"]);
    expect(JSON.stringify(chart)).not.toContain("SWFL-7421");
  });
  test("null when no finite metrics", () => {
    expect(chartFromReport({ ...report, metrics: [] } as never)).toBeNull();
  });
});
