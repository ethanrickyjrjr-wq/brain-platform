import { test } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";
import type {
  ActiveListingsResidentialSummary,
  ResidentialStatRow,
} from "../sources/active-listings-residential-source.mts";

process.env["REFINERY_SOURCE"] = "fixture";

const { activeListingsSwfl } = await import("./active-listings-swfl.mts");

const NOW = "2026-06-26T07:17:39Z";

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

// Live shape: data_lake.listing_active_stats returns avg_days_on_market = NULL by design.
// regionDom defaults to null (production reality); pass a number to exercise the future
// list-date DOM lane.
function makeFragment(regionDom: number | null = null): RawFragment {
  const summary: ActiveListingsResidentialSummary = {
    kind: "active-listings-residential-summary",
    region: row(null, null, 10459, 496470, regionDom),
    by_county: [row("Lee", null, 7412, 414900, null), row("Collier", null, 2749, 912000, null)],
    by_zip: [row("Lee", "33993", 722, 399000, null), row("Collier", "34120", 464, 715000, null)],
    latest_scraped_at: NOW,
    source_url: "fixture://listing-active-stats",
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

test("active-listings-swfl: DOM null -> 2 region key_metrics, avg_days_on_market_swfl suppressed (never faked)", () => {
  activeListingsSwfl.corpusSummary!([makeFragment(null)]);
  const result = activeListingsSwfl.outputProducer!({} as never);

  const slugs = result.key_metrics.map((m) => m.metric).sort();
  assert.deepEqual(slugs, ["active_listings_count_swfl", "median_list_price_swfl"]);
  assert.ok(
    !slugs.includes("avg_days_on_market_swfl"),
    "DOM metric must stay suppressed while the view returns null — never fake a value",
  );
  const count = result.key_metrics.find((m) => m.metric === "active_listings_count_swfl");
  assert.equal(count?.value, 10459);
  for (const m of result.key_metrics) {
    assert.ok(m.source?.url, `metric ${m.metric} must carry a source url`);
    assert.ok(m.source?.citation, `metric ${m.metric} must carry a citation`);
  }
});

test("active-listings-swfl: emits avg_days_on_market_swfl ONLY when a real DOM value is present (future list-date lane)", () => {
  activeListingsSwfl.corpusSummary!([makeFragment(118)]);
  const result = activeListingsSwfl.outputProducer!({} as never);

  const slugs = result.key_metrics.map((m) => m.metric).sort();
  assert.deepEqual(slugs, [
    "active_listings_count_swfl",
    "avg_days_on_market_swfl",
    "median_list_price_swfl",
  ]);
  const dom = result.key_metrics.find((m) => m.metric === "avg_days_on_market_swfl");
  assert.equal(dom?.value, 118);
});

test("active-listings-swfl: per-county and per-ZIP rows ride in detail_tables", () => {
  activeListingsSwfl.corpusSummary!([makeFragment()]);
  const result = activeListingsSwfl.outputProducer!({} as never);

  const byCounty = result.detail_tables?.find((t) => t.id === "active_listings_by_county");
  const byZip = result.detail_tables?.find((t) => t.id === "active_listings_by_zip");
  assert.ok(byCounty && byCounty.rows.length === 2, "expected a 2-row by-county table");
  assert.ok(byZip && byZip.rows.length === 2, "expected a 2-row by-ZIP table");
  assert.equal(byZip!.grain, "zip");
  const zip33993 = byZip!.rows.find((r) => r.key === "33993");
  assert.equal(zip33993?.cells.listing_count, 722);
});

test("active-listings-swfl: zero-data path returns neutral with no metrics", () => {
  activeListingsSwfl.corpusSummary!([]);
  const result = activeListingsSwfl.outputProducer!({} as never);
  assert.equal(result.direction, "neutral");
  assert.equal(result.key_metrics.length, 0);
});
