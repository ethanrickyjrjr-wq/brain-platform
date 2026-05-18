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
  buildShockLogRow,
  writeShockLogRow,
  LATEST_FDOT_YEAR,
} = await import("../sources/fdot-freight-source.mts");

import type {
  ShockLogRow,
  ShockLogInsertRow,
  FreightSegmentNormalized,
} from "../sources/fdot-freight-source.mts";
import { fragmentId } from "../lib/ids.mts";
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

// =========================================================================
// 9. Lane 2D.1 — shock_log writer.
// =========================================================================
//
// Lifts the row shape from BrainOutput.key_metrics and writes one row into
// data_lake.fdot_freight_nowcast_shock_log per live refine. Fixture-mode is
// a no-op (no Supabase). Writer errors are caught and logged — they do NOT
// fail the brain render.
//
// Reader counterpart: fdot-freight-source.mts::fetchLiveShockLog. The two
// halves close the loop so live mode actually progresses past cold-start.
// =========================================================================

/** Build a minimal BrainOutput shaped like what Stage 4 ships to a
 *  logistics-swfl-nowcast writer. Only the fields the writer reads are
 *  populated. Verbose because each metric's full BrainOutputMetric shape is
 *  required (Lane 1B contract). */
function makeNowcastBrainOutput(
  overrides: {
    refined_at?: string;
    deviation_z?: number | null;
    shock_state?:
      | "normal"
      | "anomaly"
      | "structural_break"
      | "insufficient_history";
    baseline_validity_flag?: "valid" | "stale-structural";
    consecutive_breach_days?: number;
    current_activity_tons_year?: number | null;
    faf5_inbound_flow_tons_year?: number | null;
  } = {},
): BrainOutput {
  const refined_at = overrides.refined_at ?? "2026-05-18T16:00:00.000Z";
  const fetched_at = refined_at;
  const src = {
    url: "test://fdot",
    fetched_at,
    tier: 2 as const,
    citation: "test FDOT freight",
  };
  const key_metrics: BrainOutput["key_metrics"] = [
    {
      metric: "current_activity_tons_year",
      value: overrides.current_activity_tons_year ?? 240_000_000,
      direction: "stable",
      label: "test current activity",
      variable_type: "extensive",
      units: "tons/year",
      display_format: "count",
      source: src,
    },
    {
      metric: "shock_state",
      value: overrides.shock_state ?? "normal",
      direction: "stable",
      label: "test shock state",
      variable_type: "categorical",
      source: src,
    },
    {
      metric: "baseline_validity_flag",
      value: overrides.baseline_validity_flag ?? "valid",
      direction: "stable",
      label: "test flag",
      variable_type: "categorical",
      source: src,
    },
    {
      metric: "consecutive_breach_days",
      value: overrides.consecutive_breach_days ?? 0,
      direction: "stable",
      label: "test counter",
      variable_type: "extensive",
      units: "days",
      display_format: "count",
      source: src,
    },
  ];
  if (overrides.deviation_z !== undefined && overrides.deviation_z !== null) {
    key_metrics.push({
      metric: "deviation_z",
      value: overrides.deviation_z,
      direction: "stable",
      label: "test z",
      variable_type: "intensive",
      units: "z-score",
      display_format: "ratio",
      source: src,
    });
  }
  if (
    overrides.faf5_inbound_flow_tons_year !== undefined &&
    overrides.faf5_inbound_flow_tons_year !== null
  ) {
    key_metrics.push({
      metric: "faf5_inbound_flow_tons_year",
      value: overrides.faf5_inbound_flow_tons_year,
      direction: "stable",
      label: "test faf5",
      variable_type: "extensive",
      units: "tons/year",
      display_format: "count",
      source: src,
    });
  }
  return {
    brain_id: "logistics-swfl-nowcast",
    version: 1,
    refined_at,
    direction: "neutral",
    magnitude: 0,
    drivers: [],
    overrides: [],
    conclusion: "test conclusion",
    key_metrics,
    caveats: [],
    contradicts: [],
    confidence: 0.7,
    joint_integrity: 1,
    confidence_dispersion: 0,
    chain_depth: 0,
    trust_tier: 2,
    upstream_count: 1,
    relevance: {
      decay_curve: "days",
      half_life_hours: 24,
      computed_at: refined_at,
    },
    exogenous_signals: [],
  };
}

