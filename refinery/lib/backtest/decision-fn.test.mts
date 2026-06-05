import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  computeBacktestCall,
  type AsOfInput,
  type BacktestCall,
} from "./decision-fn.mts";
import type { ResolvedGradeConfig } from "../../vocab/loader.mts";

// ── config helper (mirrors grade-predictions.test.mts) ──────────────────────────
function cfg(over: Partial<ResolvedGradeConfig>): ResolvedGradeConfig {
  return {
    slug: "test_slug",
    concept_id: "test.concept",
    gradeable: true,
    window_days: 90,
    epsilon: 0.05,
    epsilon_mode: "absolute",
    grade_basis: "delta",
    direction_polarity: "higher_is_bullish",
    source: { window: "slug", epsilon: "slug", polarity: "slug" },
    ...over,
  };
}

// ── input helper ────────────────────────────────────────────────────────────────
function input(over: Partial<AsOfInput>): AsOfInput {
  return {
    slug: "test_slug",
    as_of_date: "2026-01-15",
    as_of_value: 1,
    prior_value: 0,
    source_tag: "lake_tier1",
    ...over,
  };
}

// ── sign basis ──────────────────────────────────────────────────────────────────
test("sign basis: positive value above epsilon is bullish", () => {
  const c = cfg({ grade_basis: "sign", epsilon: 0.5 });
  const call = computeBacktestCall(input({ as_of_value: 1.2 }), c);
  assert.equal(call?.direction, "bullish");
});

test("sign basis: negative value below -epsilon is bearish", () => {
  const c = cfg({ grade_basis: "sign", epsilon: 0.5 });
  const call = computeBacktestCall(input({ as_of_value: -1.2 }), c);
  assert.equal(call?.direction, "bearish");
});

test("sign basis: value inside the deadband is neutral", () => {
  const c = cfg({ grade_basis: "sign", epsilon: 0.5 });
  const call = computeBacktestCall(input({ as_of_value: 0.3 }), c);
  assert.equal(call?.direction, "neutral");
});

test("sign basis + lower_is_bullish: a positive value flips to bearish", () => {
  const c = cfg({
    grade_basis: "sign",
    epsilon: 0.5,
    direction_polarity: "lower_is_bullish",
  });
  const call = computeBacktestCall(input({ as_of_value: 1.2 }), c);
  assert.equal(call?.direction, "bearish");
});

test("sign basis: prior_value null still produces a non-null call (sign never gates on prior)", () => {
  const c = cfg({ grade_basis: "sign", epsilon: 0.5 });
  const call = computeBacktestCall(
    input({ as_of_value: 1.2, prior_value: null }),
    c,
  );
  assert.equal(call?.direction, "bullish");
});

// ── delta basis ─────────────────────────────────────────────────────────────────
test("delta basis: as_of above prior + epsilon is bullish", () => {
  const c = cfg({ grade_basis: "delta", epsilon: 0.05 });
  const call = computeBacktestCall(
    input({ as_of_value: 4.2, prior_value: 4.0 }),
    c,
  );
  assert.equal(call?.direction, "bullish");
});

test("delta basis: as_of below prior - epsilon is bearish", () => {
  const c = cfg({ grade_basis: "delta", epsilon: 0.05 });
  const call = computeBacktestCall(
    input({ as_of_value: 3.8, prior_value: 4.0 }),
    c,
  );
  assert.equal(call?.direction, "bearish");
});

test("delta basis: move inside the deadband is neutral", () => {
  const c = cfg({ grade_basis: "delta", epsilon: 0.05 });
  const call = computeBacktestCall(
    input({ as_of_value: 4.03, prior_value: 4.0 }),
    c,
  );
  assert.equal(call?.direction, "neutral");
});

test("delta basis + lower_is_bullish: an upward move flips to bearish", () => {
  const c = cfg({
    grade_basis: "delta",
    epsilon: 0.05,
    direction_polarity: "lower_is_bullish",
  });
  const call = computeBacktestCall(
    input({ as_of_value: 4.2, prior_value: 4.0 }),
    c,
  );
  assert.equal(call?.direction, "bearish");
});

test("delta basis + relative epsilon: deadband scales with |prior_value|", () => {
  // epsilon 0.05 relative on prior 100 → deadband 5. A move of +4 stays neutral.
  const c = cfg({
    grade_basis: "delta",
    epsilon: 0.05,
    epsilon_mode: "relative",
  });
  const neutral = computeBacktestCall(
    input({ as_of_value: 104, prior_value: 100 }),
    c,
  );
  assert.equal(neutral?.direction, "neutral");
  // A move of +6 clears the deadband → bullish.
  const bullish = computeBacktestCall(
    input({ as_of_value: 106, prior_value: 100 }),
    c,
  );
  assert.equal(bullish?.direction, "bullish");
});

// ── null gates ──────────────────────────────────────────────────────────────────
test("returns null when cfg.gradeable is false", () => {
  const c = cfg({ gradeable: false });
  assert.equal(computeBacktestCall(input({}), c), null);
});

test("returns null when delta basis and prior_value is null", () => {
  const c = cfg({ grade_basis: "delta" });
  assert.equal(computeBacktestCall(input({ prior_value: null }), c), null);
});

test("returns null when direction_polarity is 'none' (Gap 3 guard)", () => {
  const c = cfg({ direction_polarity: "none" });
  assert.equal(computeBacktestCall(input({}), c), null);
});

// ── provenance + echo ───────────────────────────────────────────────────────────
test("source_tag 'odd_extract' is echoed verbatim into the call", () => {
  const c = cfg({ grade_basis: "sign", epsilon: 0.5 });
  const call = computeBacktestCall(
    input({ as_of_value: 1.2, source_tag: "odd_extract" }),
    c,
  );
  assert.equal(call?.source_tag, "odd_extract");
});

test("returned call echoes slug, as_of_date, basis, and polarity from the inputs", () => {
  const c = cfg({
    grade_basis: "delta",
    direction_polarity: "lower_is_bullish",
  });
  const call = computeBacktestCall(
    input({ slug: "tdt_collections_lee", as_of_date: "2026-03-01" }),
    c,
  ) as BacktestCall;
  assert.equal(call.slug, "tdt_collections_lee");
  assert.equal(call.as_of_date, "2026-03-01");
  assert.equal(call.basis, "delta");
  assert.equal(call.polarity, "lower_is_bullish");
});
