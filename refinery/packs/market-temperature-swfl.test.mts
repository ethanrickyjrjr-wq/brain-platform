import { test } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";
import type {
  MarketTemperatureSummary,
  MarketDetailRow,
} from "../sources/market-temperature-source.mts";

process.env["REFINERY_SOURCE"] = "fixture";

const { marketTemperatureSwfl } = await import("./market-temperature-swfl.mts");
const { summarize, median } = await import("../sources/market-temperature-source.mts");

const NOW = "2026-06-30T07:00:00Z";

const ROWS: MarketDetailRow[] = [
  {
    zip_code: "33901",
    county: "Lee",
    median_sold_price: 320000,
    median_listing_price: 339900,
    median_rent_price: 1350,
    median_days_on_market: 87,
    median_price_per_sqft: 225,
    local_hotness_score: 54.55,
    list_to_sold_ratio_pct: 94.15,
    sold_to_rent_ratio: 19.75,
    market_strength: "warm",
    is_competitive: false,
    captured_date: "2026-06-30",
  },
  {
    zip_code: "33914",
    county: "Lee",
    median_sold_price: 450000,
    median_listing_price: 475000,
    median_rent_price: 2200,
    median_days_on_market: 90,
    median_price_per_sqft: 260,
    local_hotness_score: 58.0,
    list_to_sold_ratio_pct: 95.0,
    sold_to_rent_ratio: 17.05,
    market_strength: "warm",
    is_competitive: false,
    captured_date: "2026-06-30",
  },
  {
    zip_code: "34120",
    county: "Collier",
    median_sold_price: 550000,
    median_listing_price: 599000,
    median_rent_price: 2800,
    median_days_on_market: 70,
    median_price_per_sqft: 300,
    local_hotness_score: 60.0,
    list_to_sold_ratio_pct: 96.5,
    sold_to_rent_ratio: 16.37,
    market_strength: "warm",
    is_competitive: false,
    captured_date: "2026-06-30",
  },
];

function makeFragment(rows: MarketDetailRow[]): RawFragment {
  const summary: MarketTemperatureSummary = summarize(rows, "fixture://market-temperature");
  return {
    fragment_id: "market_temperature_swfl:summary:test",
    source_id: "market_temperature_swfl",
    source_trust_tier: 2,
    fetched_at: NOW,
    raw: summary,
    normalized: summary,
  } as unknown as RawFragment;
}

test("summarize: region sold-to-rent is the median across ZIPs", () => {
  const s = summarize(ROWS, "u");
  // median([19.75, 17.05, 16.37]) = 17.05
  assert.equal(s.region_sold_to_rent, 17.05);
  assert.equal(s.rows.length, 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([null, 5]), 5);
});

test("market-temperature-swfl: ONLY sold_to_rent_ratio_swfl headlines (no duplicate sold/DOM vote)", () => {
  marketTemperatureSwfl.corpusSummary!([makeFragment(ROWS)]);
  const result = marketTemperatureSwfl.outputProducer!({} as never);

  const slugs = result.key_metrics.map((m) => m.metric);
  assert.deepEqual(slugs, ["sold_to_rent_ratio_swfl"]);
  const m = result.key_metrics[0]!;
  assert.equal(m.value, 17.05);
  assert.ok(m.source?.url && m.source?.citation, "headline must carry source url + citation");
  // The overlapping medians must NOT be headline metrics (they'd double-count in master).
  for (const bad of [
    "median_sold_price",
    "median_days_on_market",
    "local_hotness_score",
    "list_to_sold_ratio_pct",
  ]) {
    assert.ok(!slugs.some((s) => s.includes(bad)), `${bad} must not be a headline metric`);
  }
});

test("market-temperature-swfl: full per-ZIP snapshot rides in the detail table", () => {
  marketTemperatureSwfl.corpusSummary!([makeFragment(ROWS)]);
  const result = marketTemperatureSwfl.outputProducer!({} as never);

  const table = result.detail_tables?.find((t) => t.id === "market_temperature_by_zip");
  assert.ok(table && table.rows.length === 3, "expected a 3-row per-ZIP table");
  const z = table!.rows.find((r) => r.key === "33901");
  assert.equal(z?.cells.median_sold_price, 320000);
  assert.equal(z?.cells.sold_to_rent_ratio, 19.75);
});

test("market-temperature-swfl: zero-data path returns neutral with no metrics", () => {
  marketTemperatureSwfl.corpusSummary!([]);
  const result = marketTemperatureSwfl.outputProducer!({} as never);
  assert.equal(result.direction, "neutral");
  assert.equal(result.key_metrics.length, 0);
});
