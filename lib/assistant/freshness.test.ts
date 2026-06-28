import { test, expect } from "bun:test";
import { cadenceForFigure, isStale, parseAsOf, staleFigures, type Cadence } from "./freshness";

// FRESHNESS — "we don't ship old data". A held figure is STALE when its as-of is older
// than its source's PUBLISH cadence allows (interval + a publish-lag grace). Stale → the
// answer path goes to the web lane for the CURRENT cited value instead of shipping ours.
// "Stale" is relative to what the SOURCE publishes, not to "today": a monthly metric held
// at the freshest published month is NOT stale even though that month is ~weeks old.

const TODAY = new Date("2026-06-28T00:00:00Z");

test("parseAsOf reads MM/DD/YYYY (our figure format) and ISO", () => {
  expect(parseAsOf("04/30/2026")?.toISOString().slice(0, 10)).toBe("2026-04-30");
  expect(parseAsOf("2026-05-31")?.toISOString().slice(0, 10)).toBe("2026-05-31");
  expect(parseAsOf("")).toBeNull();
  expect(parseAsOf(undefined)).toBeNull();
  expect(parseAsOf("not a date")).toBeNull();
});

test("cadenceForFigure maps a source/key to how often a newer value is published", () => {
  expect(cadenceForFigure({ source: "Zillow ZHVI", key: "home_value" })).toBe("monthly");
  expect(cadenceForFigure({ source: "Zillow ZORI", key: "rent" })).toBe("monthly");
  expect(cadenceForFigure({ source: "MLS active-listings", key: "active" })).toBe("daily");
  expect(cadenceForFigure({ source: "MLS active-listings", key: "dom" })).toBe("daily");
  expect(cadenceForFigure({ source: "Redfin", key: "county_sale" })).toBe("monthly");
  expect(cadenceForFigure({ source: "U.S. Census ACS", key: "population" })).toBe("annual");
  expect(cadenceForFigure({ source: "Some private brokerage memo" })).toBeNull();
});

test("monthly: our held April is stale on 06/28; the freshest published May is NOT", () => {
  // The exact operator case: lake holds 04/30/2026, source publishes through 05/31/2026.
  expect(isStale("04/30/2026", "monthly", TODAY)).toBe(true); // 59 days → a newer month is out
  expect(isStale("05/31/2026", "monthly", TODAY)).toBe(false); // 28 days → already the freshest
});

test("daily: a few days old is fine; over a week is stale", () => {
  expect(isStale("06/27/2026", "daily", TODAY)).toBe(false);
  expect(isStale("06/20/2026", "daily", TODAY)).toBe(true);
});

test("annual: last year fresh, two years back stale", () => {
  expect(isStale("12/31/2025", "annual", TODAY)).toBe(false);
  expect(isStale("12/31/2024", "annual", TODAY)).toBe(true);
});

test("an unknown/empty as-of is NEVER called stale (no false web hunt)", () => {
  expect(isStale(undefined, "monthly", TODAY)).toBe(false);
  expect(isStale("", "daily", TODAY)).toBe(false);
});

test("staleFigures returns only known-cadence figures whose as-of is behind", () => {
  const figs = [
    { key: "home_value", label: "Median home value", source: "Zillow ZHVI", as_of: "04/30/2026" }, // stale monthly
    { key: "rent", label: "Typical asking rent", source: "Zillow ZORI", as_of: "05/31/2026" }, // fresh monthly
    { key: "active", label: "Active listings", source: "MLS active-listings", as_of: "06/10/2026" }, // stale daily
    { key: "population", label: "Population", source: "U.S. Census ACS", as_of: "12/31/2025" }, // fresh annual
    { key: "x", label: "Private memo figure", source: "broker", as_of: "01/01/2020" }, // unknown cadence → skip
  ];
  const stale = staleFigures(figs, TODAY);
  expect(stale.map((f) => f.key).sort()).toEqual(["active", "home_value"]);
});

// type guard: Cadence is the closed set we rely on for the grace table
test("Cadence covers the registry cadences we map", () => {
  const all: Cadence[] = ["daily", "weekly", "monthly", "quarterly", "annual"];
  expect(all).toContain("monthly");
});
