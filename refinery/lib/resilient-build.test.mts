// refinery/lib/resilient-build.test.mts
import { test } from "bun:test";
import assert from "node:assert/strict";
import type { PackDefinition } from "../types/pack.mts";
import type { BrainOutputRead } from "./brain-output-reader.mts";
import type { OutputResult } from "../stages/4-output.mts";
import {
  isTransientError,
  isEligibleLastGood,
  classifyFailure,
  computeMasterDecision,
  buildOne,
} from "./resilient-build.mts";

// Minimal PackDefinition for tests — only fields used by resilient-build.mts
function minPack(overrides: Partial<PackDefinition> = {}): PackDefinition {
  return {
    id: "test-pack",
    brain_id: "test-pack",
    domain: "macro",
    scope: "test",
    ttl_seconds: 86400, // 1 day → window = max(2, 1) = 2 days
    sources: [],
    input_brains: [],
    fitScore: () => 1,
    preferences: [],
    activeProject: "test",
    prompts: { triageContext: "", synthesisContext: "" },
    ...overrides,
  } as PackDefinition;
}

function minOutput(refinedAt: string): BrainOutputRead {
  return {
    kind: "ok",
    output: {
      brain_id: "test-pack",
      version: 3,
      refined_at: refinedAt,
      direction: "neutral",
      magnitude: 0.5,
      drivers: [],
      overrides: [],
      conclusion: "test",
      key_metrics: [],
      caveats: [],
      contradicts: [],
      confidence: 0.8,
      joint_integrity: 0.8,
      confidence_dispersion: 0,
      chain_depth: 0,
      trust_tier: 2,
      upstream_count: 0,
      relevance: {
        decay_curve: "days",
        half_life_hours: 24,
        computed_at: refinedAt,
      },
      exogenous_signals: [],
    },
  };
}

// ── isTransientError ───────────────────────────────────────────────────────

test("isTransientError: network keywords → true", () => {
  for (const msg of [
    "socket hang up",
    "ECONNRESET",
    "ETIMEDOUT",
    "fetch failed",
  ]) {
    assert.ok(isTransientError(new Error(msg)), `expected transient: ${msg}`);
  }
});

test("isTransientError: validator/type errors → false", () => {
  for (const msg of [
    "Stage 4: rendered pack failed validation",
    "schema validation failed",
    "TypeError: undefined is not",
  ]) {
    assert.ok(
      !isTransientError(new Error(msg)),
      `expected non-transient: ${msg}`,
    );
  }
});

// ── isEligibleLastGood ─────────────────────────────────────────────────────

test("isEligibleLastGood: 1-day TTL pack → floor = 2 days", () => {
  const pack = minPack({ ttl_seconds: 86400 }); // 1 day → window = max(2,1) = 2
  const twoAgoDays = new Date(
    Date.now() - 2 * 86400_000 + 60_000,
  ).toISOString(); // 2d minus 1min
  assert.ok(isEligibleLastGood(pack, twoAgoDays), "just within 2-day floor");
  const twoAgoExpired = new Date(
    Date.now() - 2 * 86400_000 - 60_000,
  ).toISOString();
  assert.ok(
    !isEligibleLastGood(pack, twoAgoExpired),
    "just outside 2-day floor",
  );
});

test("isEligibleLastGood: 30-day TTL pack → ceiling = 14 days", () => {
  const pack = minPack({ ttl_seconds: 30 * 86400 }); // 30 days → window = min(14,30) = 14
  const fourteenAgo = new Date(
    Date.now() - 14 * 86400_000 + 60_000,
  ).toISOString();
  assert.ok(
    isEligibleLastGood(pack, fourteenAgo),
    "just within 14-day ceiling",
  );
  const tooOld = new Date(Date.now() - 15 * 86400_000).toISOString();
  assert.ok(!isEligibleLastGood(pack, tooOld), "outside 14-day ceiling");
});

// ── classifyFailure ────────────────────────────────────────────────────────

test("classifyFailure: eligible last-good → degraded with lastGoodRefinedAt", () => {
  const pack = minPack({ ttl_seconds: 604_800 }); // 7 days → window = 7
  const refinedAt = new Date(Date.now() - 3 * 86400_000).toISOString(); // 3 days ago
  const read = minOutput(refinedAt);
  const outcome = classifyFailure(pack, new Error("socket hang up"), read);
  assert.equal(outcome.status, "degraded");
  assert.equal(outcome.lastGoodRefinedAt, refinedAt);
  assert.equal(outcome.version, 3);
  assert.ok(outcome.reason?.includes("socket"));
});

