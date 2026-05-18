import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

process.env["REFINERY_SOURCE"] = "fixture";

const {
  logisticsSwflNowcast,
  nextConsecutiveBreachDays,
  classifyShockState,
  decideBaselineValidityFlag,
  rollingActivityStats,
  renderFaf5ContextSentences,
  COLD_START_THRESHOLD_DAYS,
  ROLLING_WINDOW_DAYS,
} = await import("./logistics-swfl-nowcast.mts");

const {
  fdotFreightSegmentsSource,
  activityFromAadt,
  AVG_PAYLOAD_TONS_PER_TRUCK,
} = await import("../sources/fdot-freight-source.mts");

import type { ShockLogRow } from "../sources/fdot-freight-source.mts";
import type { BrainOutput } from "../types/brain-output.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { BrainEdge, PackDefinition } from "../types/pack.mts";

// =========================================================================
// 1. Pure formula unit test — activityFromAadt is the locked AADT→activity math.
// =========================================================================

test("activityFromAadt: locked Path B formula (NO segment-length factor)", () => {
  // AADT=24000, tfctr=0.043, payload=16
  // activity = 24000 × 0.043 × 16 × 365
  const result = activityFromAadt({
    aadt: 24000,
    tfctr: 0.043,
    payload: 16,
  });
  const expected = 24000 * 0.043 * 16 * 365;
  assert.equal(result, expected);
});

test("activityFromAadt: default payload uses AVG_PAYLOAD_TONS_PER_TRUCK = 16.0", () => {
  assert.equal(AVG_PAYLOAD_TONS_PER_TRUCK, 16.0);
  const explicit = activityFromAadt({
    aadt: 10000,
    tfctr: 0.05,
    payload: 16,
  });
  const implicit = activityFromAadt({
    aadt: 10000,
    tfctr: 0.05,
  });
  assert.equal(explicit, implicit);
});

test("Path B: the activity formula has no length factor — single-segment activity does not depend on shape_length", () => {
  // This is the regression-preventing test for the v1 bug. If a future
  // refactor re-introduces the miles factor, this test fires.
  const a = activityFromAadt({ aadt: 10000, tfctr: 0.05 });
  const b = activityFromAadt({ aadt: 10000, tfctr: 0.05 });
  assert.equal(a, b);
  // Worked example: 10000 * 0.05 * 16 * 365 = 2,920,000 (NOT 2,920,000 × miles).
  assert.equal(a, 2_920_000);
});

// =========================================================================
// 2. State-machine pure helpers (consecutive-day counter + classifier).
// =========================================================================

function shockEntry(
  refined_at: string,
  deviation_z: number,
  flag?: "valid" | "stale-structural",
  activity?: number | null,
): ShockLogRow {
  return {
    kind: "fdot-freight-shock-log",
    refined_at,
    deviation_z,
    shock_state: Math.abs(deviation_z) > 3 ? "anomaly" : "normal",
    baseline_validity_flag: flag,
    current_activity_tons_year: activity ?? null,
  };
}

test("nextConsecutiveBreachDays: |z|<=3 returns 0 regardless of history", () => {
  const history = [
    shockEntry("2026-05-15T12:00:00Z", -4.0),
    shockEntry("2026-05-16T12:00:00Z", -4.0),
  ];
  assert.equal(nextConsecutiveBreachDays(-2.5, history), 0);
});

test("nextConsecutiveBreachDays: null current z (cold start) returns 0", () => {
  const history = [
    shockEntry("2026-05-15T12:00:00Z", -4.0),
    shockEntry("2026-05-16T12:00:00Z", -4.0),
  ];
  assert.equal(nextConsecutiveBreachDays(null, history), 0);
});

test("nextConsecutiveBreachDays: |z|>3 with empty history → 1", () => {
  assert.equal(nextConsecutiveBreachDays(-4.0, []), 1);
});

test("nextConsecutiveBreachDays: |z|>3 with 2 matching-sign prior breaches → 3", () => {
  const history = [
    shockEntry("2026-05-15T12:00:00Z", -4.0),
    shockEntry("2026-05-16T12:00:00Z", -3.8),
  ];
  assert.equal(nextConsecutiveBreachDays(-4.2, history), 3);
});

