import { describe, it, expect } from "bun:test";
import { harvestMetricItems, EXAMPLE_SCENARIOS, EXAMPLE_SENTINEL_USER_ID } from "./examples";
import { DELIVERABLE_TEMPLATES } from "./assemble";
import { projectItemsSchema } from "../project/items";
import type { BrainOutputMetric } from "../../refinery/types/brain-output.mts";

/**
 * A-4 — the metric-harvest is the pure core: turn a brain's key_metrics into valid
 * `kind:"metric"` ProjectItems carrying the brain's live freshness_token, so the
 * real deliverable engine builds a never-stale, cited example. Unit-tested directly
 * (the build + upsert side runs against a mocked engine/DB in the cron, not here).
 */

const metric = (over: Partial<BrainOutputMetric>): BrainOutputMetric =>
  ({
    metric: "median_sale_price",
    value: 400000,
    direction: "falling",
    label: "SWFL regional median sale price",
    variable_type: "extensive",
    units: "USD",
    display_format: "currency",
    source: {
      url: "https://www.redfin.com/news/data-center/",
      fetched_at: "2026-06-03T15:11:30Z",
      tier: 2,
      citation: "Redfin Data Center — SWFL MSAs",
    },
    ...over,
  }) as BrainOutputMetric;

const ctx = {
  brainId: "housing-swfl",
  freshnessToken: "SWFL-7421-v6-20260603",
  addedAt: "2026-06-03T15:11:30Z",
};

describe("harvestMetricItems", () => {
  it("produces ProjectItems that pass projectItemsSchema", () => {
    const items = harvestMetricItems(
      [metric({}), metric({ metric: "dom", value: 72, label: "Days on market" })],
      ctx,
    );
    const parsed = projectItemsSchema.safeParse(items);
    expect(parsed.success).toBe(true);
  });

  it("stringifies numeric values and maps source.url/citation", () => {
    const [m] = harvestMetricItems([metric({ value: 400000 })], ctx);
    expect(m.kind).toBe("metric");
    if (m.kind !== "metric") throw new Error("kind");
    expect(m.value).toBe("400000");
    expect(m.source_url).toBe("https://www.redfin.com/news/data-center/");
    expect(m.source_label).toBe("Redfin Data Center — SWFL MSAs");
    expect(m.freshness_token).toBe("SWFL-7421-v6-20260603");
    expect(m.report_id).toBe("housing-swfl");
    expect(m.origin).toBe("web");
  });

  it("gives every item a unique id", () => {
    const items = harvestMetricItems(
      [metric({ metric: "a" }), metric({ metric: "b" }), metric({ metric: "c" })],
      ctx,
    );
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("caps the harvest at max (default fuller, never empty)", () => {
    const many = Array.from({ length: 12 }, (_, i) => metric({ metric: `m${i}` }));
    expect(harvestMetricItems(many, ctx, 6)).toHaveLength(6);
    expect(harvestMetricItems(many, ctx).length).toBeGreaterThan(0);
  });

  it("tolerates a metric with no source (omits the optional citation fields)", () => {
    const [m] = harvestMetricItems(
      [metric({ source: undefined as unknown as BrainOutputMetric["source"] })],
      ctx,
    );
    if (m.kind !== "metric") throw new Error("kind");
    expect(m.source_url).toBeUndefined();
    expect(projectItemsSchema.safeParse([m]).success).toBe(true);
  });

  it("returns [] for an empty metric set", () => {
    expect(harvestMetricItems([], ctx)).toEqual([]);
  });
});

describe("EXAMPLE_SCENARIOS registry", () => {
  it("has unique example-* ids", () => {
    const ids = EXAMPLE_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("example-")).toBe(true);
  });

  it("every scenario uses a real template id", () => {
    for (const s of EXAMPLE_SCENARIOS) expect(DELIVERABLE_TEMPLATES.has(s.template)).toBe(true);
  });

  it("names a brain + instruction for each", () => {
    for (const s of EXAMPLE_SCENARIOS) {
      expect(s.brainId.length).toBeGreaterThan(0);
      expect(s.instruction.length).toBeGreaterThan(0);
    }
  });

  it("the sentinel user_id is a valid uuid", () => {
    expect(EXAMPLE_SENTINEL_USER_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
