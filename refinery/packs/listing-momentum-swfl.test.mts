import { test } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";
import type { ListingMomentumSummary, MomentumRow } from "../sources/listing-momentum-source.mts";

process.env["REFINERY_SOURCE"] = "fixture";

const { listingMomentumSwfl } = await import("./listing-momentum-swfl.mts");

const NOW = "2026-06-30T07:00:00Z";

function row(
  county: string | null,
  zip: string | null,
  count: number,
  cut: number | null,
  fresh: number | null,
): MomentumRow {
  return {
    county,
    zip_code: zip,
    active_listing_count: count,
    price_reduced_share: cut,
    new_listing_share: fresh,
    latest_scraped_at: NOW,
  };
}

function makeFragment(): RawFragment {
  const summary: ListingMomentumSummary = {
    kind: "listing-momentum-summary",
    region: row(null, null, 27000, 18.5, 9.0),
    by_county: [row("Lee", null, 20000, 20.0, 8.5), row("Collier", null, 7000, 14.2, 10.0)],
    by_zip: [row("Lee", "33901", 800, 22.0, 7.0), row("Collier", "34120", 500, 15.0, 12.0)],
    latest_scraped_at: NOW,
    source_url: "fixture://listing-momentum",
  };
  return {
    fragment_id: "listing_momentum_swfl:summary:test",
    source_id: "listing_momentum_swfl",
    source_trust_tier: 2,
    fetched_at: NOW,
    raw: summary,
    normalized: summary,
  } as unknown as RawFragment;
}

test("listing-momentum-swfl: 2 region share key_metrics with correct values", () => {
  listingMomentumSwfl.corpusSummary!([makeFragment()]);
  const result = listingMomentumSwfl.outputProducer!({} as never);

  const slugs = result.key_metrics.map((m) => m.metric).sort();
  assert.deepEqual(slugs, ["new_listing_share_swfl", "price_reduced_share_swfl"]);
  assert.equal(
    result.key_metrics.find((m) => m.metric === "price_reduced_share_swfl")?.value,
    18.5,
  );
  assert.equal(result.key_metrics.find((m) => m.metric === "new_listing_share_swfl")?.value, 9.0);
  for (const m of result.key_metrics) {
    assert.ok(m.source?.url, `metric ${m.metric} must carry a source url`);
    assert.ok(m.source?.citation, `metric ${m.metric} must carry a citation`);
  }
});

test("listing-momentum-swfl: per-county and per-ZIP shares ride in detail_tables", () => {
  listingMomentumSwfl.corpusSummary!([makeFragment()]);
  const result = listingMomentumSwfl.outputProducer!({} as never);

  const byCounty = result.detail_tables?.find((t) => t.id === "listing_momentum_by_county");
  const byZip = result.detail_tables?.find((t) => t.id === "listing_momentum_by_zip");
  assert.ok(byCounty && byCounty.rows.length === 2, "expected a 2-row by-county table");
  assert.ok(byZip && byZip.rows.length === 2, "expected a 2-row by-ZIP table");
  assert.equal(byZip!.grain, "zip");
  const lee = byCounty!.rows.find((r) => r.key === "Lee");
  assert.equal(lee?.cells.price_reduced_share, 20.0);
});

test("listing-momentum-swfl: zero-data path returns neutral with no metrics", () => {
  listingMomentumSwfl.corpusSummary!([]);
  const result = listingMomentumSwfl.outputProducer!({} as never);
  assert.equal(result.direction, "neutral");
  assert.equal(result.key_metrics.length, 0);
});