test("nextConsecutiveBreachDays: sign flip resets to 1", () => {
  const history = [
    shockEntry("2026-05-15T12:00:00Z", -4.0),
    shockEntry("2026-05-16T12:00:00Z", -4.0),
  ];
  assert.equal(nextConsecutiveBreachDays(4.5, history), 1);
});

test("nextConsecutiveBreachDays: in-band gap in history breaks the streak", () => {
  const history = [
    shockEntry("2026-05-15T12:00:00Z", -4.0),
    shockEntry("2026-05-16T12:00:00Z", -1.0), // in-band — breaks the streak
    shockEntry("2026-05-17T12:00:00Z", -4.0),
  ];
  // Current breach + 1 prior (most-recent) breach with matching sign before
  // walking back further to the in-band entry which terminates the walk.
  assert.equal(nextConsecutiveBreachDays(-4.1, history), 2);
});

test("classifyShockState: thresholds at 3 and 30", () => {
  assert.equal(classifyShockState(0), "normal");
  assert.equal(classifyShockState(2), "normal");
  assert.equal(classifyShockState(3), "anomaly");
  assert.equal(classifyShockState(29), "anomaly");
  assert.equal(classifyShockState(30), "structural_break");
  assert.equal(classifyShockState(90), "structural_break");
});

test("classifyShockState: coldStart=true returns insufficient_history regardless of counter", () => {
  assert.equal(classifyShockState(0, true), "insufficient_history");
  assert.equal(classifyShockState(5, true), "insufficient_history");
  assert.equal(classifyShockState(90, true), "insufficient_history");
});

test("decideBaselineValidityFlag: < 90 consecutive days + no prior stale → valid", () => {
  assert.equal(decideBaselineValidityFlag(89, []), "valid");
});

test("decideBaselineValidityFlag: 90 consecutive days → stale-structural (first flip)", () => {
  assert.equal(decideBaselineValidityFlag(90, []), "stale-structural");
});

test("decideBaselineValidityFlag: prior stale-structural is sticky regardless of current count", () => {
  const history = [
    shockEntry("2026-05-15T12:00:00Z", -4.0, "stale-structural"),
  ];
  assert.equal(decideBaselineValidityFlag(2, history), "stale-structural");
});

// =========================================================================
// 3. Path B rolling-stats helper.
// =========================================================================

test("rollingActivityStats: empty log returns observed=0, mean=0, stddev=0", () => {
  const stats = rollingActivityStats([]);
  assert.equal(stats.observed, 0);
  assert.equal(stats.mean, 0);
  assert.equal(stats.stddev, 0);
});

test("rollingActivityStats: skips null-activity rows when counting observed", () => {
  const log: ShockLogRow[] = [
    shockEntry("2026-04-01T00:00:00Z", -4.0, undefined, null),
    shockEntry("2026-04-02T00:00:00Z", -4.0, undefined, null),
    shockEntry("2026-04-03T00:00:00Z", 0.0, undefined, 100_000_000),
  ];
  const stats = rollingActivityStats(log);
  assert.equal(stats.observed, 1);
  assert.equal(stats.mean, 100_000_000);
  assert.equal(stats.stddev, 0);
});

test("rollingActivityStats: 100 in-band days around 240M with ±1% spread yields mean ≈ 240M and stddev > 0", () => {
  const base = 240_000_000;
  const log: ShockLogRow[] = [];
  for (let i = 0; i < 100; i++) {
    // alternating +1%, -1% jitter
    const activity = base * (1 + (i % 2 === 0 ? 0.01 : -0.01));
    log.push({
      kind: "fdot-freight-shock-log",
      refined_at: new Date(2026, 0, 1 + i).toISOString(),
      deviation_z: 0.5,
      shock_state: "normal",
      current_activity_tons_year: activity,
    });
  }
  const stats = rollingActivityStats(log);
  assert.equal(stats.observed, 90); // capped at ROLLING_WINDOW_DAYS
  assert.ok(
    Math.abs(stats.mean - base) < base * 0.005,
    `expected mean near ${base}, got ${stats.mean}`,
  );
  assert.ok(stats.stddev > 0, `expected non-zero stddev, got ${stats.stddev}`);
  // For ±1% alternating jitter, the population stddev is exactly 1% of base.
  assert.ok(
    Math.abs(stats.stddev - base * 0.01) < base * 0.001,
    `expected stddev near ${base * 0.01}, got ${stats.stddev}`,
  );
});

