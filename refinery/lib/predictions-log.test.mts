import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPredictionRow,
  logPrediction,
  type PredictionRow,
} from "./predictions-log.mts";
import type { BrainOutput } from "../types/brain-output.mts";

function makeOutput(overrides: Partial<BrainOutput> = {}): BrainOutput {
  return {
    brain_id: "master",
    version: 7,
    refined_at: "2026-05-17T16:39:09.000Z",
    direction: "bearish",
    magnitude: 0.74,
    drivers: [],
    overrides: [],
    conclusion: "Macro tightening + sector credit distress dominate the read.",
    key_metrics: [
      { metric: "sofr_rate", value: 5.3, direction: "rising", label: "SOFR" },
      {
        metric: "fl_lfpr",
        value: 60.1,
        direction: "falling",
        label: "FL LFPR",
      },
    ],
    caveats: ["Tourism reads bullish — see contradicts."],
    contradicts: ["macro-us (bearish) vs tourism-tdt (bullish)"],
    confidence: 0.71,
    trust_tier: 2,
    upstream_count: 5,
    relevance: {
      decay_curve: "weeks",
      half_life_hours: 720,
      computed_at: "2026-05-17T16:39:09.000Z",
    },
    exogenous_signals: [],
    ...overrides,
  };
}

test("buildPredictionRow maps BrainOutput → row with metadata bag", () => {
  const row = buildPredictionRow(makeOutput());
  assert.equal(row.brain_id, "master");
  assert.equal(row.confidence, 0.71);
  assert.equal(row.refined_at, "2026-05-17T16:39:09.000Z");
  assert.equal(row.prediction_window, null);
  assert.equal(row.metadata.direction, "bearish");
  assert.equal(row.metadata.trust_tier, 2);
  assert.equal(row.metadata.upstream_count, 5);
  assert.equal(row.metadata.relevance_half_life_hours, 720);
  assert.deepEqual(row.metadata.contradicts, [
    "macro-us (bearish) vs tourism-tdt (bullish)",
  ]);
  assert.equal(row.metadata.top_key_metrics.length, 2);
  assert.equal(row.metadata.version, 7);
});

test("buildPredictionRow caps top_key_metrics at 5 to keep JSONB lean", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    metric: `m${i}`,
    value: i,
    direction: "stable" as const,
    label: `Metric ${i}`,
  }));
  const row = buildPredictionRow(makeOutput({ key_metrics: many }));
  assert.equal(row.metadata.top_key_metrics.length, 5);
  assert.equal(row.metadata.top_key_metrics[0].metric, "m0");
  assert.equal(row.metadata.top_key_metrics[4].metric, "m4");
});

test("logPrediction skips non-master packs (no-op)", async () => {
  const result = await logPrediction({
    packId: "cre-swfl",
    brainOutput: makeOutput({ brain_id: "cre-swfl" }),
    // env injected so we'd otherwise try to insert; we should still skip
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "fake-key",
  });
  assert.deepEqual(result, { kind: "skipped", reason: "not-master" });
});

test("logPrediction skips when supabase env is missing", async () => {
  // Save and clear env so process.env fallback finds nothing.
  const prevUrl = process.env.BRAINS_SUPABASE_URL;
  const prevKey = process.env.BRAINS_SUPABASE_SERVICE_KEY;
  delete process.env.BRAINS_SUPABASE_URL;
  delete process.env.BRAINS_SUPABASE_SERVICE_KEY;
  try {
    const result = await logPrediction({
      packId: "master",
      brainOutput: makeOutput(),
    });
    assert.deepEqual(result, { kind: "skipped", reason: "no-supabase-env" });
  } finally {
    if (prevUrl) process.env.BRAINS_SUPABASE_URL = prevUrl;
    if (prevKey) process.env.BRAINS_SUPABASE_SERVICE_KEY = prevKey;
  }
});

test("PredictionRow shape stays explicit (compile-time + runtime check)", () => {
  // Pure structural test — if the type drifts and adds a required field,
  // this assignment fails to compile, alerting before runtime.
  const row: PredictionRow = buildPredictionRow(makeOutput());
  const expectedKeys: (keyof PredictionRow)[] = [
    "brain_id",
    "refined_at",
    "conclusion",
    "confidence",
    "prediction_window",
    "metadata",
  ];
  for (const k of expectedKeys) {
    assert.ok(k in row, `row missing key ${k}`);
  }
});
