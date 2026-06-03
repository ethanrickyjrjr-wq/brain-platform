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
  deriveExitCode,
  type BrainBuildOutcome,
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

// Build a BrainBuildOutcome literal for deriveExitCode tests.
function oc(
  partial: Partial<BrainBuildOutcome> & { packId: string },
): BrainBuildOutcome {
  return {
    status: "built",
    written: true,
    ...partial,
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
  const outcome = classifyFailure(
    pack,
    new Error("socket hang up"),
    read,
    "transient",
  );
  assert.equal(outcome.status, "degraded");
  assert.equal(outcome.lastGoodRefinedAt, refinedAt);
  assert.equal(outcome.version, 3);
  assert.ok(outcome.reason?.includes("socket"));
  assert.equal(outcome.failureClass, "transient");
});

test("classifyFailure: ineligible last-good → missing WITH lastGoodRefinedAt", () => {
  const pack = minPack({ ttl_seconds: 86400 }); // 1 day → floor = 2 days
  const oldRefinedAt = new Date(Date.now() - 10 * 86400_000).toISOString(); // 10 days ago
  const read = minOutput(oldRefinedAt);
  const outcome = classifyFailure(
    pack,
    new Error("schema validation failed"),
    read,
    "deterministic",
  );
  assert.equal(outcome.status, "missing");
  // lastGoodRefinedAt IS set — this is the HOLD trigger
  assert.equal(outcome.lastGoodRefinedAt, oldRefinedAt);
  assert.ok(
    outcome.reason?.includes("schema"),
    "reason should carry the error message",
  );
  assert.equal(outcome.failureClass, "deterministic");
});

test("classifyFailure: never-built (read.kind=missing) → missing WITHOUT lastGoodRefinedAt", () => {
  const pack = minPack();
  const read: BrainOutputRead = { kind: "missing", reason: "file not found" };
  const outcome = classifyFailure(
    pack,
    new Error("any error"),
    read,
    "deterministic",
  );
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
  assert.equal(
    outcome.failureClass,
    "deterministic",
    "a non-transient failure must be tagged deterministic so the exit code escalates to 1 — this is the silent-freeze kill",
  );
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
  assert.equal(
    outcome.failureClass,
    "transient",
    "a retried network failure stays transient → quiet exit 2, not a loud exit 1",
  );
});

test("buildOne — success path → built outcome", async () => {
  const runPipeline = async () => fakeOutputResult;
  const pack = minPack();
  const outcome = await buildOne(pack, { dryRun: false }, runPipeline);
  assert.equal(outcome.status, "built");
  assert.equal(outcome.version, 4);
  assert.ok(outcome.written);
});

// ── deriveExitCode (the silent-freeze kill) ─────────────────────────────────
// Exit semantics:
//   0 — clean (all built / skipped-fresh)
//   2 — degraded-but-complete: ONLY transient degradation (self-heals; quiet)
//   1 — LOUD: master HELD, OR any deterministic failure anywhere, OR master
//       silently not published (built but written:false outside dry-run)

test("deriveExitCode: all built → 0", () => {
  const outcomes = [oc({ packId: "macro-swfl" }), oc({ packId: "master" })];
  assert.equal(deriveExitCode(outcomes, "published", { dryRun: false }), 0);
});

test("deriveExitCode: skipped-fresh master → 0", () => {
  const outcomes = [
    oc({ packId: "master", status: "skipped-fresh", written: false }),
  ];
  assert.equal(deriveExitCode(outcomes, "skipped-fresh", { dryRun: false }), 0);
});

test("deriveExitCode: transient upstream degrade → 2 (quiet, self-heals)", () => {
  const outcomes = [
    oc({
      packId: "cre-swfl",
      status: "degraded",
      written: false,
      failureClass: "transient",
    }),
    oc({ packId: "master" }),
  ];
  assert.equal(deriveExitCode(outcomes, "published", { dryRun: false }), 2);
});

test("deriveExitCode: DETERMINISTIC master degrade → 1 (the bug — was silently 2)", () => {
  // This is the exact 2026-06-03 silent freeze: master's own pipeline threw a
  // deterministic orphan error, classifyFailure returned degraded off last-good,
  // and the old inline logic produced exit 2 → GREEN. It MUST be 1 now.
  const outcomes = [
    oc({
      packId: "master",
      status: "degraded",
      written: false,
      failureClass: "deterministic",
    }),
  ];
  assert.equal(deriveExitCode(outcomes, "published", { dryRun: false }), 1);
});

test("deriveExitCode: DETERMINISTIC upstream failure → 1 (any brain pages)", () => {
  // master still publishes off the upstream's last-good (resilience), but the
  // deterministic upstream bug won't self-heal → loud.
  const outcomes = [
    oc({
      packId: "macro-swfl",
      status: "degraded",
      written: false,
      failureClass: "deterministic",
    }),
    oc({ packId: "master" }), // master built + written: true
  ];
  assert.equal(deriveExitCode(outcomes, "published", { dryRun: false }), 1);
});

test("deriveExitCode: master HELD → 1", () => {
  const outcomes = [
    oc({
      packId: "master",
      status: "missing",
      written: false,
      lastGoodRefinedAt: "2026-01-01T00:00:00Z",
    }),
  ];
  assert.equal(deriveExitCode(outcomes, "held", { dryRun: false }), 1);
});

test("deriveExitCode: master built but NOT written (stage-4 gate HOLD) → 1", () => {
  // Path #3: evaluateMasterGate returns {written:false} WITHOUT throwing, so the
  // outcome is status:'built' written:false → trips nothing → was silent exit 0.
  const outcomes = [oc({ packId: "master", status: "built", written: false })];
  assert.equal(deriveExitCode(outcomes, "published", { dryRun: false }), 1);
});

test("deriveExitCode: master built+unwritten under --dry-run → 0 (legit)", () => {
  // In dry-run, written:false is expected (validation only) — must not escalate.
  const outcomes = [oc({ packId: "master", status: "built", written: false })];
  assert.equal(deriveExitCode(outcomes, "published", { dryRun: true }), 0);
});

test("deriveExitCode: NON-master built+written:false must NOT escalate (master-only clause)", () => {
  // masterSilentlyUnpublished is scoped to packId === 'master'. A non-master
  // outcome with written:false must not flip the whole run to exit 1.
  const outcomes = [
    oc({ packId: "labor-demand-swfl", status: "built", written: false }),
    oc({ packId: "master", status: "built", written: true }),
  ];
  assert.equal(deriveExitCode(outcomes, "published", { dryRun: false }), 0);
});

test("deriveExitCode: deterministic dominates a mixed transient+deterministic set → 1", () => {
  const outcomes = [
    oc({
      packId: "cre-swfl",
      status: "degraded",
      written: false,
      failureClass: "transient",
    }),
    oc({
      packId: "macro-swfl",
      status: "degraded",
      written: false,
      failureClass: "deterministic",
    }),
    oc({ packId: "master" }),
  ];
  assert.equal(deriveExitCode(outcomes, "published", { dryRun: false }), 1);
});
