import { test } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";
import type {
  ActiveListingsResidentialSummary,
  ResidentialStatRow,
} from "../sources/active-listings-residential-source.mts";

process.env["REFINERY_SOURCE"] = "fixture";

const { activeListingsSwfl } = await import("./active-listings-swfl.mts");

const NOW = "2026-06-25T12:00:00Z";

function row(
  county: string | null,
  zip: string | null,
  count: number,
  median: number | null,
  dom: number | null,
): ResidentialStatRow {
  return {
    county,
    zip_code: zip,
    listing_count: count,
    median_list_price: median,
    avg_days_on_market: dom,
    avg_list_price: median,
    latest_scraped_at: NOW,
  };
}

function makeFragment(): RawFragment {
  const summary: ActiveListingsResidentialSummary = {
    kind: "active-listings-residential-summary",
    region: row(null, null, 4691, 1295000, 118),
    by_county: [row("Collier", null, 2292, 1695000, 131), row("Lee", null, 2399, 899000, 106)],
    by_zip: [row("Collier", "34102", 412, 6995000, 165), row("Lee", "33908", 174, 749000, 98)],
    latest_scraped_at: NOW,
    source_url: "fixture://active-listings-residential",
  };
  return {
    fragment_id: "active_listings_residential:summary:test",
    source_id: "active_listings_residential",
    source_trust_tier: 2,
    fetched_at: NOW,
    raw: summary,
    normalized: summary,
  } as unknown as RawFragment;
}

test("active-listings-swfl: emits 3 region key_metrics with registered slugs + provenance", () => {
  activeListingsSwfl.corpusSummary!([makeFragment()]);
  const result = activeListingsSwfl.outputProducer!({} as never);

  const slugs = result.key_metrics.map((m) => m.metric).sort();
  assert.deepEqual(slugs, [
    "active_listings_count_swfl",
    "avg_days_on_market_swfl",
    "median_list_price_swfl",
  ]);
  const count = result.key_metrics.find((m) => m.metric === "active_listings_count_swfl");
  assert.equal(count?.value, 4691);
  for (const m of result.key_metrics) {
    assert.ok(m.source?.url, `metric ${m.metric} must carry a source url`);
    assert.ok(m.source?.citation, `metric ${m.metric} must carry a citation`);
  }
});

test("active-listings-swfl: per-county and per-ZIP rows ride in detail_tables", () => {
  activeListingsSwfl.corpusSummary!([makeFragment()]);
  const result = activeListingsSwfl.outputProducer!({} as never);

  const byCounty = result.detail_tables?.find((t) => t.id === "active_listings_by_county");
  const byZip = result.detail_tables?.find((t) => t.id === "active_listings_by_zip");
  assert.ok(byCounty && byCounty.rows.length === 2, "expected a 2-row by-county table");
  assert.ok(byZip && byZip.rows.length === 2, "expected a 2-row by-ZIP table");
  assert.equal(byZip!.grain, "zip");
  const zip34102 = byZip!.rows.find((r) => r.key === "34102");
  assert.equal(zip34102?.cells.listing_count, 412);
});

test("active-listings-swfl: zero-data path returns neutral with no metrics", () => {
  activeListingsSwfl.corpusSummary!([]);
  const result = activeListingsSwfl.outputProducer!({} as never);
  assert.equal(result.direction, "neutral");
  assert.equal(result.key_metrics.length, 0);
});