// =========================================================================
// 4. FAF5 framing — two-sentence template.
// =========================================================================

test("renderFaf5ContextSentences: matches the locked two-sentence template verbatim", () => {
  const out = renderFaf5ContextSentences(1_500_000_000, 2024);
  // Both sentences. First: FAF5 number with CY label. Second: the disambiguation.
  assert.equal(
    out,
    "FAF5 audited annual inbound freight: 1,500,000,000 tons (CY2024). This is a flow metric; the deviation below is an activity metric from FDOT segment counts.",
  );
});

// =========================================================================
// 5. Pack-level metadata invariants.
// =========================================================================

test("logisticsSwflNowcast pack: stable id, brain_id, domain, ttl", () => {
  assert.equal(logisticsSwflNowcast.id, "logistics-swfl-nowcast");
  assert.equal(logisticsSwflNowcast.brain_id, "logistics-swfl-nowcast");
  assert.equal(logisticsSwflNowcast.domain, "logistics");
  assert.equal(logisticsSwflNowcast.ttl_seconds, 86400);
});

test("logisticsSwflNowcast pack: thin-pipe upstream is logistics-swfl", () => {
  assert.deepEqual(logisticsSwflNowcast.input_brains, [
    { id: "logistics-swfl", edge_type: "input" },
  ]);
});

test("logisticsSwflNowcast pack: 2 sources wired (fdot freight + brain input)", () => {
  assert.equal(logisticsSwflNowcast.sources.length, 2);
  const sourceIds = logisticsSwflNowcast.sources.map((s) => s.source_id);
  assert.ok(sourceIds.includes("fdot_freight_swfl"));
  assert.ok(sourceIds.includes("brain-input:logistics-swfl"));
});

test("logisticsSwflNowcast pack: deterministic (skipTriageAgent + skipSynthesisAgent)", () => {
  assert.equal(logisticsSwflNowcast.skipTriageAgent, true);
  assert.equal(logisticsSwflNowcast.skipSynthesisAgent, true);
});

test("logisticsSwflNowcast pack: cold-start threshold is documented at 90 days", () => {
  assert.equal(COLD_START_THRESHOLD_DAYS, 90);
  assert.equal(ROLLING_WINDOW_DAYS, 90);
});

test("logisticsSwflNowcast pack source: contains the Path B semantic-shift comment on input_brains", async () => {
  // Mechanical assertion that the explanatory comment is not lost in a
  // future refactor. The string need only be CONTAINED — wording can evolve.
  const src = await readFile(
    path.join(process.cwd(), "refinery", "packs", "logistics-swfl-nowcast.mts"),
    "utf-8",
  );
  assert.ok(
    src.includes("no longer load-bearing for the math"),
    "expected the Path B semantic-shift comment to appear near input_brains declaration",
  );
  assert.ok(
    src.includes("Lane 2E"),
    "expected reference to Lane 2E stale-upstream cascade in the comment",
  );
  assert.ok(
    src.includes("stale-upstream cascade"),
    "expected the phrase 'stale-upstream cascade' to appear in the comment",
  );
});

// =========================================================================
// 6. Scenario tests — drive the pack end-to-end against each fixture
// scenario and verify shock_state / baseline_validity_flag.
// =========================================================================

/**
 * Wraps the BrainInput source's filesystem dependency for these tests.
 * The pack's brain-input source reads brains/logistics-swfl.md off disk; we
 * synthesize a minimal one for the test, then clean up.
 */
