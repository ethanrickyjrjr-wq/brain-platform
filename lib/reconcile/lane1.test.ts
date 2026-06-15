import { test, expect } from "bun:test";
import { factFromParsedBrain, lookupLakeFact } from "./lane1";
import { expiresFor } from "../../refinery/lib/freshness.mts";
import type { ParsedBrain } from "../../refinery/render/speaker.mts";
import type {
  BrainOutput,
  BrainOutputMetric,
  BrainOutputDetailTable,
} from "../../refinery/types/brain-output.mts";

// --- fixture factories (lane_source: synthetic; no disk, no live brain) ------

function metric(slug: string, label: string, value: number | string): BrainOutputMetric {
  const numeric = typeof value === "number";
  return {
    metric: slug,
    value,
    direction: "stable",
    label,
    variable_type: numeric ? "intensive" : "categorical",
    ...(numeric ? { units: "USD" } : {}),
    source: {
      url: "https://www.swfldatagulf.com/r/test",
      fetched_at: "2026-06-10T12:00:00Z",
      tier: 2,
      citation: "Test source",
    },
  };
}

function zipTable(slug: string, label: string, zip: string, value: number): BrainOutputDetailTable {
  return {
    id: "by_zip",
    title: "By ZIP",
    grain: "zip",
    columns: [{ id: slug, label, display_format: "currency", units: "USD" }],
    rows: [{ key: zip, label: zip, cells: { [slug]: value } }],
    source: {
      url: "https://www.swfldatagulf.com/r/test#zip",
      fetched_at: "2026-06-10T12:00:00Z",
      tier: 2,
      citation: "Test ZIP source",
    },
  };
}

function makeBrain(
  brain_id: string,
  refined_at: string,
  key_metrics: BrainOutputMetric[],
  extra: Partial<BrainOutput> = {},
): ParsedBrain {
  const output: BrainOutput = {
    brain_id,
    version: 1,
    refined_at,
    direction: "neutral",
    magnitude: 0.5,
    drivers: [],
    overrides: [],
    conclusion: "test conclusion",
    key_metrics,
    caveats: [],
    contradicts: [],
    confidence: 0.8,
    joint_integrity: 1,
    confidence_dispersion: 0,
    chain_depth: 0,
    trust_tier: 2,
    upstream_count: 0,
    relevance: { decay_curve: "days", half_life_hours: 720, computed_at: refined_at },
    ...extra,
  };
  return {
    brain_id,
    version: 1,
    freshness_token: "SWFL-7421-v1-20260610",
    scope: "test",
    refined_at,
    output,
    raw_md: "",
  };
}

const REFINED = "2026-06-10T12:00:00Z";
const HOUSING_TTL = 86400 * 35; // housing-swfl catalog ttl_seconds

// --- expires derivation (B1/B2/R2) ------------------------------------------

test("cataloged brain, unstamped → expires DERIVED via BRAIN_CATALOG.find", () => {
  const brain = makeBrain("housing-swfl", REFINED, [
    metric("median_sale_price", "Median sale price", 362000),
  ]);
  const fact = factFromParsedBrain("housing-swfl", brain, "Median sale price");
  expect(fact).not.toBeNull();
  expect(fact!.metric_slug).toBe("median_sale_price");
  expect(fact!.value).toBe(362000);
  expect(fact!.expires).toBe(expiresFor(REFINED, HOUSING_TTL));
});

test("a stamped output.expires wins over derivation", () => {
  const brain = makeBrain(
    "housing-swfl",
    REFINED,
    [metric("median_sale_price", "Median sale price", 362000)],
    { expires: "2026-09-09T00:00:00Z" },
  );
  const fact = factFromParsedBrain("housing-swfl", brain, "median_sale_price");
  expect(fact!.expires).toBe("2026-09-09T00:00:00Z");
});

test("uncataloged brain, unstamped → expires undefined (→ not_found downstream)", () => {
  const brain = makeBrain("home-values-swfl", REFINED, [
    metric("median_sale_price", "Median sale price", 362000),
  ]);
  const fact = factFromParsedBrain("home-values-swfl", brain, "median_sale_price");
  expect(fact).not.toBeNull();
  expect(fact!.expires).toBeUndefined();
});

test("R2 — cataloged brain with garbage refined_at → expires undefined, no throw", () => {
  const brain = makeBrain("housing-swfl", "not-a-date", [
    metric("median_sale_price", "Median sale price", 362000),
  ]);
  let fact;
  expect(() => {
    fact = factFromParsedBrain("housing-swfl", brain, "median_sale_price");
  }).not.toThrow();
  expect(fact!.expires).toBeUndefined();
});

// --- slug resolution --------------------------------------------------------

test("a direct metric-id match resolves without label lookup", () => {
  const brain = makeBrain("housing-swfl", REFINED, [
    metric("median_sale_price", "Median sale price", 362000),
  ]);
  expect(factFromParsedBrain("housing-swfl", brain, "median_sale_price")!.metric_slug).toBe(
    "median_sale_price",
  );
});

test("an ambiguous label → null fact (never guess)", () => {
  const brain = makeBrain("housing-swfl", REFINED, [
    metric("price_a", "Median price", 1),
    metric("price_b", "median  price", 2),
  ]);
  expect(factFromParsedBrain("housing-swfl", brain, "Median price")).toBeNull();
});

test("an unresolvable label → null fact", () => {
  const brain = makeBrain("housing-swfl", REFINED, [
    metric("median_sale_price", "Median sale price", 362000),
  ]);
  expect(factFromParsedBrain("housing-swfl", brain, "nonexistent metric")).toBeNull();
});

// --- per-ZIP structured cell read -------------------------------------------

test("per-ZIP reads the detail-table cell value at zip grain", () => {
  const brain = makeBrain(
    "housing-swfl",
    REFINED,
    [metric("median_sale_price", "Median sale price", 362000)],
    { detail_tables: [zipTable("median_sale_price", "Median sale price", "33908", 489000)] },
  );
  const fact = factFromParsedBrain("housing-swfl", brain, "median_sale_price", "33908");
  expect(fact).not.toBeNull();
  expect(fact!.value).toBe(489000); // the ZIP cell, NOT the 362000 headline
  expect(fact!.grain).toBe("zip");
});

test("per-ZIP with no matching row → null (lake doesn't hold that ZIP)", () => {
  const brain = makeBrain(
    "housing-swfl",
    REFINED,
    [metric("median_sale_price", "Median sale price", 362000)],
    { detail_tables: [zipTable("median_sale_price", "Median sale price", "33908", 489000)] },
  );
  expect(factFromParsedBrain("housing-swfl", brain, "median_sale_price", "99999")).toBeNull();
});

// --- I/O wrapper resilience (B5) --------------------------------------------

test("lookupLakeFact on a missing brain → null (never throws across the boundary)", async () => {
  const fact = await lookupLakeFact("zzz-nonexistent-brain-xyz", "anything");
  expect(fact).toBeNull();
});