test("buildShockLogRow: lifts the six payload fields verbatim from BrainOutput.key_metrics", () => {
  const out = makeNowcastBrainOutput({
    refined_at: "2026-05-18T16:00:00.000Z",
    deviation_z: -4.2,
    shock_state: "anomaly",
    baseline_validity_flag: "valid",
    consecutive_breach_days: 3,
    current_activity_tons_year: 91_816_480,
    faf5_inbound_flow_tons_year: 1_539_664_000,
  });
  const row = buildShockLogRow(out);
  assert.equal(row.refined_at, "2026-05-18T16:00:00.000Z");
  assert.equal(row.deviation_z, -4.2);
  assert.equal(row.shock_state, "anomaly");
  assert.equal(row.baseline_validity_flag, "valid");
  assert.equal(row.consecutive_breach_days, 3);
  assert.equal(row.current_activity_tons_year, 91_816_480);
  assert.equal(row.faf5_inbound_flow_tons_year, 1_539_664_000);
});

test("buildShockLogRow: cold-start (no deviation_z metric, no faf5 metric) → both fields are null", () => {
  const out = makeNowcastBrainOutput({
    shock_state: "insufficient_history",
    consecutive_breach_days: 0,
    current_activity_tons_year: 242_430_080,
  });
  // No deviation_z, no faf5 metric emitted → suppressed at producer time
  const row = buildShockLogRow(out);
  assert.equal(row.deviation_z, null);
  assert.equal(row.faf5_inbound_flow_tons_year, null);
  assert.equal(row.shock_state, "insufficient_history");
  assert.equal(row.consecutive_breach_days, 0);
  assert.equal(row.current_activity_tons_year, 242_430_080);
});

test("writeShockLogRow: non-nowcast packs are skipped (no-op, returns kind=skipped)", async () => {
  const out = makeNowcastBrainOutput();
  const result = await writeShockLogRow({
    packId: "master",
    brainOutput: out,
    // Inject creds so the only reason this skips is the pack-id gate.
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "fake-key",
  });
  assert.deepEqual(result, { kind: "skipped", reason: "not-nowcast" });
});

test("writeShockLogRow: fixture mode is a no-op (returns kind=skipped, reason=fixture-mode)", async () => {
  // process.env REFINERY_SOURCE is already "fixture" at top of this test file.
  const out = makeNowcastBrainOutput();
  const result = await writeShockLogRow({
    packId: "logistics-swfl-nowcast",
    brainOutput: out,
    // Inject creds so the only reason this skips is the source-mode gate.
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "fake-key",
    // Force the source-mode check to read "fixture" even if the env shifted.
    sourceMode: "fixture",
  });
  assert.deepEqual(result, { kind: "skipped", reason: "fixture-mode" });
});

test("writeShockLogRow: skipped when supabase env is missing in live mode", async () => {
  const out = makeNowcastBrainOutput();
  const result = await writeShockLogRow({
    packId: "logistics-swfl-nowcast",
    brainOutput: out,
    supabaseUrl: undefined,
    supabaseKey: undefined,
    sourceMode: "live",
  });
  assert.deepEqual(result, { kind: "skipped", reason: "no-supabase-env" });
});

