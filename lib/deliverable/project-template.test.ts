import { describe, expect, test } from "bun:test";
import {
  extractRecipes,
  instantiateTemplate,
  projectTemplateSchema,
  type ProjectTemplate,
} from "./project-template";
import { bindFrameSpec } from "./bind-frame";
import type { ProjectItem } from "../project/items";
import type { BrainOutput, BrainOutputMetric } from "../../refinery/types/brain-output.mts";

// ---------------------------------------------------------------------------
// Minimal brain output fixture helpers (mirrors bind-frame.test.ts pattern)
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

function brain(refined_at: string, extraMetrics: BrainOutputMetric[] = []): BrainOutput {
  return {
    refined_at,
    key_metrics: [
      metric({
        metric: "swfl_sfha_pct_area_weighted",
        value: 0.43,
        label: "SWFL flood zone coverage",
        display_format: "ratio",
      }),
      ...extraMetrics,
    ],
  } as unknown as BrainOutput;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ITEMS_MIXED: ProjectItem[] = [
  // frame item — should survive extractRecipes
  {
    kind: "frame",
    id: "item-frame-1",
    added_at: "2026-01-01T00:00:00Z",
    origin: "web",
    brain_id: "env-swfl",
    frame_id: "composition",
    metric_keys: ["swfl_sfha_pct_area_weighted"],
    title: "Flood Zone Coverage",
  },
  // second frame
  {
    kind: "frame",
    id: "item-frame-2",
    added_at: "2026-01-01T00:00:00Z",
    origin: "mcp",
    brain_id: "housing-swfl",
    title: "Market Comps",
  },
  // non-frame items — should all be dropped by extractRecipes
  {
    kind: "metric",
    id: "item-metric-1",
    added_at: "2026-01-01T00:00:00Z",
    origin: "web",
    report_id: "cre-swfl",
    label: "Vacancy Rate",
    value: "4.8%",
    freshness_token: "SWFL-7421-v5-20260610",
  },
  {
    kind: "note",
    id: "item-note-1",
    added_at: "2026-01-01T00:00:00Z",
    origin: "web",
    text: "Client focus: office sector only.",
  },
  {
    kind: "source",
    id: "item-source-1",
    added_at: "2026-01-01T00:00:00Z",
    origin: "web",
    table: "cre_swfl",
    url: "https://swfldatagulf.com/r/cre-swfl",
    label: "CRE SWFL Brain",
  },
];

const TEMPLATE: ProjectTemplate = {
  id: "tpl-flood-sheet",
  name: "Flood Risk Sheet",
  recipes: [
    {
      brain_id: "env-swfl",
      frame_id: "composition",
      metric_keys: ["swfl_sfha_pct_area_weighted"],
      title: "Flood Zone Coverage",
    },
    {
      brain_id: "housing-swfl",
      title: "Market Comps",
    },
  ],
  scope_type: "zip",
};

// ---------------------------------------------------------------------------
// extractRecipes
// ---------------------------------------------------------------------------

describe("extractRecipes", () => {
  test("returns only frame items — drops metrics, notes, sources", () => {
    const recipes = extractRecipes(ITEMS_MIXED);
    expect(recipes.length).toBe(2);
    expect(recipes.every((r) => "brain_id" in r)).toBe(true);
  });

  test("strips id, added_at, origin, kind from frame items", () => {
    const recipes = extractRecipes(ITEMS_MIXED);
    for (const r of recipes) {
      expect(r).not.toHaveProperty("id");
      expect(r).not.toHaveProperty("added_at");
      expect(r).not.toHaveProperty("origin");
      expect(r).not.toHaveProperty("kind");
    }
  });

  test("preserves brain_id, frame_id, metric_keys, title", () => {
    const recipes = extractRecipes(ITEMS_MIXED);
    const first = recipes[0];
    expect(first.brain_id).toBe("env-swfl");
    expect(first.frame_id).toBe("composition");
    expect(first.metric_keys).toEqual(["swfl_sfha_pct_area_weighted"]);
    expect(first.title).toBe("Flood Zone Coverage");
  });

  test("optional fields absent when not present on the original item", () => {
    const recipes = extractRecipes(ITEMS_MIXED);
    const second = recipes[1]; // housing-swfl has no frame_id or metric_keys
    expect(second.frame_id).toBeUndefined();
    expect(second.metric_keys).toBeUndefined();
  });

  test("preserves recipe order matching input frame order", () => {
    const recipes = extractRecipes(ITEMS_MIXED);
    expect(recipes[0].brain_id).toBe("env-swfl");
    expect(recipes[1].brain_id).toBe("housing-swfl");
  });

  test("returns empty array when no frame items exist", () => {
    const noFrames = ITEMS_MIXED.filter((i) => i.kind !== "frame");
    expect(extractRecipes(noFrames)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// instantiateTemplate
// ---------------------------------------------------------------------------

describe("instantiateTemplate", () => {
  const NOW = "2026-06-11T12:00:00Z";

  test("returns one item per recipe", () => {
    const items = instantiateTemplate(TEMPLATE, NOW, (i) => `t${i}`);
    expect(items.length).toBe(TEMPLATE.recipes.length);
  });

  test("every item has kind=frame", () => {
    const items = instantiateTemplate(TEMPLATE, NOW, (i) => `t${i}`);
    expect(items.every((i) => i.kind === "frame")).toBe(true);
  });

  test("items carry the caller-supplied added_at timestamp", () => {
    const items = instantiateTemplate(TEMPLATE, NOW, (i) => `t${i}`);
    for (const item of items) {
      expect(item.added_at).toBe(NOW);
    }
  });

  test("items carry ids from the supplied idGen", () => {
    const items = instantiateTemplate(TEMPLATE, NOW, (i) => `item-${i}`);
    expect(items[0].id).toBe("item-0");
    expect(items[1].id).toBe("item-1");
  });

  test("items carry brain_id, frame_id, metric_keys, title from recipe", () => {
    const items = instantiateTemplate(TEMPLATE, NOW, (i) => `t${i}`);
    const first = items[0] as Extract<ProjectItem, { kind: "frame" }>;
    expect(first.brain_id).toBe("env-swfl");
    expect(first.frame_id).toBe("composition");
    expect(first.metric_keys).toEqual(["swfl_sfha_pct_area_weighted"]);
    expect(first.title).toBe("Flood Zone Coverage");
  });

  test("optional fields absent when recipe has none", () => {
    const items = instantiateTemplate(TEMPLATE, NOW, (i) => `t${i}`);
    const second = items[1] as Extract<ProjectItem, { kind: "frame" }>;
    expect(second.frame_id).toBeUndefined();
    expect(second.metric_keys).toBeUndefined();
  });

  test("two instantiations at different timestamps get different added_at (no stale date carried)", () => {
    const earlier = "2026-01-01T00:00:00Z";
    const later = "2026-06-11T12:00:00Z";
    const itemsA = instantiateTemplate(TEMPLATE, earlier, (i) => `a${i}`);
    const itemsB = instantiateTemplate(TEMPLATE, later, (i) => `b${i}`);
    expect(itemsA[0].added_at).toBe(earlier);
    expect(itemsB[0].added_at).toBe(later);
    expect(itemsA[0].added_at).not.toBe(itemsB[0].added_at);
  });

  test("items do NOT carry a chart_spec — re-binding is guaranteed at build time", () => {
    const items = instantiateTemplate(TEMPLATE, NOW, (i) => `t${i}`);
    for (const item of items) {
      expect(item).not.toHaveProperty("chart_spec");
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip: extract → instantiate → extract produces same recipes
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  test("extract → instantiate → extract preserves the recipe structure", () => {
    const originalRecipes = extractRecipes(ITEMS_MIXED);
    const tpl: ProjectTemplate = {
      id: "rt",
      name: "Round-trip test",
      recipes: originalRecipes,
    };
    const fresh = instantiateTemplate(tpl, "2026-06-11T00:00:00Z", (i) => `rt${i}`);
    const roundTripped = extractRecipes(fresh);
    expect(roundTripped).toEqual(originalRecipes);
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE CRITERION — "ZIP A → save template → ZIP B → frames re-bind to
// B's data with B's asOf dates."
//
// Proved by binding the SAME template's items against two different BrainOutput
// objects that differ only in refined_at. The instantiated items carry no
// ChartSpec — each call to bindFrameSpec produces a fresh ChartSpec whose asOf
// comes SOLELY from the brain's refined_at at bind time.
// ---------------------------------------------------------------------------

describe("acceptance: re-bind to fresh asOf (ZIP A → ZIP B)", () => {
  const RECIPE_TEMPLATE: ProjectTemplate = {
    id: "tpl-flood",
    name: "Flood Risk Sheet",
    recipes: [
      {
        brain_id: "env-swfl",
        frame_id: "composition",
        metric_keys: ["swfl_sfha_pct_area_weighted"],
        title: "Flood Zone Coverage",
      },
    ],
    scope_type: "zip",
  };

  // ZIP A context: brain data as of 2026-01-01
  const brainA = brain("2026-01-01T00:00:00Z");
  // ZIP B context: same brain structure, refreshed as of 2026-06-01
  const brainB = brain("2026-06-01T00:00:00Z");

  test("instantiating for ZIP A and binding to brainA yields asOf=2026-01-01", () => {
    const itemsA = instantiateTemplate(RECIPE_TEMPLATE, "2026-01-01T10:00:00Z", (i) => `a${i}`);
    const frameItem = itemsA[0] as Extract<ProjectItem, { kind: "frame" }>;
    const spec = bindFrameSpec(brainA, {
      frame_id: frameItem.frame_id,
      metric_keys: frameItem.metric_keys,
      title: frameItem.title,
    });
    expect(spec).not.toBeNull();
    expect(spec?.asOf).toBe("2026-01-01");
  });

  test("instantiating for ZIP B and binding to brainB yields asOf=2026-06-01", () => {
    const itemsB = instantiateTemplate(RECIPE_TEMPLATE, "2026-06-01T10:00:00Z", (i) => `b${i}`);
    const frameItem = itemsB[0] as Extract<ProjectItem, { kind: "frame" }>;
    const spec = bindFrameSpec(brainB, {
      frame_id: frameItem.frame_id,
      metric_keys: frameItem.metric_keys,
      title: frameItem.title,
    });
    expect(spec).not.toBeNull();
    expect(spec?.asOf).toBe("2026-06-01");
  });

  test("ZIP A asOf and ZIP B asOf are different (re-binding proved)", () => {
    const itemsA = instantiateTemplate(RECIPE_TEMPLATE, "2026-01-01T10:00:00Z", (i) => `a${i}`);
    const itemsB = instantiateTemplate(RECIPE_TEMPLATE, "2026-06-01T10:00:00Z", (i) => `b${i}`);

    const frameA = itemsA[0] as Extract<ProjectItem, { kind: "frame" }>;
    const frameB = itemsB[0] as Extract<ProjectItem, { kind: "frame" }>;

    const specA = bindFrameSpec(brainA, {
      frame_id: frameA.frame_id,
      metric_keys: frameA.metric_keys,
      title: frameA.title,
    });
    const specB = bindFrameSpec(brainB, {
      frame_id: frameB.frame_id,
      metric_keys: frameB.metric_keys,
      title: frameB.title,
    });

    expect(specA?.asOf).toBe("2026-01-01");
    expect(specB?.asOf).toBe("2026-06-01");
    expect(specA?.asOf).not.toBe(specB?.asOf);
  });
});

// ---------------------------------------------------------------------------
// Schema round-trip (de)serialization
// ---------------------------------------------------------------------------

describe("projectTemplateSchema round-trip", () => {
  test("parses and re-serializes the template fixture", () => {
    const parsed = projectTemplateSchema.safeParse(TEMPLATE);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.id).toBe(TEMPLATE.id);
      expect(parsed.data.recipes.length).toBe(TEMPLATE.recipes.length);
      expect(parsed.data.scope_type).toBe("zip");
    }
  });

  test("rejects template with missing name", () => {
    const bad = { id: "x", recipes: [] };
    expect(projectTemplateSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects recipe with missing brain_id", () => {
    const bad = { id: "x", name: "bad", recipes: [{ title: "Oops" }] };
    expect(projectTemplateSchema.safeParse(bad).success).toBe(false);
  });

  test("scope_type is optional", () => {
    const noScope = { id: "x", name: "no scope", recipes: [] };
    const parsed = projectTemplateSchema.safeParse(noScope);
    expect(parsed.success).toBe(true);
  });
});
