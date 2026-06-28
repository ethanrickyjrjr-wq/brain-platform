import { test, expect } from "bun:test";
import { trendChartSvg, barChartSvg, svgToPng } from "./chart-image";

// QUALITY-BAR conformance for the email chart (docs/email-marketing/QUALITY-BAR-data-deliverables.md).
// These assert the chart reads "pro, not pencil-drawn": gridlines, area fill, multiple
// formatted axis labels, the millions currency branch, MM/YYYY dates, grain-aware title,
// and a source/as-of caption. trendChartSvg is pure (no I/O), so it tests directly.

const pts = [
  { label: "2025-01", value: 410000 },
  { label: "2025-02", value: 1285000 },
  { label: "2025-03", value: 1290000 },
  { label: "2025-04", value: 1310000 },
];

test("draws gridlines + an area fill, not a bare baseline", () => {
  const svg = trendChartSvg(pts, { title: "Median price", accent: "#1BB8C9" });
  const lineCount = (svg.match(/<line /g) || []).length;
  expect(lineCount).toBeGreaterThanOrEqual(4); // multiple gridlines, not one baseline
  expect(svg).toMatch(/<path[^>]*fill-opacity/); // area fill under the hero line
});

test("currency uses the millions branch — never $1285K", () => {
  const svg = trendChartSvg(pts, { title: "x", accent: "#000", valueFormat: "usd" });
  expect(svg).toContain("$1.3M");
  expect(svg).not.toContain("1285K");
  expect(svg).not.toContain("1285k");
});

test("YYYY-MM axis labels render as MM/YYYY (Rule 5)", () => {
  const svg = trendChartSvg(pts, { title: "x", accent: "#000" });
  expect(svg).toContain("01/2025");
  expect(svg).not.toContain("2025-01");
});

test("shows 4 evenly-spaced x labels, not just first + last", () => {
  const svg = trendChartSvg(pts, { title: "x", accent: "#000" });
  for (const lbl of ["01/2025", "02/2025", "03/2025", "04/2025"]) {
    expect(svg).toContain(lbl);
  }
});

test("zip-grain title prefixes the ZIP", () => {
  const svg = trendChartSvg(pts, {
    title: "Naples",
    accent: "#000",
    grain: "zip",
    zip_code: "34102",
  });
  expect(svg).toContain("34102 — Naples");
});

test("renders a source · as-of caption with MM/DD/YYYY", () => {
  const svg = trendChartSvg(pts, {
    title: "x",
    accent: "#000",
    source: "Redfin",
    asOf: "2026-06-26",
  });
  expect(svg).toContain("Redfin");
  expect(svg).toContain("06/26/2026");
});

test("barChartSvg draws labeled bars with values via the one currency root", () => {
  const svg = barChartSvg(
    [
      { label: "Median sale price", value: 485000 },
      { label: "Active inventory", value: 1820 },
    ],
    {
      title: "Lee County key metrics",
      accent: "#1BB8C9",
      valueFormat: "usd",
      source: "cre-swfl",
      asOf: "2026-05-31",
    },
  );
  expect(svg).toContain("Lee County key metrics");
  expect(svg).toContain("Median sale price");
  expect(svg).toContain("$485k"); // millions/k branch, not $485000
  const rects = (svg.match(/<rect /g) || []).length;
  expect(rects).toBeGreaterThanOrEqual(4); // bg + (track+fill) per bar
  expect(svg).toContain("05/31/2026"); // caption MM/DD/YYYY
});

// HIGH-RES (P1, prochart-rendering): resvg must rasterize above the SVG's intrinsic
// size so the PNG is crisp on retina. Display width stays logical (ImageBlock caps at
// 600px), so a 2x raster = retina without layout change. PNG pixel dims live in the
// IHDR chunk: width @ byte 16, height @ byte 20 (big-endian uint32, after the 8-byte
// signature + 8-byte chunk header).
function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const MINI_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300">' +
  '<rect width="600" height="300" fill="#ffffff"/></svg>';

test("svgToPng renders at 2x by default (1200x600 from a 600x300 svg)", () => {
  const { width, height } = pngSize(svgToPng(MINI_SVG));
  expect(width).toBe(1200);
  expect(height).toBe(600);
});

