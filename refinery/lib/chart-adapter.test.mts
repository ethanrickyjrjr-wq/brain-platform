/**
 * formatChartValue — maps a ChartBlock's `value_format` hint to a display
 * string. The single formatter both the HBar renderer and any table fallback
 * use, so a 6.7% cap rate never renders as "$6.70" and a $500,000 median never
 * renders as "$500000.00". The legacy "currency"/"aal" outputs are preserved
 * verbatim so existing charts (asking-rent, flood) do not shift.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { formatChartValue, adaptToHBar } from "./chart-adapter.mts";
import type { ChartBlock } from "../validate/chart-block-lint.mts";

test("formatChartValue: currency keeps the legacy $X.XX (asking-rent)", () => {
  assert.equal(formatChartValue("currency", 28.5), "$28.50");
});

test("formatChartValue: aal keeps the legacy $X,XXX/yr (flood)", () => {
  assert.equal(formatChartValue("aal", 30074), "$30,074/yr");
});

test("formatChartValue: usd is a comma-grouped dollar amount, no cents", () => {
  assert.equal(formatChartValue("usd", 500000), "$500,000");
  assert.equal(formatChartValue("usd", 1200000), "$1,200,000");
});

test("formatChartValue: percent appends %, one decimal", () => {
  assert.equal(formatChartValue("percent", 6.7), "6.7%");
  assert.equal(formatChartValue("percent", 4), "4%");
});

test("formatChartValue: count is a comma-grouped integer", () => {
  assert.equal(formatChartValue("count", 12953), "12,953");
});

test("formatChartValue: number keeps up to two decimals", () => {
  assert.equal(formatChartValue("number", 1.234), "1.23");
  assert.equal(formatChartValue("number", 5), "5");
});

test("formatChartValue: undefined hint falls back to currency (legacy default)", () => {
  assert.equal(formatChartValue(undefined, 28.5), "$28.50");
});

test("adaptToHBar: threads block.value_format onto the HBar props", () => {
  const block: ChartBlock = {
    title: "Median sale price by ZIP",
    columns: ["ZIP", "Median sale price"],
    rows: [
      ["33901", 350000],
      ["33913", 919191],
      ["34102", 1200000],
    ],
    chart_type: "bar",
    value_format: "usd",
  };
  const props = adaptToHBar(block);
  assert.equal(props.valueFormat, "usd");
  assert.equal(props.corridors.length, 3);
});

test("adaptToHBar: omitted value_format leaves valueFormat undefined (renderer default)", () => {
  const block: ChartBlock = {
    title: "x",
    columns: ["a", "b"],
    rows: [
      ["p", 1],
      ["q", 2],
      ["r", 3],
    ],
    chart_type: "bar",
  };
  assert.equal(adaptToHBar(block).valueFormat, undefined);
});
