import { describe, expect, it } from "bun:test";
import { donutShareSvg } from "./donut-share";
import { extendPalette } from "@/lib/charts/palette";

// String-only assertions (pure, no resvg) — same posture as lib/charts/format.test.ts.
// The resvg rasterize round-trip is a scratch-only proof, never committed here.
describe("donutShareSvg", () => {
  const segments = [
    { label: "Single-family", value: 620 },
    { label: "Condo", value: 240 },
    { label: "Townhome", value: 90 },
    { label: "Mobile", value: 50 },
  ];
  const svg = donutShareSvg(segments, {
    title: "Permits by housing type",
    accent: "#2563EB",
    unit: "permits",
    valueFormat: "count",
    source: "Lee County permits",
    asOf: "2026-05-31",
  });

  it("is a self-contained, email-safe svg string", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("<style");
    expect(svg).not.toContain("foreignObject");
  });

  it("renders the title", () => {
    expect(svg).toContain("Permits by housing type");
  });

  it("draws one arc <path> per segment (>=3 arcs)", () => {
    const paths = svg.match(/<path /g) ?? [];
    expect(paths.length).toBeGreaterThanOrEqual(3);
  });

  it("renders the center total (sum of values, formatted)", () => {
    // 620 + 240 + 90 + 50 = 1000 → count format "1k"
    expect(svg).toContain("1k");
    expect(svg).toContain("permits");
  });

  it("renders a legend label with a formatted value", () => {
    expect(svg).toContain("Single-family");
    expect(svg).toContain("620"); // formatAxisTick count
  });

  it("uses the large-arc flag on a segment spanning >180deg", () => {
    // A single dominant share must render the MAJOR arc, not the minor one.
    const big = donutShareSvg(
      [
        { label: "Dominant", value: 80 },
        { label: "Rest", value: 20 },
      ],
      { title: "Share", accent: "#2563EB" },
    );
    // largeArcFlag = 1 appears in the arc command "A r r 0 1 1"
    expect(big).toMatch(/A [\d.]+ [\d.]+ 0 1 1/);
  });

  it("renders a full ring <circle> when one segment is ~100%", () => {
    const whole = donutShareSvg([{ label: "All", value: 100 }], {
      title: "Whole",
      accent: "#2563EB",
    });
    expect(whole).toContain("<circle");
  });

  it("returns a graceful empty-state svg when total is zero", () => {
    const empty = donutShareSvg([{ label: "None", value: 0 }], {
      title: "Empty",
      accent: "#2563EB",
    });
    expect(empty.startsWith("<svg")).toBe(true);
    expect(empty).toContain("Empty");
  });

  it("escapes data labels", () => {
    const xss = donutShareSvg(
      [
        { label: "A & <B>", value: 10 },
        { label: "C", value: 5 },
      ],
      { title: "T & <U>", accent: "#2563EB" },
    );
    expect(xss).toContain("A &amp; &lt;B&gt;");
    expect(xss).toContain("T &amp; &lt;U&gt;");
  });

  it("uncolored segments get distinct on-brand fills from extendPalette", () => {
    const svg = donutShareSvg(
      [
        { label: "A", value: 40 },
        { label: "B", value: 30 },
        { label: "C", value: 20 },
        { label: "D", value: 10 },
      ],
      { title: "T", accent: "#3dc9c0" },
    );
    // extract every fill="#rrggbb" used on arc paths / legend swatches
    const fills = [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase());
    const seg = extendPalette(["#3dc9c0"], 4, { background: "#ffffff" }).map((c) =>
      c.toLowerCase(),
    );
    for (const c of seg) expect(fills).toContain(c);
    expect(new Set(seg).size).toBe(4); // 4 distinct
  });

  it("explicit segment color still wins", () => {
    const svg = donutShareSvg([{ label: "A", value: 1, color: "#ff0000" }], {
      title: "T",
      accent: "#3dc9c0",
    });
    expect(svg.toLowerCase()).toContain("#ff0000");
  });
});