async function withSyntheticBaseline(body: () => Promise<void>): Promise<void> {
  const brainsDir = path.join(process.cwd(), "brains");
  await mkdir(brainsDir, { recursive: true });
  const p = path.join(brainsDir, "logistics-swfl.md");
  const output: BrainOutput = {
    brain_id: "logistics-swfl",
    version: 1,
    refined_at: new Date().toISOString(),
    direction: "neutral",
    magnitude: 0.5,
    drivers: [],
    overrides: [],
    conclusion: "Synthetic baseline for nowcast tests.",
    key_metrics: [
      {
        // Path B: this value is CONTEXT only. It appears verbatim in the
        // rendered conclusion via the two-sentence FAF5 framing, but does
        // NOT anchor the math baseline (which comes from FDOT rolling history).
        metric: "inbound_freight_tons_swfl",
        value: 1539664,
        direction: "stable",
        label: "test",
        variable_type: "extensive",
        units: "thousand tons/year",
        source: {
          url: "test://baseline",
          fetched_at: new Date().toISOString(),
          tier: 1,
          citation: "Test baseline",
        },
      },
    ],
    caveats: [],
    contradicts: [],
    confidence: 0.85,
    joint_integrity: 1,
    confidence_dispersion: 0,
    chain_depth: 0,
    trust_tier: 1,
    upstream_count: 0,
    relevance: {
      decay_curve: "months",
      half_life_hours: 8760,
      computed_at: new Date().toISOString(),
    },
    exogenous_signals: [],
  };
  // The TTL on the brain frontmatter must be long enough that the brain
  // reads as "fresh" — 30 days for the FAF5 baseline matches logistics-swfl.
  const ttlSeconds = 2_592_000;
  const md = [
    `---`,
    `brain_id: logistics-swfl`,
    `version: 1`,
    `refined_at: ${output.refined_at}`,
    `ttl_seconds: ${ttlSeconds}`,
    `---`,
    ``,
    `# Synthetic baseline`,
    ``,
    "```reference",
    `--- OUTPUT ---`,
    JSON.stringify(output, null, 2),
    "```",
    ``,
  ].join("\n");
  // Preserve any real logistics-swfl.md that lives in brains/ — restore on
  // cleanup so tests do not clobber the developer's working tree.
  let prior: string | null = null;
  try {
    prior = await readFile(p, "utf-8");
  } catch {
    prior = null;
  }
  await writeFile(p, md, "utf-8");
  try {
    await body();
  } finally {
    if (prior !== null) {
      await writeFile(p, prior, "utf-8");
    } else {
      await rm(p, { force: true });
    }
  }
}

async function runScenario(
  scenario: string,
): Promise<
  ReturnType<NonNullable<typeof logisticsSwflNowcast.outputProducer>>
> {
  const prev = process.env["REFINERY_FIXTURE_SCENARIO"];
  process.env["REFINERY_FIXTURE_SCENARIO"] = scenario;
  try {
    const fragments: RawFragment[] = [
      ...(await fdotFreightSegmentsSource.fetch()),
      ...(await logisticsSwflNowcast.sources[1].fetch()),
    ];
    logisticsSwflNowcast.corpusSummary!(fragments);
    return logisticsSwflNowcast.outputProducer!({
      pack: logisticsSwflNowcast,
      version: 1,
      refined_at: new Date().toISOString(),
      citations: [],
      facts: [],
      recentNote: "",
    } as unknown as Parameters<
      NonNullable<typeof logisticsSwflNowcast.outputProducer>
    >[0]);
  } finally {
    if (prev === undefined) delete process.env["REFINERY_FIXTURE_SCENARIO"];
    else process.env["REFINERY_FIXTURE_SCENARIO"] = prev;
  }
}

test("scenario cold_start → shock_state=insufficient_history, deviation_z suppressed (not in key_metrics), insufficient_history caveat present", async () => {
  await withSyntheticBaseline(async () => {
    const result = await runScenario("cold_start");
    const shockMetric = result.key_metrics.find(
      (m) => m.metric === "shock_state",
    );
    const flagMetric = result.key_metrics.find(
      (m) => m.metric === "baseline_validity_flag",
    );
    const historyDaysMetric = result.key_metrics.find(
      (m) => m.metric === "history_days_observed",
    );
    const deviationZMetric = result.key_metrics.find(
      (m) => m.metric === "deviation_z",
    );
    const deviationPctMetric = result.key_metrics.find(
      (m) => m.metric === "deviation_pct",
    );
    assert.ok(shockMetric, "shock_state metric must be present");
    assert.equal(shockMetric!.value, "insufficient_history");
    assert.equal(flagMetric!.value, "valid");
    assert.equal(historyDaysMetric!.value, 30);
    // SUPPRESSED — must not appear in key_metrics on a cold-start run.
    assert.equal(
      deviationZMetric,
      undefined,
      "deviation_z must be suppressed on cold start",
    );
    assert.equal(
      deviationPctMetric,
      undefined,
      "deviation_pct must be suppressed on cold start",
    );
    // Verbatim caveat
    assert.ok(
      result.caveats.some((c) => c.includes("Insufficient history")),
      `expected an insufficient-history caveat, got:\n${result.caveats.join("\n")}`,
    );
    // Magnitude collapses to 0 on cold start so downstream signals are dampened.
    assert.equal(result.magnitude, 0);
    assert.equal(result.direction, "neutral");
  });
});

