import { test } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";
import type { ActiveRentalsSummary, RentalStatRow } from "../sources/active-rentals-source.mts";

process.env["REFINERY_SOURCE"] = "fixture";

const { activeRentalsSwfl } = await import("./active-rentals-swfl.mts");
const { summarize } = await import("../sources/active-rentals-source.mts");

const NOW = "2026-07-01T07:00:00Z";

const ROWS: RentalStatRow[] = [
  {
    county: null,
    zip_code: null,
    rental_listing_count: 9393,
    observed_price_min: 485,
    observed_price_max: 12500,
    captured_date: "2026-07-01",
  },
  {
    county: "Lee",
    zip_code: null,
    rental_listing_count: 5211,
    observed_price_min: 550,
    observed_price_max: 9800,
    captured_date: "2026-07-01",
  },
  {
    county: "Collier",
    zip_code: null,
    rental_listing_count: 4182,
    observed_price_min: 485,
    observed_price_max: 12500,
    captured_date: "2026-07-01",
  },
  {
    county: "Lee",
    zip_code: "33901",
    rental_listing_count: 612,
    observed_price_min: 900,
    observed_price_max: 4200,
    captured_date: "2026-07-01",
  },
];

function makeFragment(rows: RentalStatRow[]): RawFragment {
  const summary: ActiveRentalsSummary = summarize(rows, "fixture://active-rentals");
  return {
    fragment_id: "active_rentals_swfl:summary:test",
    source_id: "active_rentals_swfl",
    source_trust_tier: 2,
    fetched_at: NOW,
    raw: summary,
    normalized: summary,
  } as unknown as RawFragment;
}

test("summarize: splits GROUPING SETS rows into region/county/zip by null-ness", () => {
  const s = summarize(ROWS, "u");
  assert.equal(s.region?.rental_listing_count, 9393);
  assert.equal(s.by_county.length, 2);
  assert.equal(s.by_zip.length, 1);
});

test("active-rentals-swfl: ONLY the count headlines (no invented median rent)", () => {
  activeRentalsSwfl.corpusSummary!([makeFragment(ROWS)]);
  const result = activeRentalsSwfl.outputProducer!({} as never);

  const slugs = result.key_metrics.map((m) => m.metric);
  assert.deepEqual(slugs, ["active_rental_listings_count_swfl"]);
  const m = result.key_metrics[0]!;
  assert.equal(m.value, 9393);
  assert.ok(m.source?.url && m.source?.citation, "headline must carry source url + citation");
  // No median/average rent metric — that would blend price.min/price.max into an invented number.
  for (const bad of ["median_rent", "average_rent", "avg_rent"]) {
    assert.ok(!slugs.some((s) => s.includes(bad)), `${bad} must not be a headline metric`);
  }
});

test("active-rentals-swfl: county + ZIP detail tables carry count and observed price range", () => {
  activeRentalsSwfl.corpusSummary!([makeFragment(ROWS)]);
  const result = activeRentalsSwfl.outputProducer!({} as never);

  const byCounty = result.detail_tables?.find((t) => t.id === "active_rentals_by_county");
  assert.ok(byCounty && byCounty.rows.length === 2);
  const lee = byCounty!.rows.find((r) => r.key === "Lee");
  assert.equal(lee?.cells.rental_listing_count, 5211);
  assert.equal(lee?.cells.observed_price_min, 550);
  assert.equal(lee?.cells.observed_price_max, 9800);

  const byZip = result.detail_tables?.find((t) => t.id === "active_rentals_by_zip");
  assert.ok(byZip && byZip.rows.length === 1);
  assert.equal(byZip!.rows[0]?.key, "33901");
});

test("active-rentals-swfl: zero-data path returns neutral with no metrics", () => {
  activeRentalsSwfl.corpusSummary!([]);
  const result = activeRentalsSwfl.outputProducer!({} as never);
  assert.equal(result.direction, "neutral");
  assert.equal(result.key_metrics.length, 0);
});
