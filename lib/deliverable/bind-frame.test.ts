import { describe, expect, test } from "bun:test";
import { bindFrameSpec } from "./bind-frame";
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
