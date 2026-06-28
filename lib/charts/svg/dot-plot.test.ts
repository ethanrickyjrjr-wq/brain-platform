import { test, expect } from "bun:test";
import { dotPlotSvg } from "./dot-plot";

// dot-plot / comparison — "this place vs a reference", two dots on a line per row,
// shared horizontal scale. These assert the real shape renders: the title, a row
// label, value + reference dots (≥2 <circle>), the formatted value via the one
// currency root, and the source · as-of caption in MM/DD/YYYY (Rule 5).

const items = [
  { label: "Median sale price", value: 485000, reference: 410000 },
  { label: "Active inventory", value: 1820, reference: 1500 },
  { label: "Days on market", value: 62, reference: 48 },
];

test("renders the title", () => {
  const svg = dotPlotSvg(items, { title: "Lee vs prior year", accent: "#1BB8C9" });
  expect(svg).toContain("Lee vs prior year");
});

test("renders a row label", () => {
  const svg = dotPlotSvg(items, { title: "x", accent: "#000" });
  expect(svg).toContain("Median sale price");
});

test("draws value + reference dots — at least 2 circles per populated row", () => {
  const svg = dotPlotSvg(items, { title: "x", accent: "#000" });
  const circles = (svg.match(/<circle /g) || []).length;
  // 2 legend dots + (value + reference) per row = 2 + 3*2 = 8
  expect(circles).toBeGreaterThanOrEqual(2);
  expect(circles).toBe(8);
});

test("formats the end value through the one currency root (not raw)", () => {
  const svg = dotPlotSvg(items, { title: "x", accent: "#000", valueFormat: "usd" });
  expect(svg).toContain("$485k");
  expect(svg).not.toContain("485000");
});

test("a row with no reference draws only the value dot", () => {
  const svg = dotPlotSvg([{ label: "Solo", value: 100 }], {
    title: "x",
    accent: "#000",
    valueFormat: "count",
  });
  // 2 legend dots + 1 value dot, no reference dot
  const circles = (svg.match(/<circle /g) || []).length;
  expect(circles).toBe(3);
});

test("legend names the reference label + a clear value label (not 'this')", () => {
  const svg = dotPlotSvg(items, { title: "x", accent: "#000", referenceLabel: "2024" });
  expect(svg).toContain("2024");
  expect(svg).toContain("value"); // default value-dot legend (was the cryptic "this")
});

test("the value-dot legend label is configurable", () => {
  const svg = dotPlotSvg(items, { title: "x", accent: "#000", valueLabel: "Home value" });
  expect(svg).toContain("Home value");
  expect(svg).not.toContain(">this<");
});

// Regression: a long value label must push the reference legend to the right so the
// two don't overlap/scramble (the fixed-x layout broke once "this" became a real metric).
test("reference legend sits after the value label (scales with its length)", () => {
  const legendRefCx = (svg: string) => {
    const m = /<circle cx="([\d.]+)" cy="42" r="5" fill="#ffffff" stroke="#B6BDC6"/.exec(svg);
    return m ? Number(m[1]) : NaN;
  };
  const short = dotPlotSvg(items, { title: "x", accent: "#000", valueLabel: "A" });
  const long = dotPlotSvg(items, { title: "x", accent: "#000", valueLabel: "Median sale price" });
  expect(legendRefCx(long)).toBeGreaterThan(legendRefCx(short));
});

test("renders a source · as-of caption with MM/DD/YYYY (Rule 5)", () => {
  const svg = dotPlotSvg(items, {
    title: "x",
    accent: "#000",
    source: "cre-swfl",
    asOf: "2026-05-31",
  });
  expect(svg).toContain("cre-swfl");
  expect(svg).toContain("05/31/2026");
  expect(svg).not.toContain("2026-05-31");
});

test("caps at 8 rows", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ label: `r${i}`, value: i + 1 }));
  const svg = dotPlotSvg(many, { title: "x", accent: "#000", valueFormat: "count" });
  expect(svg).toContain("r7");
  expect(svg).not.toContain("r8");
});

test("is a self-contained, email-safe svg string (no script/style/canvas)", () => {
  const svg = dotPlotSvg(items, { title: "x", accent: "#000" });
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg.endsWith("</svg>")).toBe(true);
  expect(svg).not.toContain("<script");
  expect(svg).not.toContain("<style");
  expect(svg).not.toContain("<canvas");
});
