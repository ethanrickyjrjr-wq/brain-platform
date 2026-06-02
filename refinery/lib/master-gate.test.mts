// refinery/lib/master-gate.test.mts
import { test } from "bun:test";
import assert from "node:assert/strict";
import { evaluateMasterGate, type MasterGateInput } from "./master-gate.mts";

/** Build a PUBLISH-by-default gate input; override per test to trip a rule. */
function gateInput(overrides: Partial<MasterGateInput> = {}): MasterGateInput {
  return {
    rendered: { confidence: 0.8, upstream_count: 5 },
    priorMasterExists: true,
    criticalHoleIds: new Set<string>(),
    criticalUpstreamIds: new Set<string>(),
    degradedCriticalIds: new Set<string>(),
    ...overrides,
  };
}

// Rule 1 — a critical upstream re-darkened (had a last-good, eligibility expired).
test("HOLD: re-darkened critical hole", () => {
  const decision = evaluateMasterGate(
    gateInput({
      criticalHoleIds: new Set(["env-swfl"]),
      criticalUpstreamIds: new Set(["env-swfl"]),
    }),
  );
  assert.equal(decision, "HOLD");
});

// not-yet-online — a never-built critical upstream is non-blocking (no hole).
test("PUBLISH: never-built critical (not-yet-online)", () => {
  const decision = evaluateMasterGate(
    gateInput({
      criticalHoleIds: new Set<string>(),
      degradedCriticalIds: new Set<string>(),
      criticalUpstreamIds: new Set(["env-swfl"]),
    }),
  );
  assert.equal(decision, "PUBLISH");
});

// Rule 2 — hollow output (no upstreams passed) must not clobber a serving master.
test("HOLD: hollow overwrite with prior master", () => {
  const decision = evaluateMasterGate(
    gateInput({
      rendered: { confidence: 0.8, upstream_count: 0 },
      priorMasterExists: true,
    }),
  );
  assert.equal(decision, "HOLD");
});

// Rule 2 carve-out — a hollow cold start (no prior master) is allowed to write.
test("PUBLISH: hollow but cold start (no prior master)", () => {
  const decision = evaluateMasterGate(
    gateInput({
      rendered: { confidence: 0.8, upstream_count: 0 },
      priorMasterExists: false,
    }),
  );
  assert.equal(decision, "PUBLISH");
});

// Rule 3 — confidence floor knob (default OFF) trips when tuned above the value.
test("HOLD: confidence knob triggered", () => {
  const decision = evaluateMasterGate(
    gateInput({
      rendered: { confidence: 0.5, upstream_count: 5 },
      knobs: { minPublishConfidence: 0.9 },
    }),
  );
  assert.equal(decision, "HOLD");
});

// Rule 4 — degraded fraction ceiling knob (default OFF) trips when tuned below.
// 1 critical upstream, 1 degraded-critical → fraction 1.0 > 0.4 → HOLD.
test("HOLD: degraded fraction ceiling knob triggered", () => {
  const decision = evaluateMasterGate(
    gateInput({
      criticalUpstreamIds: new Set(["env-swfl"]),
      degradedCriticalIds: new Set(["env-swfl"]),
      knobs: { maxDegradedFraction: 0.4 },
    }),
  );
  assert.equal(decision, "HOLD");
});

// A non-critical degraded upstream never blocks under default knobs.
test("PUBLISH: non-critical hole", () => {
  const decision = evaluateMasterGate(
    gateInput({
      criticalHoleIds: new Set<string>(),
      criticalUpstreamIds: new Set<string>(),
      degradedCriticalIds: new Set(["safety-swfl"]),
    }),
  );
  assert.equal(decision, "PUBLISH");
});
