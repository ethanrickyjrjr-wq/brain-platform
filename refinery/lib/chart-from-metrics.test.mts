/**
 * computeMetricChart — Tier A deterministic "at a glance" chart producer.
 *
 * Turns a BrainOutput into ONE ChartBlock (a bar) computed in code at refinery
 * build time, or null when the brain has no chartable shape. Two sources, in
 * preference order:
 *   1. a cross-sectional detail_table with a single comparable numeric column
 *      (AAL-by-ZIP, median-price-by-ZIP) — the most legible multi-bar chart;
 *   2. else key_metrics grouped by display_format, largest group with >=3
 *      comparable numeric points.
 * Neither yields >=3 comparable numeric points => null (not a failure).
 *
 * Leak discipline: chart labels come from human `label`s, NEVER metric slugs
 * or column ids — so the block can ride the customer-facing DisplayBrain.chart
 * projection without leaking an internal token.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { computeMetricChart } from "./chart-from-metrics.mts";
import { lintChartBlock } from "../validate/chart-block-lint.mts";
import type {
  BrainOutput,
  BrainOutputMetric,
  BrainOutputDetailTable,
} from "../types/brain-output.mts";

const SRC = {
  url: "https://example.test/x",
  fetched_at: "2026-06-01T00:00:00Z",
  tier: 2 as const,
  citation: "test source",
};

function metric(
  partial: Partial<BrainOutputMetric> &
    Pick<BrainOutputMetric, "metric" | "value" | "label" | "variable_type">,
): BrainOutputMetric {
  return {
    direction: "stable",
    source: SRC,
    ...partial,
  } as BrainOutputMetric;
}

function output(partial: Partial<BrainOutput>): BrainOutput {
  return {
    brain_id: "test-brain",
    version: 1,
    refined_at: "2026-06-01T00:00:00Z",
    direction: "mixed",
    magnitude: 0.5,
    drivers: [],
    overrides: [],
    conclusion: "test conclusion",
    key_metrics: [],
    caveats: [],
    contradicts: [],
    confidence: 0.8,
    joint_integrity: 1,
    confidence_dispersion: 0,
    chain_depth: 0,
    trust_tier: 2,
    upstream_count: 0,
    relevance: {
      decay_curve: "weeks",
      half_life_hours: 720,
      computed_at: "2026-06-01T00:00:00Z",
    },
    ...partial,
  } as BrainOutput;
}

// --- null cases ------------------------------------------------------------

test("computeMetricChart: no metrics, no detail_tables -> null", () => {
  assert.equal(computeMetricChart(output({})), null);
});

test("computeMetricChart: fewer than 3 comparable metrics -> null", () => {
  const o = output({
    key_metrics: [
      metric({
        metric: "a",
        value: 1,
        label: "A",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "b",
        value: 2,
        label: "B",
        variable_type: "intensive",
        display_format: "percent",
      }),
    ],
  });
  assert.equal(computeMetricChart(o), null);
});

test("computeMetricChart: categorical metrics are not comparable points", () => {
  const o = output({
    key_metrics: [
      metric({
        metric: "a",
        value: 1,
        label: "A",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "b",
        value: 2,
        label: "B",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "c",
        value: "Bullish",
        label: "Outlook",
        variable_type: "categorical",
      }),
    ],
  });
  // only 2 numeric percent points -> below the >=3 floor -> null
  assert.equal(computeMetricChart(o), null);
});

// --- key_metrics path ------------------------------------------------------

test("computeMetricChart: 3+ same-format metrics -> bar over labels (never slugs)", () => {
  const o = output({
    key_metrics: [
      metric({
        metric: "cap_rate_median",
        value: 6.7,
        label: "Cap rate",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "vacancy_pct",
        value: 4.2,
        label: "Vacancy",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "chargeoff_pct",
        value: 3.1,
        label: "Charge-off",
        variable_type: "intensive",
        display_format: "percent",
      }),
    ],
  });
  const block = computeMetricChart(o);
  assert.ok(block, "expected a chart block");
  assert.equal(block!.chart_type, "bar");
  assert.deepEqual(block!.rows, [
    ["Cap rate", 6.7],
    ["Vacancy", 4.2],
    ["Charge-off", 3.1],
  ]);
  // Labels, not slugs — no internal token rides the projection.
  assert.ok(
    !JSON.stringify(block).includes("cap_rate_median"),
    "chart must use human labels, never metric slugs",
  );
  // Structural + provenance lint passes against its own audited cells.
  const nums = new Set([6.7, 4.2, 3.1]);
  assert.equal(lintChartBlock(block, nums).ok, true);
});

test("computeMetricChart: picks the LARGEST same-format group", () => {
  const o = output({
    key_metrics: [
      metric({
        metric: "p1",
        value: 1,
        label: "P1",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "p2",
        value: 2,
        label: "P2",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "p3",
        value: 3,
        label: "P3",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "d1",
        value: 100,
        label: "D1",
        variable_type: "extensive",
        display_format: "currency",
      }),
      metric({
        metric: "d2",
        value: 200,
        label: "D2",
        variable_type: "extensive",
        display_format: "currency",
      }),
    ],
  });
  const block = computeMetricChart(o);
  assert.ok(block);
  // 3 percent beats 2 currency.
  assert.deepEqual(
    block!.rows.map((r) => r[0]),
    ["P1", "P2", "P3"],
  );
});

// --- detail_table path (preferred) ----------------------------------------

function housingByZip(): BrainOutputDetailTable {
  return {
    id: "housing_by_zip",
    title: "Housing by ZIP",
    grain: "zip",
    columns: [
      {
        id: "median_sale_price",
        label: "Median sale price",
        display_format: "currency",
        units: "USD",
      },
      { id: "note", label: "Note" },
    ],
    rows: [
      {
        key: "33901",
        label: "33901",
        cells: { median_sale_price: 350000, note: "x" },
      },
      {
        key: "33913",
        label: "33913",
        cells: { median_sale_price: 919191, note: "y" },
      },
      {
        key: "34102",
        label: "34102",
        cells: { median_sale_price: 1200000, note: "z" },
      },
    ],
    source: SRC,
  };
}

test("computeMetricChart: PREFERS a detail_table's comparable numeric column", () => {
  const o = output({
    // key_metrics that WOULD chart on their own...
    key_metrics: [
      metric({
        metric: "a",
        value: 1,
        label: "A",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "b",
        value: 2,
        label: "B",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "c",
        value: 3,
        label: "C",
        variable_type: "intensive",
        display_format: "percent",
      }),
    ],
    detail_tables: [housingByZip()],
  });
  const block = computeMetricChart(o);
  assert.ok(block);
  assert.equal(block!.chart_type, "bar");
  // Rows come from the detail table (ZIP -> price), NOT the key_metrics.
  assert.deepEqual(block!.rows, [
    ["33901", 350000],
    ["33913", 919191],
    ["34102", 1200000],
  ]);
  // Columns name the grain + the human column label (never the column id).
  assert.deepEqual(block!.columns, ["ZIP", "Median sale price"]);
  assert.equal(block!.title, "Median sale price by ZIP");
  assert.ok(
    !JSON.stringify(block).includes("median_sale_price"),
    "chart must use the column label, never its id",
  );
});

test("computeMetricChart: detail_table with <3 numeric rows falls back to key_metrics", () => {
  const tbl = housingByZip();
  tbl.rows = tbl.rows.slice(0, 2); // only 2 numeric rows
  const o = output({
    key_metrics: [
      metric({
        metric: "a",
        value: 1,
        label: "A",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "b",
        value: 2,
        label: "B",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "c",
        value: 3,
        label: "C",
        variable_type: "intensive",
        display_format: "percent",
      }),
    ],
    detail_tables: [tbl],
  });
  const block = computeMetricChart(o);
  assert.ok(block);
  // Fell back to the key_metrics group.
  assert.deepEqual(
    block!.rows.map((r) => r[0]),
    ["A", "B", "C"],
  );
});

// --- asOf keystone (self-anchored from the brain's refined_at vintage) -----

test("computeMetricChart: asOf is the date portion of output.refined_at", () => {
  const o = output({
    refined_at: "2026-06-09T14:30:00Z",
    key_metrics: [
      metric({
        metric: "a",
        value: 6.7,
        label: "A",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "b",
        value: 4.2,
        label: "B",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "c",
        value: 3.1,
        label: "C",
        variable_type: "intensive",
        display_format: "percent",
      }),
    ],
  });
  const block = computeMetricChart(o)!;
  assert.equal(block.asOf, "2026-06-09");
  // The emitted block satisfies the keystone lint clean (asOf present + ISO).
  assert.equal(lintChartBlock(block).ok, true);
  assert.equal(lintChartBlock(block).warnings.length, 0);
});

test("computeMetricChart: asOf is set on the detail_table path too", () => {
  const o = output({
    refined_at: "2026-05-20T00:00:00Z",
    detail_tables: [housingByZip()],
  });
  assert.equal(computeMetricChart(o)!.asOf, "2026-05-20");
});

// --- value_format hint (drives the renderer's numeric formatter) -----------

test("computeMetricChart: a percent key_metrics group -> value_format 'percent'", () => {
  const o = output({
    key_metrics: [
      metric({
        metric: "a",
        value: 6.7,
        label: "A",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "b",
        value: 4.2,
        label: "B",
        variable_type: "intensive",
        display_format: "percent",
      }),
      metric({
        metric: "c",
        value: 3.1,
        label: "C",
        variable_type: "intensive",
        display_format: "percent",
      }),
    ],
  });
  assert.equal(computeMetricChart(o)!.value_format, "percent");
});

test("computeMetricChart: a currency key_metrics group -> value_format 'usd'", () => {
  const o = output({
    key_metrics: [
      metric({
        metric: "a",
        value: 100,
        label: "A",
        variable_type: "extensive",
        display_format: "currency",
      }),
      metric({
        metric: "b",
        value: 200,
        label: "B",
        variable_type: "extensive",
        display_format: "currency",
      }),
      metric({
        metric: "c",
        value: 300,
        label: "C",
        variable_type: "extensive",
        display_format: "currency",
      }),
    ],
  });
  assert.equal(computeMetricChart(o)!.value_format, "usd");
});

test("computeMetricChart: a currency detail_table column -> value_format 'usd'", () => {
  const o = output({ detail_tables: [housingByZip()] });
  assert.equal(computeMetricChart(o)!.value_format, "usd");
});

// --- legibility cap (no 125-bar charts) ------------------------------------

test("computeMetricChart: caps a large detail_table to the top 12 by value, sorted desc", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({
    key: `z${i}`,
    label: `Z${i}`,
    cells: { v: (i + 1) * 1000 },
  }));
  const tbl: BrainOutputDetailTable = {
    id: "t",
    title: "T",
    grain: "zip",
    columns: [{ id: "v", label: "Value", display_format: "currency", units: "USD" }],
    rows,
    source: SRC,
  };
  const block = computeMetricChart(output({ detail_tables: [tbl] }))!;
  assert.equal(block.rows.length, 12);
  assert.equal(block.rows[0][1], 15000); // highest first
  assert.equal(block.rows[11][1], 4000); // top-12 cutoff
  assert.match(block.title, /top 12/i); // honest truncation marker
});

test("computeMetricChart: caps a large key_metrics group to the first 12 (preserves source order)", () => {
  const km = Array.from({ length: 15 }, (_, i) =>
    metric({
      metric: `m${i}`,
      value: i,
      label: `M${i}`,
      variable_type: "intensive",
      display_format: "count",
    }),
  );
  const block = computeMetricChart(output({ key_metrics: km }))!;
  assert.equal(block.rows.length, 12);
  assert.deepEqual(block.rows.map((r) => r[0]).slice(0, 3), ["M0", "M1", "M2"]);
  assert.match(block.title, /top 12/i);
});