test("svgToPng scale:1 keeps the intrinsic size", () => {
  expect(pngSize(svgToPng(MINI_SVG, { scale: 1 })).width).toBe(600);
});

test("svgToPng scale:3 triples the raster", () => {
  expect(pngSize(svgToPng(MINI_SVG, { scale: 3 })).width).toBe(1800);
});

// ANY-COLOR (P1, prochart-rendering): a brand palette is injectable — per-bar series
// colors and the structural grid/axis colors — so a deliverable matches the client's
// brand, not a fixed house palette. Omitting the palette preserves today's look.
test("barChartSvg colors bars from an injected series palette", () => {
  const svg = barChartSvg(
    [
      { label: "A", value: 10 },
      { label: "B", value: 20 },
    ],
    {
      title: "t",
      accent: "#000000",
      series: ["#ff0044", "#0044ff"],
    },
  );
  expect(svg).toContain('fill="#ff0044"');
  expect(svg).toContain('fill="#0044ff"');
});

test("trendChartSvg themes gridlines from an injected grid color", () => {
  const svg = trendChartSvg(pts, { title: "t", accent: "#000", grid: "#abcdef" });
  expect(svg).toContain('stroke="#abcdef"');
});

test("builders fall back to accent + default grid when no palette injected", () => {
  const svg = barChartSvg([{ label: "A", value: 10 }], { title: "t", accent: "#1BB8C9" });
  expect(svg).toContain('fill="#1BB8C9"'); // bar uses accent
  expect(svg).toContain('fill="#EAECEF"'); // default track/grid color
});

// LIVE "NOW" DOT (Task 1, prochart-rendering fork-A): the trend line is held HISTORY through
// its last labeled month; a separately-sourced, web-cited CURRENT value is grafted as a
// distinct "now" dot beyond the line, with a dashed connector and a TWO-SOURCE caption. This
// is mixed-provenance rendering — the held line and the live point come from different sources
// and must read as different, so a viewer never mistakes the last past point for "now".

test("nowPoint draws a distinct live dot with its formatted value", () => {
  const svg = trendChartSvg(pts, {
    title: "Mortgage rate",
    accent: "#3DC9C0",
    valueFormat: "pct",
    nowPoint: { value: 6.9, source: "Freddie Mac", asOf: "2026-06-28" },
  });
  // the live value is labeled on the chart (its own point, not the history endpoint)
  expect(svg).toContain("6.9%");
  // a "now" marker word distinguishes it from the history endpoint
  expect(svg.toLowerCase()).toContain("now");
});

test("nowPoint connects history to the live point with a dashed connector", () => {
  const noNow = trendChartSvg(pts, { title: "x", accent: "#000" });
  const withNow = trendChartSvg(pts, {
    title: "x",
    accent: "#000",
    nowPoint: { value: 99, source: "Redfin", asOf: "2026-06-28" },
  });
  // more dashed segments with the now connector than without (history has no projection here)
  const dashes = (s: string) => (s.match(/stroke-dasharray/g) || []).length;
  expect(dashes(withNow)).toBeGreaterThan(dashes(noNow));
});

test("nowPoint renders a TWO-SOURCE caption (history through date · now date+source)", () => {
  const svg = trendChartSvg(pts, {
    title: "Home value",
    accent: "#3DC9C0",
    source: "Zillow ZHVI",
    asOf: "2026-04-30",
    nowPoint: { value: 350000, source: "Redfin", asOf: "2026-06-28" },
  });
  expect(svg).toContain("Zillow ZHVI"); // history source
  expect(svg).toContain("through");
  expect(svg).toContain("04/30/2026"); // history as-of, MM/DD/YYYY
  expect(svg).toContain("Redfin"); // live source
  expect(svg).toContain("06/28/2026"); // live as-of, MM/DD/YYYY
});

test("no nowPoint → no live marker (regression: history-only output unchanged)", () => {
  const svg = trendChartSvg(pts, {
    title: "x",
    accent: "#000",
    source: "Zillow",
    asOf: "2026-04-30",
  });
  expect(svg.toLowerCase()).not.toContain("now");
  expect(svg).not.toContain("through");
});
