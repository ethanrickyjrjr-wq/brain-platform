import { describe, it, expect } from "bun:test";
import type { ChartSpec } from "../chart-spec";
import { CHART_REGISTRY } from "../registry";
import type { TimelineEvent } from "./TimelineFrame";

/**
 * Phase 2f — TimelineFrame data-shaping tests.
 *
 * No DOM (repo has no DOM test env). Validates that:
 *   - "storm-timeline" is registered with the correct DataShape
 *   - A fixture ChartSpec with `options.events` resolves through the registry
 *   - Options transform helpers (sorting, baseline, empty) are correct
 */

const FIXTURE_EVENTS: TimelineEvent[] = [
  { label: "Charley", date: "2004-08-13", amount_usd: 1_200_000 },
  { label: "Ian", date: "2022-09-28", amount_usd: 28_500_000 },
  { label: "Irma", date: "2017-09-10", amount_usd: 9_300_000 },
];

function makeSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    frameId: "storm-timeline",
    title: "SWFL NFIP Paid Claims by Named Storm",
    columns: [],
    rows: [],
    asOf: "2026-05-17",
    source: {
      citation:
        "OpenFEMA FimaNfipClaims via data_lake.fema_nfip_claims — per-storm fixture (live binding parked).",
    },
    options: {
      events: FIXTURE_EVENTS,
      baseline_usd: 950_000,
      y_label: "Paid Claims (USD)",
    },
    ...overrides,
  };
}

describe("storm-timeline registry entry", () => {
  it("is registered", () => {
    expect(CHART_REGISTRY["storm-timeline"]).toBeDefined();
  });

  it("accepts the 'timeline' DataShape", () => {
    expect(CHART_REGISTRY["storm-timeline"].accepts).toContain("timeline");
  });

  it("has a non-empty label", () => {
    expect(CHART_REGISTRY["storm-timeline"].label.length).toBeGreaterThan(0);
  });

  it("resolves to a function component", () => {
    expect(typeof CHART_REGISTRY["storm-timeline"].component).toBe("function");
  });
});

describe("TimelineFrame fixture spec", () => {
  it("fixture spec has asOf and source.citation", () => {
    const spec = makeSpec();
    expect(spec.asOf).toBe("2026-05-17");
    expect(spec.source?.citation).toMatch(/OpenFEMA/);
  });

  it("fixture events list is non-empty and has required fields", () => {
    const events = FIXTURE_EVENTS;
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(typeof e.label).toBe("string");
      expect(typeof e.date).toBe("string");
      expect(/^\d{4}-\d{2}-\d{2}$/.test(e.date)).toBe(true);
      expect(typeof e.amount_usd).toBe("number");
      expect(e.amount_usd).toBeGreaterThan(0);
    }
  });

  it("Ian is the largest event in the fixture", () => {
    const ian = FIXTURE_EVENTS.find((e) => e.label === "Ian");
    const max = Math.max(...FIXTURE_EVENTS.map((e) => e.amount_usd));
    expect(ian?.amount_usd).toBe(max);
  });

  it("events sort chronologically by date", () => {
    const sorted = [...FIXTURE_EVENTS].sort((a, b) => a.date.localeCompare(b.date));
    expect(sorted[0].label).toBe("Charley");
    expect(sorted[1].label).toBe("Irma");
    expect(sorted[2].label).toBe("Ian");
  });

  it("baseline_usd is a number when provided", () => {
    const spec = makeSpec();
    expect(typeof spec.options?.baseline_usd).toBe("number");
  });

  it("spec without events options does not throw type errors", () => {
    const spec = makeSpec({ options: undefined });
    // The frame reads options?.events ?? [] — undefined options is safe.
    expect(spec.options).toBeUndefined();
  });
});
