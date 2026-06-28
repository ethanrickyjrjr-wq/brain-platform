import { test, expect } from "bun:test";
import { tryParsePatch, dropSuperseded } from "./build-doc";
import type { MarketFigure } from "@/lib/email/market-context";

// The resilient content-patch parser: one over-limit field must NOT nuke the whole
// fill (the bug that returned "try rephrasing" on a real Sonnet response with 4 stats).

test("extracts JSON from a ```json-fenced response", () => {
  const r = tryParsePatch('```json\n{ "b1": { "prose": "hi" } }\n```');
  expect(r).toEqual({ b1: { prose: "hi" } });
});

test("clamps a too-long stats array to 3 instead of rejecting the whole patch", () => {
  const r = tryParsePatch(
    JSON.stringify({
      b1: {
        stats: [
          { value: "1", label: "a" },
          { value: "2", label: "b" },
          { value: "3", label: "c" },
          { value: "4", label: "d" },
          { value: "5", label: "e" },
        ],
      },
    }),
  );
  expect(r).not.toBeNull();
  expect(r!.b1.stats!.length).toBe(3);
});

test("keeps valid blocks and drops only the unsalvageable one", () => {
  // b2's value blows past the 24-char max → b2 dropped, b1 kept (never nuke everything)
  const r = tryParsePatch(JSON.stringify({ b1: { prose: "good" }, b2: { value: "x".repeat(50) } }));
  expect(r).toEqual({ b1: { prose: "good" } });
});

test("strips a style/link key but keeps the block (no-restyle held)", () => {
  const r = tryParsePatch(
    JSON.stringify({ b1: { prose: "ok", bgColor: "#000", url: "http://x" } }),
  );
  expect(r).toEqual({ b1: { prose: "ok" } });
});

test("returns null when there is no JSON object at all", () => {
  expect(tryParsePatch("Sorry, I can't help with that.")).toBeNull();
});

// FRESHNESS: a stale held figure that the web lane refreshed must be DROPPED from the
// held context, so the AI can't see both the stale April number and the fresh web number
// and pick the wrong one. Match is by exact label (the forced request reuses the figure's
// label, so the verified web point carries the same label back).
const figs: MarketFigure[] = [
  {
    key: "home_value",
    label: "Median home value — Cape Coral",
    value: "$390,000",
    source: "Zillow ZHVI",
    as_of: "04/30/2026",
  },
  {
    key: "rent",
    label: "Typical asking rent",
    value: "$2,100/mo",
    source: "Zillow ZORI",
    as_of: "05/31/2026",
  },
  {
    key: "population",
    label: "Population",
    value: "204,000",
    source: "U.S. Census ACS",
    as_of: "12/31/2025",
  },
];

test("dropSuperseded removes held figures the web refreshed, keeps the rest", () => {
  const survivors = dropSuperseded(figs, ["Median home value — Cape Coral"]);
  expect(survivors.map((f) => f.key)).toEqual(["rent", "population"]);
});

test("dropSuperseded is a no-op when nothing was refreshed", () => {
  expect(dropSuperseded(figs, [])).toHaveLength(3);
});

test("dropSuperseded matches by exact label only (no partial collisions)", () => {
  // "Population" must not drop because of an unrelated "Median home value" refresh
  const survivors = dropSuperseded(figs, ["Median home value"]); // not an exact label
  expect(survivors).toHaveLength(3);
});