test("scenario nominal → shock_state=normal, baseline_validity_flag=valid, deviation_z within ±1, no stale caveat", async () => {
  await withSyntheticBaseline(async () => {
    const result = await runScenario("nominal");
    const shockMetric = result.key_metrics.find(
      (m) => m.metric === "shock_state",
    );
    const flagMetric = result.key_metrics.find(
      (m) => m.metric === "baseline_validity_flag",
    );
    const deviationZMetric = result.key_metrics.find(
      (m) => m.metric === "deviation_z",
    );
    assert.ok(shockMetric, "shock_state metric must be present");
    assert.ok(flagMetric, "baseline_validity_flag metric must be present");
    assert.equal(shockMetric!.value, "normal");
    assert.equal(flagMetric!.value, "valid");
    assert.ok(deviationZMetric, "deviation_z must be emitted on a warm run");
    assert.ok(
      Math.abs(Number(deviationZMetric!.value)) <= 3,
      `expected |z| <= 3 for nominal, got ${deviationZMetric!.value}`,
    );
    assert.ok(
      !result.caveats.some((c) => c.includes("stale-structural")),
      "nominal scenario must not emit a stale-structural caveat",
    );
  });
});

test("scenario i75_closure_acute → shock_state=anomaly (3 consecutive days)", async () => {
  await withSyntheticBaseline(async () => {
    const result = await runScenario("i75_closure_acute");
    const shockMetric = result.key_metrics.find(
      (m) => m.metric === "shock_state",
    );
    const flagMetric = result.key_metrics.find(
      (m) => m.metric === "baseline_validity_flag",
    );
    const consecMetric = result.key_metrics.find(
      (m) => m.metric === "consecutive_breach_days",
    );
    assert.equal(shockMetric!.value, "anomaly");
    assert.equal(flagMetric!.value, "valid");
    assert.equal(consecMetric!.value, 3);
  });
});

test("scenario i75_closure_sustained_30d → shock_state=structural_break", async () => {
  await withSyntheticBaseline(async () => {
    const result = await runScenario("i75_closure_sustained_30d");
    const shockMetric = result.key_metrics.find(
      (m) => m.metric === "shock_state",
    );
    const flagMetric = result.key_metrics.find(
      (m) => m.metric === "baseline_validity_flag",
    );
    const consecMetric = result.key_metrics.find(
      (m) => m.metric === "consecutive_breach_days",
    );
    assert.equal(shockMetric!.value, "structural_break");
    assert.equal(flagMetric!.value, "valid");
    assert.equal(consecMetric!.value, 30);
  });
});

test("scenario i75_closure_sustained_90d → baseline_validity_flag flips to stale-structural + verbatim caveat", async () => {
  await withSyntheticBaseline(async () => {
    const result = await runScenario("i75_closure_sustained_90d");
    const shockMetric = result.key_metrics.find(
      (m) => m.metric === "shock_state",
    );
    const flagMetric = result.key_metrics.find(
      (m) => m.metric === "baseline_validity_flag",
    );
    const consecMetric = result.key_metrics.find(
      (m) => m.metric === "consecutive_breach_days",
    );
    assert.equal(shockMetric!.value, "structural_break");
    assert.equal(flagMetric!.value, "stale-structural");
    assert.equal(consecMetric!.value, 90);
    const verbatimSnippet =
      "Baseline validity flag flipped to stale-structural";
    assert.ok(
      result.caveats.some((c) => c.includes(verbatimSnippet)),
      `expected verbatim stale-structural caveat, got:\n${result.caveats.join("\n")}`,
    );
  });
});

// =========================================================================
// 7. Metric-rename invariants — Path B renamed two and added three metrics.
// =========================================================================

