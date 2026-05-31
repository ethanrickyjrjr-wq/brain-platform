import { test } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";
import type { RswAirportNormalized } from "../sources/rsw-airport-source.mts";

process.env["REFINERY_SOURCE"] = "fixture";

const { rswAirport } = await import("./rsw-airport.mts");
const { rswAirportSource } = await import("../sources/rsw-airport-source.mts");

const NOW = "2026-05-30T00:00:00Z";

function makeFragment(
  airport_code: string,
  metric: string,
  value: number,
  yoy_pct_change: number | null,
  report_month: string,
): RawFragment<RswAirportNormalized> {
  const normalized: RswAirportNormalized = {
    kind: "rsw-airport-row",
    report_month,
    airport_code,
    metric,
    value,
    yoy_pct_change,
    period_label: report_month,
    source_url: "https://www.flylcpa.com/about/statistics",
  };
  return {
    fragment_id: `rsw_airport_monthly:${airport_code}-${metric}-${report_month}`,
    source_id: "rsw_airport_monthly",
    source_trust_tier: 1,
    fetched_at: NOW,
    raw: {},
    normalized,
  };
}

// ── Test 1: fixture source returns rows ───────────────────────────────────────

test("rsw-airport: fixture source returns > 0 fragments", async () => {
  const fragments = await rswAirportSource.fetch();
  assert.ok(fragments.length > 0, "expected fixture fragments");
  assert.equal(fragments[0].source_id, "rsw_airport_monthly");
  const norm = fragments[0].normalized as RswAirportNormalized;
  assert.equal(norm.kind, "rsw-airport-row");
  assert.ok(
    norm.report_month.match(/^\d{4}-\d{2}$/),
    "report_month should be YYYY-MM",
  );
  assert.ok(
    ["RSW", "PGD"].includes(norm.airport_code),
    `airport_code should be RSW or PGD, got "${norm.airport_code}"`,
  );
});

// ── Test 2: corpusSummary populates rows ──────────────────────────────────────

test("rsw-airport: corpusSummary extracts rows from fixture", async () => {
  const fragments = await rswAirportSource.fetch();
  const summary = rswAirport.corpusSummary!(fragments);
  // corpusSummary now returns SynthesisFact[] (one summary fact) + sets lastRows closure
  assert.ok(
    summary.length > 0,
    "corpusSummary should return at least one SynthesisFact",
  );
  const fact = summary[0];
  assert.ok(fact.topic, "SynthesisFact should have a topic");
  assert.ok(fact.value, "SynthesisFact should have a value");
  assert.ok(
    Array.isArray(fact.source_fragment_ids),
    "SynthesisFact should have source_fragment_ids",
  );
});

// ── Test 3: outputProducer returns valid BrainOutput shape ────────────────────

test("rsw-airport: outputProducer returns BrainOutput with key_metrics", async () => {
  const fragments = await rswAirportSource.fetch();
  rswAirport.corpusSummary!(fragments); // populate closure state

  const result = rswAirport.outputProducer!(
    {} as Parameters<typeof rswAirport.outputProducer>[0],
  );

  assert.ok(result.key_metrics.length > 0, "should have key_metrics");
  const slugs = result.key_metrics.map((m) => m.metric);
  assert.ok(
    slugs.includes("rsw_monthly_enplanements"),
    "should include rsw_monthly_enplanements",
  );
  assert.ok(
    slugs.includes("rsw_yoy_pct_change"),
    "should include rsw_yoy_pct_change",
  );
  assert.ok(result.conclusion.length > 0, "conclusion should be non-empty");
  assert.ok(result.grain_boundary, "grain_boundary should be set");
});

// ── Test 4: direction is one of the valid enum values ─────────────────────────

test("rsw-airport: direction is a valid BrainOutputDirection", async () => {
  const fragments = await rswAirportSource.fetch();
  rswAirport.corpusSummary!(fragments);

  const result = rswAirport.outputProducer!(
    {} as Parameters<typeof rswAirport.outputProducer>[0],
  );

  const valid = ["bullish", "bearish", "mixed", "neutral"];
  assert.ok(
    valid.includes(result.direction),
    `direction "${result.direction}" is not a valid BrainOutputDirection`,
  );
});

// ── Test 5: direction follows YoY sign ───────────────────────────────────────
// +3.5% YoY → bullish; -2.0% YoY → bearish.

test("rsw-airport: bullish direction from positive YoY", () => {
  const fragments: RawFragment<RswAirportNormalized>[] = [
    makeFragment("RSW", "enplanements", 432456, 3.5, "2026-03"),
    makeFragment("RSW", "enplanements", 418932, null, "2025-03"),
    makeFragment("PGD", "enplanements", 38240, 5.6, "2026-03"),
  ];
  rswAirport.corpusSummary!(fragments);
  const result = rswAirport.outputProducer!(
    {} as Parameters<typeof rswAirport.outputProducer>[0],
  );
  assert.equal(
    result.direction,
    "bullish",
    `positive YoY should yield "bullish", got "${result.direction}"`,
  );
});

test("rsw-airport: bearish direction from negative YoY", () => {
  const fragments: RawFragment<RswAirportNormalized>[] = [
    makeFragment("RSW", "enplanements", 390000, -4.2, "2026-03"),
  ];
  rswAirport.corpusSummary!(fragments);
  const result = rswAirport.outputProducer!(
    {} as Parameters<typeof rswAirport.outputProducer>[0],
  );
  assert.equal(
    result.direction,
    "bearish",
    `negative YoY should yield "bearish", got "${result.direction}"`,
  );
});

// ── Test 6: empty data returns neutral ────────────────────────────────────────

test("rsw-airport: empty fragments returns neutral direction", () => {
  rswAirport.corpusSummary!([]);
  const result = rswAirport.outputProducer!(
    {} as Parameters<typeof rswAirport.outputProducer>[0],
  );
  assert.equal(result.direction, "neutral");
  assert.equal(result.magnitude, 0);
  assert.equal(result.key_metrics.length, 0);
});
