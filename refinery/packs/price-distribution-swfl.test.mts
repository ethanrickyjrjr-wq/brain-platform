import { test } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";
import type {
  PriceDistributionSummary,
  PriceDistributionCounty,
} from "../sources/price-distribution-source.mts";

process.env["REFINERY_SOURCE"] = "fixture";

const { priceDistributionSwfl, countyBuckets } = await import("./price-distribution-swfl.mts");

const NOW = "2026-06-30T07:00:00Z";

function county(
  name: string,
  total: number,
  bands: [number, number | null, number][],
): PriceDistributionCounty {
  return {
    county: name,
    total_listings: total,
    bands: bands.map(([band_min, band_max, listing_count]) => ({
      band_min,
      band_max,
      band_range: `${band_min}-${band_max}`,
      listing_count,
    })),
  };
}

// Mirrors refinery/__fixtures__/price-distribution.sample.json.
// Lee total 20000: entry 10000 / mid 5000 / upper 2000 / luxury 3000.
// Collier total 7000: entry 1000 / mid 2500 / upper 1500 / luxury 2000.
const LEE = county("Lee", 20000, [
  [0, 100000, 5000],
  [100000, 200000, 3000],
  [200000, 300000, 2000],
  [300000, 500000, 3000],
  [500000, 600000, 2000],
  [600000, 900000, 1500],
  [900000, 1000000, 500],
  [1000000, 10000000, 2500],
  [10000000, 2147483647, 500],
]);
const COLLIER = county("Collier", 7000, [
  [0, 200000, 500],
  [200000, 300000, 500],
  [300000, 500000, 1000],
  [500000, 600000, 1500],
  [600000, 900000, 1000],
  [900000, 1000000, 500],
  [1000000, 10000000, 1500],
  [10000000, 2147483647, 500],
]);

function makeFragment(counties: PriceDistributionCounty[]): RawFragment {
  const summary: PriceDistributionSummary = {
    kind: "price-distribution-summary",
    captured_date: "2026-06-30",
    counties,
    source_url: "fixture://price-distribution",
  };
  return {
    fragment_id: "price_distribution_swfl:summary:test",
    source_id: "price_distribution_swfl",
    source_trust_tier: 2,
    fetched_at: NOW,
    raw: summary,
    normalized: summary,
  } as unknown as RawFragment;
}

test("countyBuckets: sums bands into affordability tiers by band_min", () => {
  const b = countyBuckets(LEE);
  assert.equal(b.total, 20000);
  assert.equal(b.entry, 10000); // < $300k
  assert.equal(b.mid, 5000); // $300k–$600k
  assert.equal(b.upper, 2000); // $600k–$1M
  assert.equal(b.luxury, 3000); // >= $1M
  assert.equal(b.entry + b.mid + b.upper + b.luxury, b.total);
});

test("price-distribution-swfl: 4 region tier-share key_metrics, correct percentages", () => {
  priceDistributionSwfl.corpusSummary!([makeFragment([LEE, COLLIER])]);
  const result = priceDistributionSwfl.outputProducer!({} as never);

  const slugs = result.key_metrics.map((m) => m.metric).sort();
  assert.deepEqual(slugs, [
    "entry_level_listing_share_swfl",
    "luxury_listing_share_swfl",
    "midmarket_listing_share_swfl",
    "upper_tier_listing_share_swfl",
  ]);

  // Region: total 27000 · entry 11000 (40.7%) · mid 7500 (27.8%) · upper 3500 (13.0%) · luxury 5000 (18.5%)
  const val = (slug: string) => result.key_metrics.find((m) => m.metric === slug)?.value;
  assert.equal(val("entry_level_listing_share_swfl"), 40.7);
  assert.equal(val("midmarket_listing_share_swfl"), 27.8);
  assert.equal(val("upper_tier_listing_share_swfl"), 13.0);
  assert.equal(val("luxury_listing_share_swfl"), 18.5);

  for (const m of result.key_metrics) {
    assert.ok(m.source?.url, `metric ${m.metric} must carry a source url`);
    assert.ok(m.source?.citation, `metric ${m.metric} must carry a citation`);
  }
});

test("price-distribution-swfl: per-county detail table with tier counts + entry share", () => {
  priceDistributionSwfl.corpusSummary!([makeFragment([LEE, COLLIER])]);
  const result = priceDistributionSwfl.outputProducer!({} as never);

  const table = result.detail_tables?.find((t) => t.id === "price_distribution_by_county");
  assert.ok(table && table.rows.length === 2, "expected a 2-row by-county table");
  const lee = table!.rows.find((r) => r.key === "Lee");
  assert.equal(lee?.cells.total_listings, 20000);
  assert.equal(lee?.cells.entry_under_300k, 10000);
  assert.equal(lee?.cells.entry_share, 50.0);
});

test("price-distribution-swfl: zero-data path returns neutral with no metrics", () => {
  priceDistributionSwfl.corpusSummary!([]);
  const result = priceDistributionSwfl.outputProducer!({} as never);
  assert.equal(result.direction, "neutral");
  assert.equal(result.key_metrics.length, 0);
});
