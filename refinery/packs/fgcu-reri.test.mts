import { test } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";
import type { ReriNormalized } from "../sources/fgcu-reri-source.mts";

process.env["REFINERY_SOURCE"] = "fixture";

const { fgcuReri } = await import("./fgcu-reri.mts");
const { fgcuReriSource } = await import("../sources/fgcu-reri-source.mts");

const NOW = "2026-05-29T00:00:00Z";

function makeReriFragment(
  indicator: string,
  county: string,
  pct_change: number,
  report_month = "2026-05",
): RawFragment<ReriNormalized> {
  const normalized: ReriNormalized = {
    kind: "reri-row",
    report_month,
    indicator,
    county,
    pct_change,
    pct_change_unit:
      indicator === "unemployment_rate" ? "percentage points" : "percent",
    source_url: "https://www.fgcu.edu/cob/reri/",
  };
  return {
    fragment_id: `fgcu_reri_indicators:${indicator}-${county}-${report_month}`,
    source_id: "fgcu_reri_indicators",
    source_trust_tier: 1,
    fetched_at: NOW,
    raw: {},
    normalized,
  };
}

// ── Test 1: fixture source returns rows ───────────────────────────────────────

test("fgcu-reri: fixture source returns > 0 fragments", async () => {
  const fragments = await fgcuReriSource.fetch();
  assert.ok(fragments.length > 0, "expected fixture fragments");
  assert.equal(fragments[0].source_id, "fgcu_reri_indicators");
  const norm = fragments[0].normalized as ReriNormalized;
  assert.equal(norm.kind, "reri-row");
  assert.ok(
    norm.report_month.match(/^\d{4}-\d{2}$/),
    "report_month should be YYYY-MM",
  );
});

// ── Test 2: corpusSummary populates expected indicator keys ───────────────────

test("fgcu-reri: corpusSummary extracts indicator rows", async () => {
  const fragments = await fgcuReriSource.fetch();
  const summary = fgcuReri.corpusSummary!(fragments);
  assert.ok(summary.length > 0, "corpusSummary should return rows");
  const indicators = summary.map((s) => (s as ReriNormalized).indicator);
  assert.ok(
    indicators.includes("airport_activity"),
    "should include airport_activity",
  );
  assert.ok(
    indicators.includes("unemployment_rate"),
    "should include unemployment_rate",
  );
});

// ── Test 3: outputProducer returns valid BrainOutput shape ────────────────────

test("fgcu-reri: outputProducer returns BrainOutput with key_metrics", async () => {
  const fragments = await fgcuReriSource.fetch();
  fgcuReri.corpusSummary!(fragments); // populate closure state

  const result = fgcuReri.outputProducer!(
    {} as Parameters<typeof fgcuReri.outputProducer>[0],
  );

  assert.ok(result.key_metrics.length > 0, "should have key_metrics");
  const slugs = result.key_metrics.map((m) => m.metric);
  assert.ok(
    slugs.includes("fgcu_reri_airport_activity_pct_change"),
    "should include airport_activity metric",
  );
  assert.ok(
    slugs.includes("fgcu_reri_unemployment_rate_pct_change"),
    "should include unemployment_rate metric",
  );
  assert.ok(result.conclusion.length > 0, "conclusion should be non-empty");
  assert.ok(result.grain_boundary, "grain_boundary should be set");
});

// ── Test 4: direction is one of the valid enum values ─────────────────────────

test("fgcu-reri: direction is a valid BrainOutputDirection", async () => {
  const fragments = await fgcuReriSource.fetch();
  fgcuReri.corpusSummary!(fragments);

  const result = fgcuReri.outputProducer!(
    {} as Parameters<typeof fgcuReri.outputProducer>[0],
  );

  const valid = ["bullish", "bearish", "mixed", "neutral"];
  assert.ok(
    valid.includes(result.direction),
    `direction "${result.direction}" should be a valid BrainOutputDirection`,
  );
});

// ── Test 5: polarity regression ───────────────────────────────────────────────
//
// Constructs a synthetic month where unemployment_rate pct_change = +5
// (rising unemployment = BEARISH after polarity inversion) and all other
// 7 direct indicators pct_change = +3 (bullish).
//
// Expected direction = "mixed", NOT "up" / "bullish".
// This test uses an INLINE fragment array — NOT the JSON fixture — so the
// directional composition is fully controlled. The fixture is likely
// directionally homogeneous and cannot catch this bug.
// Deleting INVERSE_INDICATORS would break this test immediately.

test("fgcu-reri: polarity regression — rising unemployment = mixed, not bullish", async () => {
  const DIRECT_INDICATORS = [
    "airport_activity",
    "tourist_tax_revenues",
    "taxable_sales",
    "permits_single_family",
    "home_sales_single_family",
    "active_listings_residential",
    "home_prices_single_family",
  ];

  const fragments: RawFragment<ReriNormalized>[] = [
    // unemployment rising: +5pp — should be BEARISH after polarity inversion
    makeReriFragment("unemployment_rate", "swfl", 5),
    // all other direct indicators positive: +3% — should be BULLISH
    ...DIRECT_INDICATORS.map((ind) =>
      makeReriFragment(
        ind,
        ind === "home_prices_single_family" ? "lee" : "swfl",
        3,
      ),
    ),
  ];

  fgcuReri.corpusSummary!(fragments);
  const result = fgcuReri.outputProducer!(
    {} as Parameters<typeof fgcuReri.outputProducer>[0],
  );

  assert.equal(
    result.direction,
    "mixed",
    `Rising unemployment (+5pp) among bullish indicators should yield "mixed", got "${result.direction}". ` +
      `If this fails, INVERSE_INDICATORS polarity map is missing or broken.`,
  );
});