test("writeShockLogRow: live mode invokes the injected client with the right table + row shape", async () => {
  const out = makeNowcastBrainOutput({
    refined_at: "2026-05-19T03:00:00.000Z",
    deviation_z: 0.1,
    shock_state: "normal",
    baseline_validity_flag: "valid",
    consecutive_breach_days: 0,
    current_activity_tons_year: 240_000_000,
    faf5_inbound_flow_tons_year: 1_539_664_000,
  });
  let capturedSchema: string | null = null;
  let capturedTable: string | null = null;
  let capturedRow: unknown = null;
  const fakeClient = {
    schema(name: string) {
      capturedSchema = name;
      return {
        from(table: string) {
          capturedTable = table;
          return {
            async insert(row: unknown) {
              capturedRow = row;
              return { error: null };
            },
          };
        },
      };
    },
  };
  const result = await writeShockLogRow({
    packId: "logistics-swfl-nowcast",
    brainOutput: out,
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "fake-key",
    sourceMode: "live",
    clientFactory: () =>
      fakeClient as unknown as ReturnType<
        typeof import("@supabase/supabase-js").createClient
      >,
  });
  assert.equal(result.kind, "inserted");
  assert.equal(capturedSchema, "data_lake");
  assert.equal(capturedTable, "fdot_freight_nowcast_shock_log");
  assert.deepEqual(capturedRow, {
    refined_at: "2026-05-19T03:00:00.000Z",
    deviation_z: 0.1,
    shock_state: "normal",
    baseline_validity_flag: "valid",
    consecutive_breach_days: 0,
    current_activity_tons_year: 240_000_000,
    faf5_inbound_flow_tons_year: 1_539_664_000,
  });
});

test("writeShockLogRow: insert error is caught (returns kind=error, does NOT throw)", async () => {
  const out = makeNowcastBrainOutput();
  const fakeClient = {
    schema() {
      return {
        from() {
          return {
            async insert() {
              return { error: { message: "permission denied for table" } };
            },
          };
        },
      };
    },
  };
  const result = await writeShockLogRow({
    packId: "logistics-swfl-nowcast",
    brainOutput: out,
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "fake-key",
    sourceMode: "live",
    clientFactory: () =>
      fakeClient as unknown as ReturnType<
        typeof import("@supabase/supabase-js").createClient
      >,
  });
  assert.equal(result.kind, "error");
  if (result.kind === "error") {
    assert.match(result.message, /permission denied/);
  }
});

test("writeShockLogRow: thrown client error is caught (network/transport failure)", async () => {
  const out = makeNowcastBrainOutput();
  const fakeClient = {
    schema() {
      return {
        from() {
          return {
            async insert(): Promise<{ error: null }> {
              throw new Error("ENETUNREACH");
            },
          };
        },
      };
    },
  };
  const result = await writeShockLogRow({
    packId: "logistics-swfl-nowcast",
    brainOutput: out,
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "fake-key",
    sourceMode: "live",
    clientFactory: () =>
      fakeClient as unknown as ReturnType<
        typeof import("@supabase/supabase-js").createClient
      >,
  });
  assert.equal(result.kind, "error");
  if (result.kind === "error") {
    assert.match(result.message, /ENETUNREACH/);
  }
});

// =========================================================================
// 10. Lane 2D.1 — END-TO-END pipeline integration test.
//
// "After N simulated live runs, shock_log has N rows and the z-score
//  transitions from insufficient_history to an actual number once the
//  cold-start threshold is crossed."
//
// Mechanics: an in-memory ShockLogRow[] accumulator stands in for
// data_lake.fdot_freight_nowcast_shock_log. Each "run" of the loop:
//   1. Builds fragments = [synthetic FDOT segments] ∪ [accumulator-as-fragments]
//      ∪ [synthetic logistics-swfl baseline].
//   2. Calls the pack's corpusSummary + outputProducer (no writer here —
//      writeShockLogRow's unit tests already cover the insert path; this
//      test proves the FULL pipeline math/state-machine closes the loop).
//   3. Lifts the writer ROW shape from BrainOutput.key_metrics via the same
//      buildShockLogRow helper the writer uses in production.
//   4. Pushes the lifted row (mapped back to the connector's ShockLogRow
//      fragment shape) onto the accumulator. NEXT iteration will read it.
//   5. Asserts the run's shock_state + deviation_z behavior at the
//      key thresholds (1, 89, 90, 95).
// =========================================================================

/** Two synthetic in-band segments. Their summed activity is the target
 *  current_activity each run produces — small + deterministic for the test. */
