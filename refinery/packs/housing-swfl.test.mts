/**
 * housing-swfl helper unit tests. Lock the two side-bug fixes and the
 * thin-sample guard that shipped with the per-ZIP detail-table fix:
 *  - formatDayDelta: MEDIAN_DOM_YOY is ABSOLUTE DAYS, never ×100 a percent
 *    (the "650.0% YoY" regression).
 *  - monthsOfSupply: derived inventory ÷ 90-day sales pace, SUPPRESSED on
 *    thin-sample ZIPs (a 1–4 sale denominator produces nonsense).
 *  - aggregateMonthsOfSupply: a TRUE regional absorption rate, robust to the
 *    thin-ZIP long tail (not a median of per-ZIP ratios).
 *  - isLowSample: flags a row that rests on too few sales to quote as a median.
 */
import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  monthsOfSupply,
  aggregateMonthsOfSupply,
  formatDayDelta,
  isLowSample,
} from "./housing-swfl.mts";
import type { HousingZipRow } from "../sources/housing-source.mts";

function row(p: Partial<HousingZipRow>): HousingZipRow {
  return {
    zip_code: "00000",
    period_begin: "2026-01-01",
    period_end: "2026-03-31",
    parent_metro_region: "Cape Coral, FL",
    median_sale_price: null,
    median_list_price: null,
    median_ppsf: null,
    median_dom: null,
    avg_sale_to_list: null,
    sold_above_list: null,
    price_drops: null,
    off_market_in_two_weeks: null,
    homes_sold: null,
    inventory: null,
    months_of_supply: null,
    pending_sales: null,
    median_sale_price_yoy: null,
    median_sale_price_mom: null,
    median_dom_yoy: null,
    inventory_yoy: null,
    avg_sale_to_list_yoy: null,
    ...p,
  };
}

describe("housing-swfl helpers", () => {
  describe("formatDayDelta — guards the 650%-YoY units bug", () => {
    test("renders signed days, never a percent", () => {
      assert.equal(formatDayDelta(-11), "-11 days");
      assert.equal(formatDayDelta(6.5), "+6.5 days");
      assert.equal(formatDayDelta(148.5), "+148.5 days");
      assert.equal(formatDayDelta(0), "0 days");
      assert.equal(formatDayDelta(1), "+1 day");
      assert.equal(formatDayDelta(-1), "-1 day");
    });
  });

  describe("monthsOfSupply — per-ZIP, derived", () => {
    test("derives inventory*3/homes_sold for a healthy sample (33913)", () => {
      const m = monthsOfSupply(row({ inventory: 503, homes_sold: 297 }));
      assert.ok(m !== null);
      assert.ok(Math.abs((m as number) - 5.08) < 0.01, `got ${m}`);
    });
    test("suppresses derivation for a thin sample (< 5 sales)", () => {
      assert.equal(monthsOfSupply(row({ inventory: 60, homes_sold: 2 })), null);
      assert.equal(monthsOfSupply(row({ inventory: 60, homes_sold: 4 })), null);
    });
    test("prefers a published value when Redfin provides one", () => {
      assert.equal(
        monthsOfSupply(
          row({ months_of_supply: 4.2, inventory: 9999, homes_sold: 1 }),
        ),
        4.2,
      );
    });
    test("null when inputs are missing", () => {
      assert.equal(
        monthsOfSupply(row({ inventory: null, homes_sold: 100 })),
        null,
      );
    });
  });

  describe("aggregateMonthsOfSupply — regional absorption, outlier-robust", () => {
    test("aggregates inventory and sales rather than averaging ratios", () => {
      const m = aggregateMonthsOfSupply([
        row({ inventory: 100, homes_sold: 30 }),
        row({ inventory: 50, homes_sold: 10 }),
      ]);
      // (150 * 3) / 40 = 11.25
      assert.ok(
        m !== null && Math.abs((m as number) - 11.25) < 1e-9,
        `got ${m}`,
      );
    });
    test("a thin-sample ZIP does not blow up the regional figure", () => {
      const m = aggregateMonthsOfSupply([
        row({ inventory: 1000, homes_sold: 300 }),
        row({ inventory: 60, homes_sold: 2 }), // 90 months as a raw ratio
      ]);
      // aggregate stays sane (~10.5), not dragged toward the 90-month outlier
      assert.ok(m !== null && (m as number) < 12, `got ${m}`);
    });
    test("null when no row has a real sales count", () => {
      assert.equal(
        aggregateMonthsOfSupply([row({ inventory: 100, homes_sold: 0 })]),
        null,
      );
    });
  });

  describe("isLowSample", () => {
    test("flags fewer than 5 sales (incl. missing)", () => {
      assert.equal(isLowSample(row({ homes_sold: 2 })), true);
      assert.equal(isLowSample(row({ homes_sold: 4 })), true);
      assert.equal(isLowSample(row({ homes_sold: 5 })), false);
      assert.equal(isLowSample(row({ homes_sold: 297 })), false);
      assert.equal(isLowSample(row({ homes_sold: null })), true);
    });
  });
});
