import { describe, expect, it } from "bun:test";
import {
  wantsCustomChart,
  buildHeldChartBlock,
  attachExternalPoints,
  type Menu,
  type MenuPoint,
} from "./compose-chart";
import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import type { ExternalPoint } from "./gap-fill";

describe("wantsCustomChart", () => {
  it("fires on explicit chart verbs", () => {
    expect(wantsCustomChart("Chart vacancy across the corridors")).toBe(true);
    expect(wantsCustomChart("plot median price for these ZIPs")).toBe(true);
    expect(wantsCustomChart("graph permits by month")).toBe(true);
    expect(wantsCustomChart("visualize the rent trend")).toBe(true);
  });
  it("stays off for ordinary analytical questions (no LLM cost)", () => {
    expect(wantsCustomChart("What's the bottom line on SWFL real estate?")).toBe(false);
    expect(wantsCustomChart("How are home values in Naples?")).toBe(false);
    expect(wantsCustomChart("")).toBe(false);
  });
});

describe("buildHeldChartBlock — the structural moat (select rows, never emit cells)", () => {
  // A menu where each corridor carries TWO metrics, so a wrong-COLUMN mispair is
  // even expressible in principle — and we prove the select-rows design can't make one.
  const points: MenuPoint[] = [
    { id: "p0", entity: "Estero", metric: "Vacancy", value: 0.4, unit: "percent", format: "percent", brain: "cre-swfl" }, // prettier-ignore
    { id: "p1", entity: "Cape Coral", metric: "Vacancy", value: 2.2, unit: "percent", format: "percent", brain: "cre-swfl" }, // prettier-ignore
    { id: "p2", entity: "North Fort Myers", metric: "Vacancy", value: 2.6, unit: "percent", format: "percent", brain: "cre-swfl" }, // prettier-ignore
    { id: "p3", entity: "Estero", metric: "Asking Rent", value: 28.5, unit: "usd", format: "usd", brain: "cre-swfl" }, // prettier-ignore
  ];
  const menu: Menu = {
    points,
    byId: new Map(points.map((p) => [p.id, p])),
    numbers: new Set(points.map((p) => p.value)),
    asOf: "2026-06-20",
    citation: "SWFL Data Gulf — cre-swfl",
  };

  it("builds a clean single-metric series from selected ids", () => {
    const block = buildHeldChartBlock(
      { title: "Vacancy by corridor", category_label: "Corridor", point_ids: ["p0", "p1", "p2"], chart_type: "bar" }, // prettier-ignore
      menu,
    );
    expect(block).not.toBeNull();
    expect(block!.rows).toEqual([
      ["Estero", 0.4],
      ["Cape Coral", 2.2],
      ["North Fort Myers", 2.6],
    ]);
    expect(block!.columns[1]).toBe("Vacancy (percent)");
    expect(block!.value_format).toBe("percent");
  });

  it("binds every value to ITS OWN entity — mispairing is not expressible", () => {
    // The model wants Estero=2.6 (North Fort Myers' number). It cannot: it can only
    // select an id, and id p2 is North Fort Myers. Selecting it yields the RIGHT pair.
    const block = buildHeldChartBlock(
      { title: "x", category_label: "Corridor", point_ids: ["p2"], chart_type: "bar" },
      menu,
    );
    expect(block!.rows).toEqual([["North Fort Myers", 2.6]]); // never ["Estero", 2.6]
  });

  it("keeps the wrong-COLUMN value pinned to its true metric", () => {
    // Estero's rent (28.5) and Estero's vacancy (0.4) are DISTINCT points. Selecting
    // the rent point can only produce the rent value — never vacancy's 0.4 in a rent
    // column. Mixed metrics → neutral axis + metric-qualified labels.
    const block = buildHeldChartBlock(
      { title: "x", category_label: "Corridor", point_ids: ["p0", "p3"], chart_type: "bar" },
      menu,
    );
    expect(block!.rows).toEqual([
      ["Estero — Vacancy", 0.4],
      ["Estero — Asking Rent", 28.5],
    ]);
    expect(block!.value_format).toBe("number"); // never claims one $/% across mixed units
  });

  it("drops unknown ids and dedupes", () => {
    const block = buildHeldChartBlock(
      { title: "x", category_label: "Corridor", point_ids: ["p0", "ghost", "p0", "p1"], chart_type: "bar" }, // prettier-ignore
      menu,
    );
    expect(block!.rows).toEqual([
      ["Estero", 0.4],
      ["Cape Coral", 2.2],
    ]);
  });

  it("returns null when no valid point is selected (caller falls back to canned)", () => {
    expect(
      buildHeldChartBlock(
        { title: "x", category_label: "Corridor", point_ids: ["ghost", "nope"], chart_type: "bar" },
        menu,
      ),
    ).toBeNull();
    expect(
      buildHeldChartBlock(
        { title: "x", category_label: "Corridor", point_ids: [], chart_type: "bar" },
        menu,
      ),
    ).toBeNull();
  });
});

describe("attachExternalPoints — gap-fill merge (Increment B)", () => {
  const heldBlock: ChartBlock = {
    title: "Vacancy by corridor",
    columns: ["Corridor", "Vacancy (percent)"],
    rows: [
      ["Estero", 0.4],
      ["Cape Coral", 2.2],
    ],
    chart_type: "bar",
    value_format: "percent",
    asOf: "2026-06-20",
    source: { citation: "SWFL Data Gulf — cre-swfl" },
  };
  const heldNumbers = new Set([0.4, 2.2]);
  const externals: ExternalPoint[] = [
    { label: "Tampa office vacancy", value: 18.4, url: "https://www.colliers.com/tampa", cited_text: "Tampa office vacancy stood at 18.4%" }, // prettier-ignore
  ];

  it("no externals → block + held numbers unchanged", () => {
    const r = attachExternalPoints(heldBlock, [], heldNumbers);
    expect(r.block).toBe(heldBlock);
    expect([...r.numbers].sort()).toEqual([0.4, 2.2]);
  });

  it("appends external rows, footnotes the source host, and EXPANDS the lint anchor", () => {
    const r = attachExternalPoints(heldBlock, externals, heldNumbers);
    expect(r.block.rows).toEqual([
      ["Estero", 0.4],
      ["Cape Coral", 2.2],
      ["Tampa office vacancy", 18.4],
    ]);
    // The gap-filled value is now an allowed anchor (it earned it via citation).
    expect(r.numbers.has(18.4)).toBe(true);
    // Small-print caption lists the external source by host (www. stripped, no path).
    expect(r.block.source?.citation).toContain("SWFL Data Gulf — cre-swfl");
    expect(r.block.source?.citation).toContain(
      "Peer data (web): Tampa office vacancy — colliers.com",
    );
  });
});
