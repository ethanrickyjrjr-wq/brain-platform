import { describe, expect, test } from "bun:test";
import { bindFrameSpec, bindDetailTableFrame } from "./bind-frame";
import { freezeSnapshot } from "./build";
import { loadParsedBrain } from "../fetch-brain";
import type { ProjectItem } from "../project/items";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrainOutput, BrainOutputMetric } from "../../refinery/types/brain-output.mts";

// ---------------------------------------------------------------------------
// Minimal fixtures — the binder reads only refined_at / key_metrics /
// detail_tables, so we construct just those and cast (a full BrainOutput has
// ~18 engine-owned fields irrelevant here).
// ---------------------------------------------------------------------------

function metric(
  p: Partial<BrainOutputMetric> & { metric: string; value: number | string; label: string },
): BrainOutputMetric {
  return {
    direction: "stable",
    variable_type: "intensive",
    units: "ratio",
    source: {
      url: "https://example.gov/source",
      fetched_at: "2026-06-01T00:00:00Z",
      tier: 1,
      citation: "Example provenance citation",
    },
    ...p,
  } as BrainOutputMetric;
}

function output(p: {
  refined_at?: string;
  key_metrics?: BrainOutputMetric[];
  detail_tables?: unknown[];
}): BrainOutput {
  return {
    refined_at: "2026-06-01T20:49:31Z",
    key_metrics: [],
    ...p,
  } as unknown as BrainOutput;
}

type Seg = { label: string; valuePct: number };

describe("bindFrameSpec — composition", () => {
  test("single share metric becomes an in/out composition with a complement", () => {
    const o = output({
      key_metrics: [
        metric({
          metric: "swfl_sfha_pct_area_weighted",
          value: 0.4325,
          label: "SWFL area-weighted Special Flood Hazard Area coverage",
          display_format: "ratio",
        }),
      ],
    });
    const spec = bindFrameSpec(o, {
      frame_id: "composition",
      metric_keys: ["swfl_sfha_pct_area_weighted"],
    });
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("composition");
    expect(spec!.asOf).toBe("2026-06-01");
    const segs = spec!.options!.segments as Seg[];
    expect(segs).toHaveLength(2);
    expect(segs[0].valuePct).toBeCloseTo(43.25, 2);
    expect(segs[1].label).toBe("Remaining area");
    expect(segs[1].valuePct).toBeCloseTo(56.75, 2);
    // provenance carried verbatim, never sanitized
    expect(spec!.source?.citation).toBe("Example provenance citation");
  });

  test("two share metrics summing to 100 need no complement", () => {
    const o = output({
      key_metrics: [
        metric({ metric: "p1", value: 0.6, label: "Owner occupied", display_format: "ratio" }),
        metric({ metric: "p2", value: 0.4, label: "Renter occupied", display_format: "ratio" }),
      ],
    });
    // no metric_keys → auto-select the share metrics
    const spec = bindFrameSpec(o, { frame_id: "composition" });
    expect(spec).not.toBeNull();
    const segs = spec!.options!.segments as Seg[];
    expect(segs).toHaveLength(2);
  });
});

describe("bindFrameSpec — z-gauge", () => {
  test("an index metric binds value + baseline 100 + in-range bounds", () => {
    const o = output({
      refined_at: "2026-06-09T13:41:21Z",
      key_metrics: [
        metric({
          metric: "post_ian_recovery",
          value: 108.1,
          label: "Coastal SWFL post-Ian recovery index, 2025 ÷ 2022 × 100",
          units: "index (2022=100)",
          display_format: "ratio",
        }),
      ],
    });
    const spec = bindFrameSpec(o, { frame_id: "z-gauge", metric_keys: ["post_ian_recovery"] });
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("z-gauge");
    expect(spec!.asOf).toBe("2026-06-09");
    const opt = spec!.options!;
    expect(opt.value).toBe(108.1);
    expect(opt.baseline).toBe(100);
    expect(opt.unit).toBe("index (2022=100)");
    expect(opt.min as number).toBeLessThanOrEqual(108.1);
    expect(opt.max as number).toBeGreaterThanOrEqual(108.1);
  });
});

