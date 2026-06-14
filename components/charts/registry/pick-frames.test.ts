import { describe, it, expect } from "bun:test";
import { pickFramesForData } from "./pick-frames";
import type { BrainOutputDetailTable, BrainOutputMetric } from "@/refinery/types/brain-output.mts";

// --- fixtures ---

const TIME_SERIES_TABLE: BrainOutputDetailTable = {
  grain: "month",
  columns: [
    { id: "date", label: "Month" },
    { id: "value", label: "Index", display_format: "raw" },
  ],
  rows: [
    { label: "2025-01", cells: { date: "2025-01", value: 102.1 } },
    { label: "2025-02", cells: { date: "2025-02", value: 104.5 } },
    { label: "2025-03", cells: { date: "2025-03", value: 108.0 } },
  ],
};

const RANKED_TABLE: BrainOutputDetailTable = {
  grain: "zip",
  columns: [
    { id: "zip", label: "ZIP" },
    { id: "aal_usd", label: "AAL ($)", display_format: "currency" },
  ],
  rows: [
    { label: "33901", cells: { zip: "33901", aal_usd: 12000 } },
    { label: "33908", cells: { zip: "33908", aal_usd: 30074 } },
    { label: "33931", cells: { zip: "33931", aal_usd: 18500 } },
  ],
};

const TWO_NUMERIC_TABLE: BrainOutputDetailTable = {
  grain: "corridor",
  columns: [
    { id: "corridor", label: "Corridor" },
    { id: "vacancy_rate", label: "Vacancy %", display_format: "percent" },
    { id: "asking_rent", label: "Asking Rent ($)", display_format: "currency" },
  ],
  rows: [
    { label: "Bonita", cells: { corridor: "Bonita", vacancy_rate: 0.04, asking_rent: 18.5 } },
    { label: "Airport", cells: { corridor: "Airport", vacancy_rate: 0.06, asking_rent: 22.0 } },
    { label: "Estero", cells: { corridor: "Estero", vacancy_rate: 0.03, asking_rent: 20.5 } },
  ],
};

const PERCENT_METRICS: BrainOutputMetric[] = [
  {
    metric: "sfha_pct",
    label: "SFHA zone",
    value: 0.19,
    display_format: "percent",
    variable_type: "intensive",
    units: "ratio",
    source: { citation: "FEMA" },
  },
  {
    metric: "ve_zone_pct",
    label: "V/VE zone",
    value: 0.031,
    display_format: "percent",
    variable_type: "intensive",
    units: "ratio",
    source: { citation: "FEMA" },
  },
  {
    metric: "non_sfha_pct",
    label: "Non-SFHA",
    value: 0.779,
    display_format: "percent",
    variable_type: "intensive",
    units: "ratio",
    source: { citation: "FEMA" },
  },
];

const SINGLE_METRIC: BrainOutputMetric[] = [
  {
    metric: "post_ian_recovery",
    label: "Post-Ian Recovery",
    value: 108.1,
    display_format: "raw",
    variable_type: "intensive",
    units: "index (2022=100)",
    source: { citation: "FDOT" },
  },
];

// --- tests ---

describe("pickFramesForData — single best-match or null", () => {
  it("P1: time-series table → zhvi-area", () => {
    const result = pickFramesForData([TIME_SERIES_TABLE], []);
    expect(result).not.toBeNull();
    expect(result!.frameId).toBe("zhvi-area");
  });

  it("P2: two-numeric table → corridor-scatter (not bar-table)", () => {
    const result = pickFramesForData([TWO_NUMERIC_TABLE], []);
    expect(result).not.toBeNull();
    expect(result!.frameId).toBe("corridor-scatter");
  });

  it("P3: percent metrics summing ~1.0 → composition", () => {
    const result = pickFramesForData(undefined, PERCENT_METRICS);
    expect(result).not.toBeNull();
    expect(result!.frameId).toBe("composition");
  });

  it("P4: single numeric metric → z-gauge", () => {
    const result = pickFramesForData(undefined, SINGLE_METRIC);
    expect(result).not.toBeNull();
    expect(result!.frameId).toBe("z-gauge");
  });

  it("P5: ranked table (single numeric col) → bar-table", () => {
    const result = pickFramesForData([RANKED_TABLE], []);
    expect(result).not.toBeNull();
    expect(result!.frameId).toBe("bar-table");
  });

  it("null: empty input → null (no crash)", () => {
    expect(pickFramesForData(undefined, [])).toBeNull();
    expect(pickFramesForData([], [])).toBeNull();
  });

  it("result carries a non-empty reason string", () => {
    const result = pickFramesForData([RANKED_TABLE], []);
    expect(result!.reason.length).toBeGreaterThan(0);
  });

  it("P1 beats P5: time-series table is not downgraded to bar-table", () => {
    // TIME_SERIES_TABLE has a date col + 1 numeric col → P1 fires.
    // P5 would also fire (same numeric col). P1 must win.
    const result = pickFramesForData([TIME_SERIES_TABLE], []);
    expect(result!.frameId).toBe("zhvi-area");
  });

  it("never returns fixture-bound frames", () => {
    const FIXTURE_BOUND = ["seasonal-radial", "storm-timeline"];
    const cases: Array<[BrainOutputDetailTable[] | undefined, BrainOutputMetric[]]> = [
      [[TIME_SERIES_TABLE], []],
      [[RANKED_TABLE], []],
      [[TWO_NUMERIC_TABLE], []],
      [undefined, PERCENT_METRICS],
      [undefined, SINGLE_METRIC],
    ];
    for (const [tables, metrics] of cases) {
      const result = pickFramesForData(tables, metrics);
      if (result) expect(FIXTURE_BOUND).not.toContain(result.frameId);
    }
  });
});