test("scenario nominal → emits faf5_inbound_flow_tons_year (NOT baseline_flow_tons_year)", async () => {
  await withSyntheticBaseline(async () => {
    const result = await runScenario("nominal");
    const faf5 = result.key_metrics.find(
      (m) => m.metric === "faf5_inbound_flow_tons_year",
    );
    const legacy = result.key_metrics.find(
      (m) => m.metric === "baseline_flow_tons_year",
    );
    assert.ok(
      faf5,
      "faf5_inbound_flow_tons_year (renamed) must appear in key_metrics",
    );
    assert.equal(
      legacy,
      undefined,
      "legacy baseline_flow_tons_year must NOT appear post-Path-B",
    );
  });
});

test("scenario nominal → emits current_activity_tons_year (NOT current_flow_tons_year)", async () => {
  await withSyntheticBaseline(async () => {
    const result = await runScenario("nominal");
    const activity = result.key_metrics.find(
      (m) => m.metric === "current_activity_tons_year",
    );
    const legacy = result.key_metrics.find(
      (m) => m.metric === "current_flow_tons_year",
    );
    assert.ok(
      activity,
      "current_activity_tons_year (renamed) must appear in key_metrics",
    );
    assert.equal(
      legacy,
      undefined,
      "legacy current_flow_tons_year must NOT appear post-Path-B",
    );
  });
});

test("scenario nominal → emits the 3 new rolling-stats metrics", async () => {
  await withSyntheticBaseline(async () => {
    const result = await runScenario("nominal");
    const mean = result.key_metrics.find(
      (m) => m.metric === "rolling_mean_activity_tons_year",
    );
    const stddev = result.key_metrics.find(
      (m) => m.metric === "rolling_stddev_activity_tons_year",
    );
    const history = result.key_metrics.find(
      (m) => m.metric === "history_days_observed",
    );
    assert.ok(mean, "rolling_mean_activity_tons_year must be emitted");
    assert.ok(stddev, "rolling_stddev_activity_tons_year must be emitted");
    assert.ok(history, "history_days_observed must be emitted");
    // The 90-day-window cap on rolling stats means a 100-day history clamps to 90.
    assert.equal(history!.value, 90);
    assert.ok(Number(stddev!.value) > 0);
  });
});

test("scenario nominal → conclusion contains the verbatim two-sentence FAF5 framing", async () => {
  await withSyntheticBaseline(async () => {
    const result = await runScenario("nominal");
    // The FAF5 value in the fixture is 1,539,664 thousand tons → 1,539,664,000 tons.
    assert.ok(
      result.conclusion.includes(
        "FAF5 audited annual inbound freight: 1,539,664,000 tons (CY",
      ),
      `expected conclusion to contain the FAF5 framing first sentence, got:\n${result.conclusion}`,
    );
    assert.ok(
      result.conclusion.includes(
        "This is a flow metric; the deviation below is an activity metric from FDOT segment counts.",
      ),
      `expected conclusion to contain the FAF5 framing second sentence, got:\n${result.conclusion}`,
    );
  });
});

// =========================================================================
// 8. Integration test — Lane 2E stale-upstream cascade end-to-end.
// =========================================================================

