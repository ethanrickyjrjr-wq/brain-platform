import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { renderChart } from "../templates/charts/chart-renderer.ts";
import type { EmailChartSpec } from "../templates/charts/chart-types.ts";

// Section 2 (S2) — email-safe chart renderer. These assert the HARD email
// constraints (no <script>/<canvas>/<style>, inline-only, ≤600px, data escaped)
// hold for every chart type — the rules that silently break a real send if missed.

const SAMPLES: EmailChartSpec[] = [
  {
    type: "bar",
    title: "ZIP vs county",
    data: [
      { label: "33931", value: 60 },
      { label: "Lee County", value: 42 },
    ],
    unit: "%",
  },
  {
    type: "sparkline",
    data: [
      { x: "Jan", y: 10 },
      { x: "Feb", y: 14 },
      { x: "Mar", y: 9 },
      { x: "Apr", y: 18 },
    ],
  },
  { type: "gauge", value: 73, label: "confidence" },
  {
    type: "stacked-bar",
    segments: [
      { label: "Above list", value: 30, color: "#1BB8C9" },
      { label: "Below list", value: 70, color: "#6B7280" },
    ],
  },
  {
    type: "heat-row",
    columnLabels: ["AAL", "Velocity", "SOH gap"],
    rows: [
      { label: "33931", cells: [{ value: 30 }, { value: 12 }, { value: 5 }] },
      { label: "33908", cells: [{ value: 18 }, { value: 22 }, { value: 9 }] },
    ],
  },
];

describe("renderChart — email-safe constraints (all types)", () => {
  for (const spec of SAMPLES) {
    test(`${spec.type}: no script/canvas/style blocks, non-empty`, () => {
      const out = renderChart(spec);
      assert.ok(out.length > 0, "output is empty");
      assert.ok(!/<script/i.test(out), "contains <script>");
      assert.ok(!/<canvas/i.test(out), "contains <canvas>");
      assert.ok(!/<style[\s>]/i.test(out), "contains a <style> block");
      assert.ok(!/\son[a-z]+=/i.test(out), "contains an inline JS event handler");
    });

    test(`${spec.type}: stays within the 600px email column`, () => {
      const out = renderChart({ ...spec, width: 560 } as EmailChartSpec);
      const widths = [...out.matchAll(/(?:max-width|width)[:=]"?\s*(\d+)/g)].map((m) =>
        Number(m[1]),
      );
      for (const w of widths) assert.ok(w <= 600, `width ${w} exceeds 600`);
    });
  }
});

describe("renderChart — width clamping", () => {
  test("oversized width is clamped to 600", () => {
    const out = renderChart({ type: "gauge", value: 50, width: 5000 });
    assert.ok(out.includes("max-width:600px"));
  });

  test("missing/zero width falls back to the 560 default", () => {
    const out = renderChart({ type: "bar", data: [{ label: "x", value: 1 }] });
    assert.ok(out.includes("max-width:560px"));
  });
});

describe("renderChart — data is HTML-escaped (no injection)", () => {
  test("a malicious label is escaped, not rendered as markup", () => {
    const out = renderChart({
      type: "bar",
      data: [{ label: '<img src=x onerror="alert(1)">', value: 5 }],
    });
    assert.ok(!out.includes("<img src=x"), "raw tag leaked through");
    assert.ok(out.includes("&lt;img src=x"), "label was not escaped");
  });

  test("ampersands and quotes in titles are escaped", () => {
    const out = renderChart({
      type: "gauge",
      value: 10,
      title: 'A & B "live"',
    });
    assert.ok(out.includes("A &amp; B &quot;live&quot;"));
  });
});

describe("renderChart — type-specific output", () => {
  test("bar/stacked/heat use HTML tables (most email-compatible)", () => {
    for (const type of ["bar", "stacked-bar", "heat-row"] as const) {
      const spec = SAMPLES.find((s) => s.type === type)!;
      assert.ok(renderChart(spec).includes("<table"), `${type} should use a table`);
    }
  });

  test("sparkline and gauge emit inline SVG", () => {
    assert.ok(renderChart(SAMPLES.find((s) => s.type === "sparkline")!).includes("<svg"));
    assert.ok(renderChart(SAMPLES.find((s) => s.type === "gauge")!).includes("<svg"));
  });

  test("gauge clamps value into 0–100", () => {
    assert.ok(renderChart({ type: "gauge", value: 999 }).includes(">100</text>"));
    assert.ok(renderChart({ type: "gauge", value: -50 }).includes(">0</text>"));
  });

  test("title and subtitle appear when provided", () => {
    const out = renderChart({
      type: "bar",
      title: "My Title",
      subtitle: "My Subtitle",
      data: [{ label: "a", value: 1 }],
    });
    assert.ok(out.includes("My Title"));
    assert.ok(out.includes("My Subtitle"));
  });

  test("theme override changes the accent fill", () => {
    const base = renderChart({ type: "bar", data: [{ label: "a", value: 1 }] });
    const themed = renderChart(
      { type: "bar", data: [{ label: "a", value: 1 }] },
      { accent: "#FF0000" },
    );
    assert.ok(!base.includes("#FF0000"));
    assert.ok(themed.includes("#FF0000"));
  });
});

describe("renderChart — degenerate inputs don't throw", () => {
  test("empty bar data", () => {
    assert.doesNotThrow(() => renderChart({ type: "bar", data: [] }));
  });
  test("empty sparkline data renders a 'No data' note", () => {
    assert.ok(renderChart({ type: "sparkline", data: [] }).includes("No data"));
  });
  test("all-zero bar values don't divide by zero", () => {
    assert.doesNotThrow(() => renderChart({ type: "bar", data: [{ label: "a", value: 0 }] }));
  });
});