function buildTwoInBandSegments(): FreightSegmentNormalized[] {
  // activity per segment = aadt × tfctr × 16 × 365. Picking two distinct
  // segments so freight_segment_count > 1 and the sum is non-trivial.
  // seg1: 10_000 × 0.05 × 16 × 365 = 2,920,000 tons/year
  // seg2: 12_000 × 0.06 × 16 × 365 = 4,204,800 tons/year
  // total = 7,124,800 tons/year. Sits comfortably inside any rolling
  // baseline seeded around the same value.
  return [
    {
      kind: "fdot-freight-segment",
      county: "LEE",
      year: LATEST_FDOT_YEAR,
      roadway: "I-75",
      desc_frm: "TestSegA-from",
      desc_to: "TestSegA-to",
      aadt: 10_000,
      tfctr: 0.05,
      shape_length_m: 1_000,
      activity_tons_per_year: 10_000 * 0.05 * 16 * 365,
    },
    {
      kind: "fdot-freight-segment",
      county: "COLLIER",
      year: LATEST_FDOT_YEAR,
      roadway: "US-41",
      desc_frm: "TestSegB-from",
      desc_to: "TestSegB-to",
      aadt: 12_000,
      tfctr: 0.06,
      shape_length_m: 1_000,
      activity_tons_per_year: 12_000 * 0.06 * 16 * 365,
    },
  ];
}

/** Build a synthetic baseline BrainOutput so the brain-input source isn't
 *  empty — Path B doesn't need it for the math but the producer references it
 *  for the FAF5 context paragraph. Returned as a brain-input fragment. */
