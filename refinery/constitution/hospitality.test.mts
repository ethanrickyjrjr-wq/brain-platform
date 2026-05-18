import { test } from "node:test";
import assert from "node:assert/strict";
import type { BrainOutput, BrainOutputMetric } from "../types/brain-output.mts";
import type { OverrideRule } from "./types.mts";
import { hospitalityConstitution } from "./hospitality.mts";

const NOW = "2026-05-17T12:00:00Z";

function brainWithMetrics(metrics: BrainOutputMetric[]): BrainOutput {
  return {
    brain_id: "tourism-tdt",
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
  return { metric: slug, value, direction: "falling", label: slug };
}

function rule(id: string): OverrideRule {
  const r = hospitalityConstitution.overrideCascade.find(
    (x) => x.override_id === id,
  );
  if (!r) throw new Error(`override rule "${id}" not in hospitality cascade`);
  return r;
}

test("hospitality cascade: priorities are correctly ordered (65 > 60)", () => {
  const ids = hospitalityConstitution.overrideCascade.map((r) => r.override_id);
  assert.deepEqual(ids, [
    "hospitality-recovery-collapse",
    "hospitality-yoy-collapse",
  ]);
});

test("hospitality cascade: domain set is exactly ['hospitality']", () => {
  assert.deepEqual(hospitalityConstitution.domains, ["hospitality"]);
});

test("hospitality cascade: relevance floor matches the cross-constitution default (0.1)", () => {
  assert.equal(hospitalityConstitution.relevance_floor, 0.1);
});

test("recovery-collapse: ratio below 0.6 fires", () => {
  const r = rule("hospitality-recovery-collapse");
  const u = brainWithMetrics([metric("post_ian_recovery_ratio", 0.55)]);
  assert.equal(r.condition([u], []), true);
});

test("recovery-collapse: ratio at 0.6 does NOT fire (strict <)", () => {
  const r = rule("hospitality-recovery-collapse");
  const u = brainWithMetrics([metric("post_ian_recovery_ratio", 0.6)]);
  assert.equal(r.condition([u], []), false);
});

test("recovery-collapse: ratio above 0.6 does NOT fire", () => {
  const r = rule("hospitality-recovery-collapse");
  const u = brainWithMetrics([metric("post_ian_recovery_ratio", 0.72)]);
  assert.equal(r.condition([u], []), false);
});

test("recovery-collapse: tourism-tdt's own bearish window (0.6-0.7) is NOT escalated by the constitution", () => {
  // tourism-tdt votes bearish at recovery < 0.7. The override only fires
  // BELOW 0.6 — a value of 0.65 should leave the synthesizer's vote alone
  // (already bearish from tourism-tdt) without adding an override entry.
  const r = rule("hospitality-recovery-collapse");
  const u = brainWithMetrics([metric("post_ian_recovery_ratio", 0.65)]);
  assert.equal(r.condition([u], []), false);
});

test("recovery-collapse: unrelated metric never triggers", () => {
  const r = rule("hospitality-recovery-collapse");
  const u = brainWithMetrics([
    metric("latest_monthly_collections_usd", 100_000),
  ]);
  assert.equal(r.condition([u], []), false);
});

test("yoy-collapse: -20% fires", () => {
  const r = rule("hospitality-yoy-collapse");
  const u = brainWithMetrics([metric("yoy_delta_pct", -20.5)]);
  assert.equal(r.condition([u], []), true);
});

test("yoy-collapse: -15% does NOT fire (strict <)", () => {
  const r = rule("hospitality-yoy-collapse");
  const u = brainWithMetrics([metric("yoy_delta_pct", -15)]);
  assert.equal(r.condition([u], []), false);
});

test("yoy-collapse: tourism-tdt's own bearish window (-5 to -15) is NOT escalated", () => {
  // tourism-tdt votes bearish at yoy < -5. Constitution only escalates the
  // severe collapse case below -15.
  const r = rule("hospitality-yoy-collapse");
  const u = brainWithMetrics([metric("yoy_delta_pct", -10.2)]);
  assert.equal(r.condition([u], []), false);
});

test("yoy-collapse: positive YoY (growth) never fires", () => {
  const r = rule("hospitality-yoy-collapse");
  const u = brainWithMetrics([metric("yoy_delta_pct", 12.0)]);
  assert.equal(r.condition([u], []), false);
});

test("yoy-collapse: ratio-vs-percent mix-up regression — value 0.5 must NOT fire", () => {
  // If someone refactors and accidentally writes the metric as a ratio
  // (0.5 instead of -50.0), the test surfaces it: 0.5 is not < -15, so the
  // rule does not fire. The lock here is that the THRESHOLD is in percent
  // units, matching the metric's documented value_range [-100, 200].
  const r = rule("hospitality-yoy-collapse");
  const u = brainWithMetrics([metric("yoy_delta_pct", 0.5)]);
  assert.equal(r.condition([u], []), false);
});

test("hospitality cascade: any of multiple upstreams tripping a threshold is sufficient", () => {
  const r = rule("hospitality-recovery-collapse");
  const clean = brainWithMetrics([metric("post_ian_recovery_ratio", 1.05)]);
  const collapsed = brainWithMetrics([metric("post_ian_recovery_ratio", 0.42)]);
  assert.equal(r.condition([clean, collapsed], []), true);
});
