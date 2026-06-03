/**
 * renderDetailRowText (Fix B — ZIP drill). Locks the text-block rendering of a
 * single detail-table row: real numbers in, customer-clean prose out, with the
 * thin-sample caveat and suppressed-cell handling. Pure (no I/O).
 */
import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { renderDetailRowText } from "./fetch-brain.ts";
import type {
  BrainOutputDetailTable,
  BrainOutputDetailRow,
} from "../refinery/types/brain-output.mts";

const TABLE: BrainOutputDetailTable = {
  id: "housing_by_zip",
  title: "SWFL housing by ZIP",
  grain: "zip",
  columns: [
    { id: "metro", label: "Metro area" },
    {
      id: "median_sale_price",
      label: "Median sale price",
      display_format: "currency",
      units: "USD",
    },
    {
      id: "median_sale_price_yoy_pct",
      label: "Median sale price YoY",
      display_format: "percent",
      units: "percent",
    },
    {
      id: "median_dom",
      label: "Median days on market",
      display_format: "count",
      units: "days",
    },
    {
      id: "months_of_supply",
      label: "Months of supply",
      display_format: "raw",
      units: "months",
    },
    {
      id: "homes_sold",
      label: "Homes sold (90-day)",
      display_format: "count",
      units: "count",
    },
    { id: "low_sample", label: "Thin sample (under 5 sales this window)" },
  ],
  rows: [],
  source: {
    url: "https://www.redfin.com/news/data-center/",
    fetched_at: "2026-01-01T00:00:00Z",
    tier: 3,
    citation: "Redfin Data Center — ZIP-level monthly housing metrics.",
  },
};

describe("renderDetailRowText (ZIP drill, Fix B)", () => {
  test("renders the ZIP row with real numbers in the text block", () => {
    const gateway: BrainOutputDetailRow = {
      key: "33913",
      label: "33913",
      cells: {
        metro: "Cape Coral, FL",
        median_sale_price: 500000,
        median_sale_price_yoy_pct: -2.9,
        median_dom: 66,
        months_of_supply: 5.1,
        homes_sold: 297,
        low_sample: false,
      },
    };
    const text = renderDetailRowText(TABLE, gateway, {
      slug: "housing-swfl",
      freshnessToken: "SWFL-7421-v6-20260603",
      origin: "https://www.swfldatagulf.com",
    });
    assert.match(text, /ZIP 33913/);
    assert.match(text, /Cape Coral, FL/);
    assert.match(text, /\$500,000/);
    assert.match(text, /-2\.9%/);
    assert.match(text, /Median days on market: 66/);
    assert.match(text, /SWFL-7421-v6-20260603/);
    assert.match(text, /\/r\/housing-swfl/);
    // The boolean flag column is special-cased, never a bare "...: no" clause.
    assert.ok(!/Thin sample.*: no/.test(text), text);
  });

  test("flags a thin-sample row and omits the suppressed months-of-supply", () => {
    const thin: BrainOutputDetailRow = {
      key: "33918",
      label: "33918",
      cells: {
        metro: "Cape Coral, FL",
        median_sale_price: 303300,
        median_dom: 58,
        months_of_supply: null,
        homes_sold: 1,
        low_sample: true,
      },
    };
    const text = renderDetailRowText(TABLE, thin, {
      slug: "housing-swfl",
      freshnessToken: "SWFL-7421-v6-20260603",
    });
    assert.match(text, /[Tt]hin sample/);
    assert.match(text, /1 sale this period/);
    assert.ok(!/Months of supply:/.test(text), text);
  });
});