describe("bindFrameSpec — bar-table & guards", () => {
  test("three comparable count metrics bind a bar-table", () => {
    const o = output({
      key_metrics: [
        metric({
          metric: "a",
          value: 10,
          label: "Alpha permits",
          display_format: "count",
          units: "permits",
          variable_type: "extensive",
        }),
        metric({
          metric: "b",
          value: 20,
          label: "Beta permits",
          display_format: "count",
          units: "permits",
          variable_type: "extensive",
        }),
        metric({
          metric: "c",
          value: 30,
          label: "Gamma permits",
          display_format: "count",
          units: "permits",
          variable_type: "extensive",
        }),
      ],
    });
    const spec = bindFrameSpec(o, { frame_id: "bar-table" });
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("bar-table");
    expect(spec!.rows.length).toBeGreaterThanOrEqual(3);
    expect(spec!.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("seasonal-radial (the one FrameDef.fixtureOnly frame) returns null via the registry flag", () => {
    const o = output({ key_metrics: [metric({ metric: "x", value: 5, label: "X" })] });
    expect(bindFrameSpec(o, { frame_id: "seasonal-radial" })).toBeNull();
  });

  test("an explicitly-named frame the binder can't build returns null — NEVER substituted", () => {
    // storm-timeline + zhvi-area are NOT fixtureOnly (live shapes exist) — just
    // unimplemented here → null → caller drops. The recipe never silently gets a
    // bar-table in place of the frame it named (that would misrepresent on /p).
    // storm-timeline is now a table-driven case (L0) — with no `storm_timeline`
    // detail_table on this mock it returns null (table-absent), same observable
    // result. zhvi-area stays default-null (no case). Neither is substituted.
    const o = output({ key_metrics: [metric({ metric: "x", value: 5, label: "X" })] });
    expect(bindFrameSpec(o, { frame_id: "storm-timeline" })).toBeNull();
    expect(bindFrameSpec(o, { frame_id: "zhvi-area" })).toBeNull();
  });

  test("a brain with no refined_at cannot stamp an as-of → null", () => {
    const o = output({
      refined_at: "",
      key_metrics: [metric({ metric: "x", value: 1, label: "X" })],
    });
    expect(bindFrameSpec(o, { frame_id: "z-gauge" })).toBeNull();
  });
});

describe("bindFrameSpec — auto-pick (no frame_id) never substitutes geometry", () => {
  const dateTable = {
    id: "t",
    title: "Monthly series",
    grain: "month",
    columns: [
      { id: "month", label: "Month" },
      { id: "value", label: "Value" },
    ],
    rows: [
      { key: "1", label: "Jan", cells: { month: "2025-01", value: 10 } },
      { key: "2", label: "Feb", cells: { month: "2025-02", value: 20 } },
      { key: "3", label: "Mar", cells: { month: "2025-03", value: 30 } },
    ],
    source: { url: "https://x.gov", fetched_at: "2026-06-01T00:00:00Z", tier: 1, citation: "src" },
  };

  test("picker selects zhvi-area (time-series) the binder can't build → null, NOT a bar-table", () => {
    // The data IS a time series; rendering it as ranked bars would be a different
    // geometry. The binder drops it rather than substitute. (Regression guard.)
    const o = output({ detail_tables: [dateTable] });
    expect(bindFrameSpec(o, {})).toBeNull();
  });

  test("picker selects composition (share metrics) → auto path builds it", () => {
    const o = output({
      key_metrics: [
        metric({ metric: "p1", value: 0.6, label: "Owner occupied", display_format: "ratio" }),
        metric({ metric: "p2", value: 0.4, label: "Renter occupied", display_format: "ratio" }),
      ],
    });
    const spec = bindFrameSpec(o, {});
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("composition");
  });

  test("POSITIVE PATH: picker selects ranked-categories → auto path builds a NON-null bar-table", () => {
    // The substitution fix must NOT have over-corrected into never painting bars.
    // A categorical table (no date col, exactly one numeric col) → picker returns
    // bar-table (ranked-categories) → buildFrame builds it for real.
    const categoryTable = {
      id: "byCity",
      title: "Permits by city",
      grain: "city",
      columns: [
        { id: "city", label: "City" },
        { id: "permits", label: "Permits" },
      ],
      rows: [
        { key: "fm", label: "Fort Myers", cells: { city: "Fort Myers", permits: 120 } },
        { key: "np", label: "Naples", cells: { city: "Naples", permits: 90 } },
        { key: "cc", label: "Cape Coral", cells: { city: "Cape Coral", permits: 150 } },
      ],
      source: {
        url: "https://x.gov",
        fetched_at: "2026-06-01T00:00:00Z",
        tier: 1,
        citation: "src",
      },
    };
    const spec = bindFrameSpec(output({ detail_tables: [categoryTable] }), {});
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("bar-table");
    expect(spec!.rows.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// detail_tables-driven frames (L0): storm-timeline / franchise-survival /
// seasonal-radial. Each maps a named detail_table's rows into the frame's exact
// spec.options. franchise-survival & seasonal-radial stay fixtureOnly in the
// registry until their pack lands, so they are proven via bindDetailTableFrame
// (which bypasses the gate); the gate itself is asserted separately.
// ---------------------------------------------------------------------------

function detailTable(p: {
  id: string;
  grain: string;
  columns: { id: string; label: string }[];
  rows: { key: string; label: string; cells: Record<string, number | string | boolean | null> }[];
  title?: string;
}) {
  return {
    title: p.title ?? "table",
    source: {
      url: "https://example.gov/source",
      fetched_at: "2026-06-01T00:00:00Z",
      tier: 1,
      citation: "Example provenance citation",
    },
    ...p,
  };
}

describe("bindFrameSpec — storm-timeline (table-driven, NOT fixtureOnly)", () => {
  const stormTable = detailTable({
    id: "storm_timeline",
    title: "SWFL named-storm NFIP paid claims",
    grain: "storm",
    columns: [
      { id: "year", label: "Year" },
      { id: "paid_usd", label: "Paid (USD)" },
    ],
    rows: [
      { key: "ian", label: "Ian", cells: { year: 2022, paid_usd: 4_200_000_000 } },
      { key: "irma", label: "Irma", cells: { year: 2017, paid_usd: 900_000_000 } },
      // explicit ISO date overrides the year-synthesized anchor
      {
        key: "milton",
        label: "Milton",
        cells: { year: 2024, paid_usd: 50_000_000, date: "2024-10-09" },
      },
      // a storm with no paid total → omitted, not crashed
      { key: "glades", label: "Glades", cells: { year: 2099, paid_usd: null } },
    ],
  });

  test("binds 3 events (one row dropped for null paid), carries options + provenance + asOf", () => {
    const o = output({ refined_at: "2026-06-09T13:41:21Z", detail_tables: [stormTable] });
    const spec = bindFrameSpec(o, { frame_id: "storm-timeline" });
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("storm-timeline");
    expect(spec!.asOf).toBe("2026-06-09");
    const events = spec!.options!.events as { label: string; date: string; amount_usd: number }[];
    expect(events).toHaveLength(3);
    const ian = events.find((e) => e.label === "Ian")!;
    expect(ian.date).toBe("2022-01-01"); // synthesized from year
    expect(ian.amount_usd).toBe(4_200_000_000);
    const milton = events.find((e) => e.label === "Milton")!;
    expect(milton.date).toBe("2024-10-09"); // explicit date wins
    // provenance carried verbatim, never sanitized
    expect(spec!.source?.citation).toBe("Example provenance citation");
    expect(spec!.source?.url).toBe("https://example.gov/source");
  });

  test("absent storm_timeline table → null (caller drops, no substitution)", () => {
    const o = output({ detail_tables: [] });
    expect(bindFrameSpec(o, { frame_id: "storm-timeline" })).toBeNull();
  });
});

describe("bindDetailTableFrame — franchise-survival (gated fixtureOnly until L2)", () => {
  const franchiseTable = detailTable({
    id: "franchise_survival",
    grain: "brand",
    columns: [
      { id: "survival_rate", label: "Survival" },
      { id: "n_paid_in_full", label: "Paid" },
      { id: "n_charged_off", label: "Charged off" },
      { id: "n_loans", label: "Loans" },
      { id: "total_gross_approval", label: "Gross approval" },
    ],
    rows: [
      {
        key: "subway",
        label: "Subway",
        cells: {
          survival_rate: 0.92,
          n_paid_in_full: 46,
          n_charged_off: 4,
          n_loans: 60,
          total_gross_approval: 12_500_000,
        },
      },
      {
        // an unassessable brand: survival_rate null passes through to the frame
        key: "newco",
        label: "NewCo",
        cells: {
          survival_rate: null,
          n_paid_in_full: null,
          n_charged_off: null,
          n_loans: 3,
          total_gross_approval: 400_000,
        },
      },
    ],
  });

  test("maps rows onto FranchiseBrandRaw verbatim (field names match the frame)", () => {
    const o = output({ detail_tables: [franchiseTable] });
    const spec = bindDetailTableFrame(o, "franchise-survival");
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("franchise-survival");
    const data = spec!.options!.data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({
      franchise_name: "Subway",
      survival_rate: 0.92,
      n_paid_in_full: 46,
      n_charged_off: 4,
      n_loans: 60,
      total_gross_approval: 12_500_000,
    });
    expect(data[1].survival_rate).toBeNull(); // unassessable passthrough
    expect(spec!.source?.citation).toBe("Example provenance citation");
  });

  test("L2 done: bindFrameSpec returns a live spec now that fixtureOnly is false", () => {
    const o = output({ detail_tables: [franchiseTable] });
    const spec = bindFrameSpec(o, { frame_id: "franchise-survival" });
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("franchise-survival");
  });
});

describe("bindDetailTableFrame — seasonal-radial", () => {
  const seasonalTable = detailTable({
    id: "corridor_seasonality",
    grain: "corridor",
    columns: [{ id: "seasonal_index", label: "Seasonal index" }],
    rows: [
      { key: "us41-dt", label: "US 41 — Downtown Fort Myers", cells: { seasonal_index: 0.35 } },
      { key: "5th-ave", label: "5th Ave S — Naples", cells: { seasonal_index: 0.9 } },
    ],
  });

  test("maps rows onto SeasonalRadialEntry (corridor + seasonal_index)", () => {
    const o = output({ detail_tables: [seasonalTable] });
    const spec = bindDetailTableFrame(o, "seasonal-radial");
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("seasonal-radial");
    const data = spec!.options!.data as { corridor: string; seasonal_index: number }[];
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ corridor: "US 41 — Downtown Fort Myers", seasonal_index: 0.35 });
  });

  test("L3 done: bindFrameSpec returns a live spec now that fixtureOnly is false", () => {
    const o = output({ detail_tables: [seasonalTable] });
    const spec = bindFrameSpec(o, { frame_id: "seasonal-radial" });
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("seasonal-radial");
  });

  test("corridor with null seasonal_index is excluded from spec.options.data", () => {
    const mixedTable = detailTable({
      id: "corridor_seasonality",
      grain: "corridor",
      columns: [{ id: "seasonal_index", label: "Seasonal index" }],
      rows: [
        { key: "us41-dt", label: "US 41 — Downtown Fort Myers", cells: { seasonal_index: 0.35 } },
        { key: "pine-ridge", label: "Pine Ridge Rd — Naples", cells: { seasonal_index: null } },
      ],
    });
    const spec = bindDetailTableFrame(output({ detail_tables: [mixedTable] }), "seasonal-radial");
    expect(spec).not.toBeNull();
    const data = spec!.options!.data as { corridor: string; seasonal_index: number }[];
    expect(data).toHaveLength(1);
    expect(data[0].corridor).toBe("US 41 — Downtown Fort Myers");
  });

  test("all-null seasonal_index rows → binder returns null (empty state)", () => {
    const allNullTable = detailTable({
      id: "corridor_seasonality",
      grain: "corridor",
      columns: [{ id: "seasonal_index", label: "Seasonal index" }],
      rows: [
        { key: "a", label: "Corridor A", cells: { seasonal_index: null } },
        { key: "b", label: "Corridor B", cells: { seasonal_index: null } },
      ],
    });
    expect(
      bindDetailTableFrame(output({ detail_tables: [allNullTable] }), "seasonal-radial"),
    ).toBeNull();
  });
});

describe("bindDetailTableFrame — guards", () => {
  test("non-table frame id → null", () => {
    const o = output({ key_metrics: [metric({ metric: "x", value: 1, label: "X" })] });
    expect(bindDetailTableFrame(o, "composition")).toBeNull();
  });
  test("missing table → null", () => {
    const o = output({ detail_tables: [] });
    expect(bindDetailTableFrame(o, "storm-timeline")).toBeNull();
  });
  test("no refined_at → null", () => {
    const o = output({ refined_at: "", detail_tables: [] });
    expect(bindDetailTableFrame(o, "storm-timeline")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LIVE proof — binds the real committed brains. Structural asserts only, so a
// future rebuild that shifts the numbers does not break the test.
// ---------------------------------------------------------------------------

describe("bindFrameSpec — live brains (FLAG-2: first live-data binding)", () => {
  test("env-swfl flood share binds as a composition with a real as-of", async () => {
    const parsed = await loadParsedBrain("env-swfl");
    expect(parsed).not.toBeNull();
    const spec = bindFrameSpec(parsed!.output, {
      frame_id: "composition",
      metric_keys: ["swfl_sfha_pct_area_weighted"],
    });
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("composition");
    expect(spec!.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const segs = spec!.options!.segments as Seg[];
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0].valuePct).toBeGreaterThan(0);
    expect(spec!.source?.citation).toBeTruthy();
  });

  test("traffic-swfl post-Ian recovery binds as a z-gauge with a numeric value", async () => {
    const parsed = await loadParsedBrain("traffic-swfl");
    expect(parsed).not.toBeNull();
    const spec = bindFrameSpec(parsed!.output, {
      frame_id: "z-gauge",
      metric_keys: ["post_ian_recovery"],
    });
    expect(spec).not.toBeNull();
    expect(spec!.frameId).toBe("z-gauge");
    expect(typeof spec!.options!.value).toBe("number");
    expect(spec!.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("freezeSnapshot resolves a frame recipe to a frozen ChartSpec (the build seam)", async () => {
    // A pure-frame project: no chart refs → the saved_charts DB call is skipped,
    // so the db arg is never touched. This exercises the actual build path:
    // recipe → loadParsedBrain → bindFrameSpec → frozen ResolvedFrameItem.
    const items: ProjectItem[] = [
      {
        kind: "frame",
        id: "f1",
        added_at: "2026-06-11T00:00:00Z",
        origin: "web",
        brain_id: "env-swfl",
        frame_id: "composition",
        metric_keys: ["swfl_sfha_pct_area_weighted"],
        title: "Flood-zone coverage",
      },
    ];
    const snap = await freezeSnapshot({} as unknown as SupabaseClient, items);
    expect(snap).toHaveLength(1);
    const frame = snap[0];
    expect(frame.kind).toBe("frame");
    if (frame.kind !== "frame") throw new Error("expected a frame");
    expect(frame.chart_spec.frameId).toBe("composition");
    expect(frame.chart_spec.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((frame.chart_spec.options!.segments as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(frame.freshness_token).toBeTruthy();
  });

  test("freezeSnapshot drops a frame whose brain cannot be loaded", async () => {
    const items: ProjectItem[] = [
      {
        kind: "frame",
        id: "f2",
        added_at: "2026-06-11T00:00:00Z",
        origin: "web",
        brain_id: "no-such-brain-xyz",
        frame_id: "z-gauge",
        title: "Missing",
      },
    ];
    const snap = await freezeSnapshot({} as unknown as SupabaseClient, items);
    expect(snap).toHaveLength(0);
  });
});
