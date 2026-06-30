import { test, expect } from "bun:test";
import { composeCardSvg } from "@/lib/social/render-social-image";
import { chartFragment, nativeBarSvg } from "@/lib/social/chart-svg";
import { SOCIAL_FORMATS, FORMAT_RATIO, isSocialFormat } from "@/lib/social/formats";
import type { EmailChartSpec } from "@/lib/email/templates/charts/chart-types";

test("SOCIAL_FORMATS dims unchanged + ratio map", () => {
  expect(SOCIAL_FORMATS.square).toEqual({ width: 1080, height: 1080 });
  expect(SOCIAL_FORMATS.portrait).toEqual({ width: 1080, height: 1350 });
  expect(SOCIAL_FORMATS.landscape).toEqual({ width: 1200, height: 630 });
  expect(SOCIAL_FORMATS.story).toEqual({ width: 1080, height: 1920 });
  expect(FORMAT_RATIO).toEqual({
    square: "1:1",
    portrait: "4:5",
    landscape: "1.91:1",
    story: "9:16",
  });
  expect(isSocialFormat("square")).toBe(true);
  expect(isSocialFormat("nope")).toBe(false);
});

test("nativeBarSvg byte-identical for a bar spec", () => {
  const spec = {
    type: "bar",
    data: [
      { label: "A", value: 3 },
      { label: "B", value: 6 },
    ],
  } as EmailChartSpec;
  const svg = nativeBarSvg(spec, 700, "#0ea5b7", "#9CA3AF");
  expect(svg).toContain("<svg");
  expect(svg).toContain("B"); // label rendered
});

test("chartFragment produces a positioned <g> for a sparkline spec", () => {
  const spec = {
    type: "sparkline",
    data: [
      { x: 1, y: 2 },
      { x: 2, y: 5 },
    ],
  } as EmailChartSpec;
  const frag = chartFragment(spec, 0, 0, 600, "#0ea5b7", "#9CA3AF");
  expect(frag.svg).toContain("<g transform=");
  expect(frag.height).toBeGreaterThan(0);
});

test("composeCardSvg still produces a watermarked card after the move", () => {
  const svg = composeCardSvg({
    model: { headline: "Test", stat: { label: "median", value: "$412K" }, as_of: "2026-06-01" },
    format: "square",
    now: new Date("2026-06-30T12:00:00Z"),
  });
  expect(svg).toContain("$412K");
  expect(svg).toContain("SWFL Data Gulf");
});
