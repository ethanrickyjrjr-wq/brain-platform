import { test } from "bun:test";
import assert from "node:assert/strict";

process.env["REFINERY_SOURCE"] = "fixture";

const { directionFromZScore, propertiesCollierValue } =
  await import("./properties-collier-value.mts");

// Direction rule table — identical thresholds to properties-lee-value
// (bullish z >= +1.0, bearish z <= -1.0, neutral otherwise). Boundary cases
// pin the exact cut-points so the band can't drift.
const RULES: Array<[number | null, "bullish" | "bearish" | "neutral", string]> =
  [
    [3, "bullish", "clearly bullish"],
    [1.0, "bullish", "boundary: exactly +1 sigma -> bullish (>=)"],
    [0.99, "neutral", "just inside band -> neutral"],
    [0, "neutral", "zero -> neutral"],
    [-0.99, "neutral", "just inside band -> neutral (negative)"],
    [-1.0, "bearish", "boundary: exactly -1 sigma -> bearish (<=)"],
    [-3, "bearish", "clearly bearish"],
    [null, "neutral", "null z -> neutral"],
  ];

for (const [z, expected, label] of RULES) {
  test(`directionFromZScore: ${label} (z=${z})`, () => {
    assert.equal(directionFromZScore(z), expected);
  });
}

test("propertiesCollierValue pack: id and domain are stable", () => {
  assert.equal(propertiesCollierValue.id, "properties-collier-value");
  assert.equal(propertiesCollierValue.brain_id, "properties-collier-value");
  assert.equal(propertiesCollierValue.domain, "real-estate");
});

test("propertiesCollierValue pack: no upstream input_brains (leaf node)", () => {
  assert.deepEqual(propertiesCollierValue.input_brains, []);
});

test("propertiesCollierValue pack: deterministic (skipTriageAgent + skipSynthesisAgent)", () => {
  assert.equal(propertiesCollierValue.skipTriageAgent, true);
  assert.equal(propertiesCollierValue.skipSynthesisAgent, true);
});

test("propertiesCollierValue pack: Redfin + FDOR parcel sources wired (tier 2)", () => {
  assert.equal(propertiesCollierValue.sources.length, 2);
  const redfin = propertiesCollierValue.sources.find(
    (s) => s.source_id === "redfin_collier_market",
  );
  assert.ok(redfin, "redfin_collier_market source must be wired");
  assert.equal(redfin!.trust_tier, 2);
  const parcels = propertiesCollierValue.sources.find(
    (s) => s.source_id === "collier_parcels_fdor",
  );
  assert.ok(parcels, "collier_parcels_fdor source must be wired");
  assert.equal(parcels!.trust_tier, 2);
});

test("propertiesCollierValue pack: fixture round-trip produces expected metrics", async () => {
  const { collierMarketSource } =
    await import("../sources/collier-market-source.mts");
  const { collierParcelsSource } =
    await import("../sources/collier-parcels-source.mts");
  const allFragments = [
    ...(await collierMarketSource.fetch()),
    ...(await collierParcelsSource.fetch()),
  ];

  const yearKinds = allFragments.filter(
    (f) => (f.normalized as { kind: string }).kind === "collier-sales-year",
  );
  const summaryKinds = allFragments.filter(
    (f) => (f.normalized as { kind: string }).kind === "collier-summary",
  );
  const parcelKinds = allFragments.filter(
    (f) =>
      (f.normalized as { kind: string }).kind === "collier-parcels-summary",
  );
  assert.ok(yearKinds.length >= 4, "expected at least 4 year fragments");
  assert.equal(summaryKinds.length, 1, "expected exactly one summary fragment");
  assert.equal(
    parcelKinds.length,
    1,
    "expected exactly one parcels-summary fragment",
  );

  propertiesCollierValue.corpusSummary!(allFragments);
  const result = propertiesCollierValue.outputProducer!({
    pack: propertiesCollierValue,
    version: 1,
    refined_at: new Date().toISOString(),
    citations: [],
    facts: [],
    recentNote: "",
  } as unknown as Parameters<
    NonNullable<typeof propertiesCollierValue.outputProducer>
  >[0]);

  // Fixture engineered so current-year (year-1) homes_sold sits well above the
  // trailing 3yr baseline -> bullish.
  assert.equal(result.direction, "bullish");
  assert.ok(
    result.magnitude > 0 && result.magnitude <= 1,
    "magnitude must be in (0, 1]",
  );

  const metricNames = result.key_metrics.map((m) => m.metric);
  assert.ok(metricNames.includes("collier_homes_sold_zscore"));
  assert.ok(metricNames.includes("collier_homes_sold_per_year"));
  assert.ok(metricNames.includes("collier_median_sale_price_yoy"));
  assert.ok(metricNames.includes("collier_months_of_supply"));
  // Parcel-grain parity metrics from the FDOR cadastral source.
  assert.ok(metricNames.includes("collier_soh_gap_median_pct"));
  assert.ok(metricNames.includes("collier_total_parcels"));

  // Parcel fixture has 5 parcels (4 homesteaded); SOH gaps [20,30,3.33,28] -> median 24.
  const totalParcels = result.key_metrics.find(
    (m) => m.metric === "collier_total_parcels",
  );
  assert.equal(
    totalParcels!.value,
    5,
    "total_parcels must count all fixture parcels",
  );
  const sohGap = result.key_metrics.find(
    (m) => m.metric === "collier_soh_gap_median_pct",
  );
  assert.equal(sohGap!.value, 24, "SOH gap median over homesteaded parcels");

  // Property-type filter check: only "All Residential" rows count toward
  // velocity. The fixture plants a Condo/Co-op row with homes_sold=99999 in the
  // current year that MUST be excluded — so the current-year count is exactly
  // the All Residential figure (12000), not inflated.
  const perYear = result.key_metrics.find(
    (m) => m.metric === "collier_homes_sold_per_year",
  );
  assert.equal(
    perYear!.value,
    12000,
    "non-headline property types must be filtered out of velocity",
  );

  // Collier-only scope caveat must be present (no SWFL-wide claim).
  assert.ok(
    result.caveats.some((c) => /collier county only|collier only/i.test(c)),
    "Collier-only scope caveat must surface in OUTPUT",
  );
  // Market-grain / no-SOH caveat must be present (honesty about the source).
  assert.ok(
    result.caveats.some((c) => /market-grain|save-our-homes|assessed/i.test(c)),
    "market-grain (no SOH) caveat must surface in OUTPUT",
  );

  // Leaf node — no upstream-driven arrays.
  assert.deepEqual(result.drivers, []);
  assert.deepEqual(result.contradicts, []);
  assert.deepEqual(result.exogenous_signals, []);
});

test("propertiesCollierValue pack: empty-snapshot path -> neutral + zero-metrics fallback", () => {
  propertiesCollierValue.corpusSummary!([]);
  const result = propertiesCollierValue.outputProducer!({
    pack: propertiesCollierValue,
    version: 1,
    refined_at: new Date().toISOString(),
    citations: [],
    facts: [],
    recentNote: "",
  } as unknown as Parameters<
    NonNullable<typeof propertiesCollierValue.outputProducer>
  >[0]);

  assert.equal(result.direction, "neutral");
  assert.equal(result.magnitude, 0);
  assert.deepEqual(result.key_metrics, []);
  assert.ok(
    result.caveats.some((c) => /no rows/i.test(c)),
    "must surface a 0-row caveat naming the pipeline + grant SQL",
  );
});