function buildSyntheticBaselineFragment(refined_at: string): RawFragment {
  const baseline: BrainOutput = {
    brain_id: "logistics-swfl",
    version: 1,
    refined_at,
    direction: "neutral",
    magnitude: 0.5,
    drivers: [],
    overrides: [],
    conclusion: "Integration-test baseline.",
    key_metrics: [
      {
        metric: "inbound_freight_tons_swfl",
        value: 1_539_664,
        direction: "stable",
        label: "test inbound",
        variable_type: "extensive",
        units: "thousand tons/year",
        display_format: "count",
        source: {
          url: "test://baseline",
          fetched_at: refined_at,
          tier: 1,
          citation: "test baseline",
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
      computed_at: refined_at,
    },
    exogenous_signals: [],
  };
  return {
    fragment_id: fragmentId("brain-input:logistics-swfl", "integration"),
    source_id: "brain-input:logistics-swfl",
    source_trust_tier: 2,
    fetched_at: refined_at,
    raw: { upstream_id: "logistics-swfl" },
    normalized: {
      kind: "brain-input",
      upstream_id: "logistics-swfl",
      output: baseline,
    } as unknown as Record<string, unknown>,
  };
}

/** Wrap a ShockLogRow as a RawFragment so it flows through the same
 *  shockLogFrom() reader the pack uses in production. */
function logRowToFragment(row: ShockLogRow, fetched_at: string): RawFragment {
  return {
    fragment_id: fragmentId("fdot_freight_swfl", `shock-${row.refined_at}`),
    source_id: "fdot_freight_swfl",
    source_trust_tier: 2,
    fetched_at,
    raw: { ...row } as Record<string, unknown>,
    normalized: row as unknown as Record<string, unknown>,
  };
}

/** Wrap a FreightSegmentNormalized as a RawFragment so it flows through the
 *  same segmentsFrom() reader the pack uses in production. */
function segmentToFragment(
  seg: FreightSegmentNormalized,
  fetched_at: string,
): RawFragment {
  return {
    fragment_id: fragmentId(
      "fdot_freight_swfl",
      `${seg.county.toLowerCase()}-${seg.roadway}-${seg.desc_frm}-${seg.desc_to}-${seg.year}`,
    ),
    source_id: "fdot_freight_swfl",
    source_trust_tier: 2,
    fetched_at,
    raw: { ...seg } as Record<string, unknown>,
    normalized: seg as unknown as Record<string, unknown>,
  };
}

/** Lift the row the writer WOULD insert and append it (in the connector's
 *  ShockLogRow fragment shape) to the in-memory accumulator. Returns the
 *  lifted insert-row for assertions. */
function simulateWriterAppend(
  accumulator: ShockLogRow[],
  brainOutput: BrainOutput,
): ShockLogInsertRow {
  const row = buildShockLogRow(brainOutput);
  accumulator.push({
    kind: "fdot-freight-shock-log",
    refined_at: row.refined_at,
    deviation_z: row.deviation_z,
    shock_state: row.shock_state,
    baseline_validity_flag: row.baseline_validity_flag,
    current_activity_tons_year: row.current_activity_tons_year,
  });
  return row;
}

test("Lane 2D.1 end-to-end: 95-run loop — accumulator grows by 1 each run, shock_state transitions at cold-start threshold (run 90)", async () => {
  // 95 > COLD_START_THRESHOLD_DAYS (90) gives headroom. We pick a base date
  // and advance one day per run so refined_at is monotonic.
  const N = 95;
  const baseMs = Date.parse("2026-01-01T00:00:00.000Z");
  const accumulator: ShockLogRow[] = [];
  const segments = buildTwoInBandSegments();

  // Per-run BrainOutput snapshots we want to assert at thresholds.
  const snapshotByRun = new Map<number, BrainOutput>();

  for (let runIdx = 0; runIdx < N; runIdx++) {
    const runIso = new Date(baseMs + runIdx * 86_400_000).toISOString();
    const fragments: RawFragment[] = [
      buildSyntheticBaselineFragment(runIso),
      ...segments.map((s) => segmentToFragment(s, runIso)),
      ...accumulator.map((r) => logRowToFragment(r, runIso)),
    ];

    // Drive the production pipeline.
    logisticsSwflNowcast.corpusSummary!(fragments);
    const producerResult = logisticsSwflNowcast.outputProducer!({
      pack: logisticsSwflNowcast,
      version: runIdx + 1,
      refined_at: runIso,
      citations: [],
      facts: [],
      recentNote: "",
    } as unknown as Parameters<
      NonNullable<typeof logisticsSwflNowcast.outputProducer>
    >[0]);

    // Synthesize a minimal BrainOutput from the producer result (only the
    // fields the writer reads — refined_at + key_metrics). Stage 4 normally
    // builds this; we shortcut here because the writer is the unit under test.
    const brainOutput: BrainOutput = {
      brain_id: "logistics-swfl-nowcast",
      version: runIdx + 1,
      refined_at: runIso,
      direction: producerResult.direction,
      magnitude: producerResult.magnitude,
      drivers: [],
      overrides: [],
      conclusion: producerResult.conclusion,
      key_metrics: producerResult.key_metrics,
      caveats: producerResult.caveats,
      contradicts: producerResult.contradicts,
      confidence: 0.7,
      joint_integrity: 1,
      confidence_dispersion: 0,
      chain_depth: 0,
      trust_tier: 2,
      upstream_count: 1,
      relevance: {
        decay_curve: "days",
        half_life_hours: 24,
        computed_at: runIso,
      },
      exogenous_signals: [],
    };

    // CRITICAL: append a row to the in-memory log so the NEXT run sees it.
    simulateWriterAppend(accumulator, brainOutput);
    snapshotByRun.set(runIdx + 1, brainOutput);
  }

  // ---- Assertion 1: log grew by exactly 1 per run ----
  assert.equal(
    accumulator.length,
    N,
    `expected accumulator to have ${N} rows after ${N} runs, got ${accumulator.length}`,
  );

  // ---- Helper: pull a metric value from a BrainOutput snapshot ----
  function metricValue(brainOutput: BrainOutput, name: string): unknown {
    return brainOutput.key_metrics.find((m) => m.metric === name)?.value;
  }
  function hasMetric(brainOutput: BrainOutput, name: string): boolean {
    return brainOutput.key_metrics.some((m) => m.metric === name);
  }

  // ---- Assertion 2: run 1 → insufficient_history, deviation_z suppressed ----
  const run1 = snapshotByRun.get(1)!;
  assert.equal(
    metricValue(run1, "shock_state"),
    "insufficient_history",
    "run 1 must emit shock_state=insufficient_history (zero history days at run time)",
  );
  assert.equal(
    hasMetric(run1, "deviation_z"),
    false,
    "run 1 must NOT emit deviation_z (cold-start suppression)",
  );
  assert.equal(
    metricValue(run1, "history_days_observed"),
    0,
    "run 1 sees 0 prior rows (the accumulator is empty when it runs)",
  );

  // ---- Assertion 3: run 89 → still insufficient_history (history_days_observed = 88) ----
  // At run 89, the accumulator has 88 prior rows (rows 1..88). All 88 are
  // logged with current_activity_tons_year set on the cold-start runs because
  // the producer emits the current_activity metric REGARDLESS of cold-start
  // (only deviation_z + deviation_pct are suppressed). So 88 days < 90 →
  // still insufficient_history.
  const run89 = snapshotByRun.get(89)!;
  assert.equal(
    metricValue(run89, "shock_state"),
    "insufficient_history",
    "run 89 must still be insufficient_history (88 history days < 90 threshold)",
  );
  assert.equal(metricValue(run89, "history_days_observed"), 88);
  assert.equal(
    hasMetric(run89, "deviation_z"),
    false,
    "run 89 must still NOT emit deviation_z",
  );

  // ---- Assertion 4: run 90 → still insufficient_history (history_days_observed = 89, ONE short) ----
  const run90 = snapshotByRun.get(90)!;
  assert.equal(
    metricValue(run90, "history_days_observed"),
    89,
    "run 90 sees 89 prior rows (off-by-one: 1..89)",
  );
  assert.equal(
    metricValue(run90, "shock_state"),
    "insufficient_history",
    "run 90 must still be insufficient_history (89 < 90)",
  );

  // ---- Assertion 5: run 91 → COLD-START THRESHOLD CROSSED ----
  // At run 91, the accumulator has 90 prior rows, history_days_observed === 90,
  // cold-start gate releases and shock_state transitions off
  // "insufficient_history". This is the transition the integration test
  // exists to prove.
  //
  // NOTE on deviation_z at this run: when every prior run logged an
  // IDENTICAL current_activity_tons_year (the segments are deterministic
  // across runs), the rolling stddev is 0 and the rolling-stats guard at
  // `logistics-swfl-nowcast.mts:rollingActivityStats` correctly returns
  // null for deviation_z. That's correct behavior — z is undefined when the
  // denominator is 0. The second integration test below ("deviation_z is a
  // finite NUMBER...") injects a per-run perturbation to force stddev > 0
  // and asserts the real-z path explicitly.
  const run91 = snapshotByRun.get(91)!;
  assert.equal(
    metricValue(run91, "history_days_observed"),
    90,
    "run 91 sees exactly 90 prior rows → cold-start threshold met",
  );
  assert.notEqual(
    metricValue(run91, "shock_state"),
    "insufficient_history",
    "run 91 must transition off insufficient_history once 90-day threshold is met",
  );

  // ---- Assertion 6: run 95 → not insufficient_history; deviation_z handled per stddev guard ----
  // 95 runs in, the rolling window has been saturated for 5 runs. shock_state
  // is some real classification (normal/anomaly/etc.) — the integration test
  // proves the gate is open. deviation_z's number-vs-null behavior depends
  // on the rolling stddev, exercised explicitly in the next test.
  const run95 = snapshotByRun.get(95)!;
  assert.notEqual(
    metricValue(run95, "shock_state"),
    "insufficient_history",
    "run 95 must stay off insufficient_history (history is fully saturated)",
  );
  // The accumulator row for run 95 was lifted via buildShockLogRow. Verify
  // the row that the WRITER would have INSERTed carries the same shock_state.
  const writerRow95 = accumulator[94];
  assert.notEqual(
    writerRow95.shock_state,
    "insufficient_history",
    "writer's row for run 95 must mirror the producer's non-cold shock_state",
  );
  assert.equal(
    writerRow95.refined_at,
    snapshotByRun.get(95)!.refined_at,
    "writer's row refined_at must match the BrainOutput refined_at",
  );
});

test("Lane 2D.1 end-to-end: deviation_z is a finite NUMBER (not null) when current activity diverges from the rolling baseline", async () => {
  // Same loop as the prior test, but on run 91 we synthesize a SPIKED segment
  // set so current_activity differs from the rolling mean — forces stddev > 0
  // via the spike + the prior baseline values, so deviation_z lands real.
  const baseMs = Date.parse("2026-01-01T00:00:00.000Z");
  const accumulator: ShockLogRow[] = [];
  const inBandSegments = buildTwoInBandSegments();
  const inBandActivity = inBandSegments.reduce(
    (s, seg) => s + seg.activity_tons_per_year,
    0,
  );

  // Spike segments — 50% more activity than the rolling baseline.
  const spikedSegments: FreightSegmentNormalized[] = inBandSegments.map(
    (s) => ({
      ...s,
      aadt: Math.round(s.aadt * 1.5),
      activity_tons_per_year: s.aadt * 1.5 * s.tfctr * 16 * 365,
    }),
  );

  // 90 baseline runs to fill the rolling window with the in-band activity,
  // then ONE more run with a small in-band perturbation (so stddev > 0),
  // then the spike run. So 92 total. Reads cleaner than burning 95 runs.
  const totalRuns = 92;

  for (let runIdx = 0; runIdx < totalRuns; runIdx++) {
    const runIso = new Date(baseMs + runIdx * 86_400_000).toISOString();
    let segmentsThisRun = inBandSegments;
    // On the SECOND-to-last run, perturb slightly so the rolling stddev is
    // non-zero. Without this all 90 baseline values are identical → σ = 0 →
    // the rolling-stats guard forces deviation_z to null. A real production
    // log would have day-to-day noise; the test injects that explicitly.
    if (runIdx === totalRuns - 2) {
      segmentsThisRun = inBandSegments.map((s) => ({
        ...s,
        activity_tons_per_year: s.activity_tons_per_year * 1.01,
      }));
    }
    // On the LAST run, spike.
    if (runIdx === totalRuns - 1) {
      segmentsThisRun = spikedSegments;
    }
    const fragments: RawFragment[] = [
      buildSyntheticBaselineFragment(runIso),
      ...segmentsThisRun.map((s) => segmentToFragment(s, runIso)),
      ...accumulator.map((r) => logRowToFragment(r, runIso)),
    ];

    logisticsSwflNowcast.corpusSummary!(fragments);
    const producerResult = logisticsSwflNowcast.outputProducer!({
      pack: logisticsSwflNowcast,
      version: runIdx + 1,
      refined_at: runIso,
      citations: [],
      facts: [],
      recentNote: "",
    } as unknown as Parameters<
      NonNullable<typeof logisticsSwflNowcast.outputProducer>
    >[0]);

    const brainOutput: BrainOutput = {
      brain_id: "logistics-swfl-nowcast",
      version: runIdx + 1,
      refined_at: runIso,
      direction: producerResult.direction,
      magnitude: producerResult.magnitude,
      drivers: [],
      overrides: [],
      conclusion: producerResult.conclusion,
      key_metrics: producerResult.key_metrics,
      caveats: producerResult.caveats,
      contradicts: producerResult.contradicts,
      confidence: 0.7,
      joint_integrity: 1,
      confidence_dispersion: 0,
      chain_depth: 0,
      trust_tier: 2,
      upstream_count: 1,
      relevance: {
        decay_curve: "days",
        half_life_hours: 24,
        computed_at: runIso,
      },
      exogenous_signals: [],
    };

    simulateWriterAppend(accumulator, brainOutput);

    if (runIdx === totalRuns - 1) {
      // The spike run: assert deviation_z is a real finite number AND
      // is positive (the spiked activity is HIGHER than the baseline mean).
      const z = brainOutput.key_metrics.find((m) => m.metric === "deviation_z");
      assert.ok(z, "spike run must emit deviation_z");
      assert.ok(
        typeof z!.value === "number" && Number.isFinite(z!.value),
        `spike run deviation_z must be finite, got ${String(z!.value)}`,
      );
      assert.ok(
        Number(z!.value) > 0,
        `spike run deviation_z must be positive (current > baseline), got ${z!.value}`,
      );
      // The activity actually emitted by the spike run:
      const ca = brainOutput.key_metrics.find(
        (m) => m.metric === "current_activity_tons_year",
      );
      const ca_value = Number(ca!.value);
      assert.ok(
        ca_value > inBandActivity,
        `spike current_activity (${ca_value}) must exceed baseline (${inBandActivity})`,
      );
    }
  }

  assert.equal(accumulator.length, totalRuns);
});
