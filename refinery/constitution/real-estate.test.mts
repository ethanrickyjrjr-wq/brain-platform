import { test } from "node:test";
import assert from "node:assert/strict";
import type { BrainOutput, BrainOutputMetric } from "../types/brain-output.mts";
import type { OverrideRule } from "./types.mts";
import { realEstateConstitution } from "./real-estate.mts";

const NOW = "2026-05-17T12:00:00Z";

function brainWithMetrics(metrics: BrainOutputMetric[]): BrainOutput {
  return {
    brain_id: "env-swfl",
    version: 1,
    refined_at: NOW,
    direction: "bearish",
    magnitude: 0.7,
    drivers: [],
    overrides: [],
    conclusion: "test fixture",
    key_metrics: metrics,
    caveats: [],
    contradicts: [],
    confidence: 0.8,
    joint_integrity: 1,
    confidence_dispersion: 0,
    chain_depth: 0,
    trust_tier: 1,
    upstream_count: 0,
    relevance: { decay_curve: "weeks", half_life_hours: 720, computed_at: NOW },
    exogenous_signals: [],
  };
}

function metric(slug: string, value: number): BrainOutputMetric {
  return { metric: slug, value, direction: "rising", label: slug };
}

function rule(id: string): OverrideRule {
  const r = realEstateConstitution.overrideCascade.find(
    (x) => x.override_id === id,
  );
  if (!r) throw new Error(`override rule "${id}" not in real-estate cascade`);
  return r;
}

test("real-estate cascade: priorities are correctly ordered (100 > 90 > 80)", () => {
  const ids = realEstateConstitution.overrideCascade.map((r) => r.override_id);
  assert.deepEqual(ids, [
    "exogenous-critical-confirmed",
    "flood-veto",
    "naics-distress-veto",
  ]);
});

test("flood-veto: Lee County V/VE coverage above 0.05 threshold fires", () => {
  const r = rule("flood-veto");
  const u = brainWithMetrics([
    metric("lee_county_ve_zone_pct_area_weighted", 0.0575),
  ]);
  assert.equal(r.condition([u], []), true);
});

test("flood-veto: Collier County V/VE coverage above 0.05 threshold fires", () => {
  const r = rule("flood-veto");
  const u = brainWithMetrics([
    metric("collier_county_ve_zone_pct_area_weighted", 0.07),
  ]);
  assert.equal(r.condition([u], []), true);
});

test("flood-veto: at or below the 0.05 threshold does NOT fire", () => {
  const r = rule("flood-veto");
  const at = brainWithMetrics([
    metric("lee_county_ve_zone_pct_area_weighted", 0.05),
  ]);
  const below = brainWithMetrics([
    metric("lee_county_ve_zone_pct_area_weighted", 0.04),
  ]);
  assert.equal(r.condition([at], []), false);
  assert.equal(r.condition([below], []), false);
});

test("flood-veto: an unrelated metric never triggers the rule", () => {
  const r = rule("flood-veto");
  const u = brainWithMetrics([metric("cap_rate_median", 0.9)]);
  assert.equal(r.condition([u], []), false);
});

test("flood-veto: SWFL aggregate V/VE concept is NOT in the trigger set", () => {
  // env_swfl_ve_zone_coverage_pct is the 6-county aggregate. The rule is
  // intentionally scoped to per-county Lee/Collier reads; aggregating across
  // inland counties would dilute the barrier-island signal. Lock that
  // scoping decision with a regression test.
  const r = rule("flood-veto");
  const u = brainWithMetrics([metric("swfl_ve_zone_pct_area_weighted", 0.9)]);
  assert.equal(r.condition([u], []), false);
});

test("flood-veto: any upstream tripping the threshold is sufficient", () => {
  const r = rule("flood-veto");
  const clean = brainWithMetrics([metric("cap_rate_median", 0.06)]);
  const dirty = brainWithMetrics([
    metric("collier_county_ve_zone_pct_area_weighted", 0.12),
  ]);
  assert.equal(r.condition([clean, dirty], []), true);
});

test("naics-distress-veto: stub still returns false until baseline lands", () => {
  const r = rule("naics-distress-veto");
  assert.equal(r.condition([], []), false);
});