test("classifyFailure: ineligible last-good → missing WITH lastGoodRefinedAt", () => {
  const pack = minPack({ ttl_seconds: 86400 }); // 1 day → floor = 2 days
  const oldRefinedAt = new Date(Date.now() - 10 * 86400_000).toISOString(); // 10 days ago
  const read = minOutput(oldRefinedAt);
  const outcome = classifyFailure(
    pack,
    new Error("schema validation failed"),
    read,
  );
  assert.equal(outcome.status, "missing");
  // lastGoodRefinedAt IS set — this is the HOLD trigger
  assert.equal(outcome.lastGoodRefinedAt, oldRefinedAt);
  assert.ok(
    outcome.reason?.includes("schema"),
    "reason should carry the error message",
  );
});

test("classifyFailure: never-built (read.kind=missing) → missing WITHOUT lastGoodRefinedAt", () => {
  const pack = minPack();
  const read: BrainOutputRead = { kind: "missing", reason: "file not found" };
  const outcome = classifyFailure(pack, new Error("any error"), read);
  assert.equal(outcome.status, "missing");
  // lastGoodRefinedAt ABSENT — this is the "not-yet-online" case, no HOLD
  assert.equal(outcome.lastGoodRefinedAt, undefined);
});

// ── computeMasterDecision (guards 4–5) ────────────────────────────────────

test("Guard 4 — critical upstream missing WITH lastGoodRefinedAt → HOLD", () => {
  const masterPack = minPack({
    input_brains: [{ id: "cre-swfl", edge_type: "input", critical: true }],
  });
  const outcomes = [
    {
      packId: "cre-swfl",
      status: "missing" as const,
      lastGoodRefinedAt: "2026-01-01T00:00:00Z", // was built, eligibility expired
      written: false,
    },
  ];
  assert.equal(computeMasterDecision(masterPack, outcomes), "held");
});

test("Guard 5 — critical upstream missing WITHOUT lastGoodRefinedAt → no HOLD (not-yet-online)", () => {
  const masterPack = minPack({
    input_brains: [{ id: "cre-swfl", edge_type: "input", critical: true }],
  });
  const outcomes = [
    {
      packId: "cre-swfl",
      status: "missing" as const,
      // no lastGoodRefinedAt — never built
      written: false,
    },
  ];
  assert.equal(computeMasterDecision(masterPack, outcomes), "published");
});

test("Guard 4 variant — non-critical upstream missing → no HOLD regardless", () => {
  const masterPack = minPack({
    input_brains: [{ id: "sector-credit-swfl", edge_type: "input" }], // not critical
  });
  const outcomes = [
    {
      packId: "sector-credit-swfl",
      status: "missing" as const,
      lastGoodRefinedAt: "2026-01-01T00:00:00Z",
      written: false,
    },
  ];
  assert.equal(computeMasterDecision(masterPack, outcomes), "published");
});

// ── buildOne (guards 2–3) ─────────────────────────────────────────────────

const fakeOutputResult: OutputResult = {
  brainPath: "brains/test-pack.md",
  written: true,
  markdown: "",
  version: 4,
  brainOutput: minOutput(new Date().toISOString()).output,
};

test("Guard 3 — deterministic error → runPipeline called exactly once, no retry", async () => {
  let callCount = 0;
  const runPipeline = async () => {
    callCount++;
    throw new Error("Stage 4: rendered pack failed validation");
  };
  const freshAt = new Date(Date.now() - 1 * 86400_000).toISOString();
  const readFn = async () => minOutput(freshAt);
  const pack = minPack({ ttl_seconds: 604_800 });

  const outcome = await buildOne(
    pack,
    { dryRun: false },
    runPipeline,
    readFn,
    0,
  );

  assert.equal(callCount, 1, "must not retry deterministic errors");
  assert.equal(outcome.status, "degraded"); // last-good within 7-day window
});

test("Guard 2 — transient error → retry once, then degraded on eligible last-good", async () => {
  let callCount = 0;
  const runPipeline = async () => {
    callCount++;
    throw new Error("ECONNRESET");
  };
  const freshAt = new Date(Date.now() - 1 * 86400_000).toISOString();
  const readFn = async () => minOutput(freshAt);
  const pack = minPack({ ttl_seconds: 604_800 });

  const outcome = await buildOne(
    pack,
    { dryRun: false },
    runPipeline,
    readFn,
    0,
  );

  assert.equal(callCount, 2, "must retry exactly once");
  assert.equal(outcome.status, "degraded");
});

test("buildOne — success path → built outcome", async () => {
  const runPipeline = async () => fakeOutputResult;
  const pack = minPack();
  const outcome = await buildOne(pack, { dryRun: false }, runPipeline);
  assert.equal(outcome.status, "built");
  assert.equal(outcome.version, 4);
  assert.ok(outcome.written);
});