test("Lane 2E integration: stale logistics-swfl upstream triggers caveat + capped confidence in nowcast", async () => {
  // Build a synthetic stale logistics-swfl brain that this pack consumes,
  // then drive outputStage end-to-end with dryRun=true so no .md is written
  // but the BrainOutput is still inspectable.
  const refined = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const ttlSeconds = 86_400; // 1d TTL → 29 days stale
  const expectedExpiry = new Date(Date.parse(refined) + ttlSeconds * 1000)
    .toISOString()
    .slice(0, 10);

  // Use a unique brain id (with random suffix) to avoid colliding with the
  // real logistics-swfl brain that may exist on disk. We need to inject a
  // pack that consumes THIS unique upstream id rather than re-using the
  // production pack. The cleanest way to drive Lane 2E is to bypass the
  // pack and call outputStage directly with a minimal one-input pack.

  const suffix = randomUUID().slice(0, 8);
  const staleId = `lane2e-logistics-stale-${suffix}`;
  const brainsDir = path.join(process.cwd(), "brains");
  await mkdir(brainsDir, { recursive: true });
  const staleFile = path.join(brainsDir, `${staleId}.md`);

  const staleOutput: BrainOutput = {
    brain_id: staleId,
    version: 1,
    refined_at: refined,
    direction: "neutral",
    magnitude: 0.5,
    drivers: [],
    overrides: [],
    conclusion: "Stale logistics baseline for Lane 2E integration test.",
    key_metrics: [],
    caveats: [],
    contradicts: [],
    confidence: 0.3,
    joint_integrity: 1,
    confidence_dispersion: 0,
    chain_depth: 0,
    trust_tier: 2,
    upstream_count: 0,
    relevance: {
      decay_curve: "weeks",
      half_life_hours: 720,
      computed_at: refined,
    },
    exogenous_signals: [],
  };

  await writeFile(
    staleFile,
    [
      `---`,
      `brain_id: ${staleId}`,
      `version: 1`,
      `refined_at: ${refined}`,
      `ttl_seconds: ${ttlSeconds}`,
      `---`,
      ``,
      "```reference",
      `--- OUTPUT ---`,
      JSON.stringify(staleOutput, null, 2),
      "```",
      ``,
    ].join("\n"),
    "utf-8",
  );

  try {
    const { outputStage } = await import("../stages/4-output.mts");
    const { makeBrainInputSource } =
      await import("../sources/brain-input-source.mts");

    const edges: BrainEdge[] = [{ id: staleId, edge_type: "input" }];
    const minimalSource = {
      source_id: "lane2e-fixture-direct",
      trust_tier: 2 as const,
      fetch: async () => [],
      citationMeta: (verified: string, ttl: number) => ({
        source: "Lane 2E fixture direct",
        verified,
        expires: new Date(Date.parse(verified) + ttl * 1000)
          .toISOString()
          .slice(0, 10),
      }),
    };

    const downstreamId = `lane2e-nowcast-downstream-${suffix}`;
    const downstreamPack: PackDefinition = {
      id: downstreamId,
      brain_id: downstreamId,
      domain: "logistics",
      scope: "Lane 2E integration test pack for nowcast staleness cascade",
      ttl_seconds: 86_400,
      sources: [minimalSource, makeBrainInputSource(staleId)],
      input_brains: edges,
      fitScore: () => 1,
      preferences: ["Lane 2E test preference."],
      activeProject: "lane-2e-nowcast-test",
      prompts: { triageContext: "", synthesisContext: "" },
      skipTriageAgent: true,
      skipSynthesisAgent: true,
      outputProducer: () => ({
        conclusion: "Lane 2E nowcast-style integration fixture.",
        key_metrics: [],
        caveats: [],
        direction: "neutral",
        magnitude: 0.5,
        drivers: [staleId],
        overrides: [],
        contradicts: [],
        exogenous_signals: [],
      }),
    };

    const result = await outputStage([], downstreamPack, { dryRun: true });
    const expectedCaveat = `Upstream brain '${staleId}' was stale at build time (expired ${expectedExpiry}).`;
    assert.ok(
      result.brainOutput.caveats.includes(expectedCaveat),
      `expected verbatim staleness caveat in BrainOutput.caveats, got:\n${result.brainOutput.caveats.join("\n")}`,
    );
    assert.ok(
      result.brainOutput.confidence <= 0.3,
      `expected confidence <= 0.3 (stale upstream cap), got ${result.brainOutput.confidence}`,
    );
  } finally {
    await rm(staleFile, { force: true });
  }
});

// =========================================================================
// Vocab coverage — every emitted metric must be registered in
// refinery/vocab/brain-vocabulary.json. Canonical adoption of the helper at
// refinery/lib/vocab-coverage.mts. Lane 2D shipped 9 unregistered metrics
// that pack-level tests passed in isolation; the orphan-concept error only
// fired when master rebuilt (commit ade2485). New packs should copy this
// test verbatim — change the pack-id string only.
// =========================================================================

test("logisticsSwflNowcast: vocab coverage — every emitted metric is registered", async () => {
  const { assertEveryMetricRegistered, parseOutputFromBrainMd } =
    await import("../lib/vocab-coverage.mts");
  const output = await parseOutputFromBrainMd("logistics-swfl-nowcast");
  await assertEveryMetricRegistered(output, "logistics-swfl-nowcast");
});
