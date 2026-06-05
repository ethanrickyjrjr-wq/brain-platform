import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  computePersistenceNull,
  computeSkillScore,
  type ScoredCall,
} from "./skill-baseline.mts";

// ── helper ──────────────────────────────────────────────────────────────────────
function call(over: Partial<ScoredCall>): ScoredCall {
  return {
    slug: "s",
    family: "fam",
    as_of_date: "2026-01-01",
    predicted: "bullish",
    observed: "bullish",
    correct: true,
    source_tag: "lake_tier1",
    ...over,
  };
}

// ── computePersistenceNull ──────────────────────────────────────────────────────
test("computePersistenceNull: 3-period sequence yields 2 predictions = the prior values", () => {
  const out = computePersistenceNull([
    { date: "d1", direction: "bullish" },
    { date: "d2", direction: "bearish" },
    { date: "d3", direction: "bullish" },
  ]);
  assert.deepEqual(out, [
    { date: "d2", predicted: "bullish" },
    { date: "d3", predicted: "bearish" },
  ]);
});

test("computePersistenceNull: single element yields [], empty yields []", () => {
  assert.deepEqual(
    computePersistenceNull([{ date: "d1", direction: "bullish" }]),
    [],
  );
  assert.deepEqual(computePersistenceNull([]), []);
});

test("computePersistenceNull: neutral observations ARE used as persistence predictions", () => {
  const out = computePersistenceNull([
    { date: "d1", direction: "neutral" },
    { date: "d2", direction: "bullish" },
  ]);
  assert.deepEqual(out, [{ date: "d2", predicted: "neutral" }]);
});

// ── computeSkillScore: core accuracy + lift ─────────────────────────────────────
test("all in-set calls correct, no neutral target: system_accuracy = 1.0 and lift = 1.0 - persistence", () => {
  // one slug, 3 dated calls; first (d1) has no prior → excluded. d2,d3 are in-set.
  const score = computeSkillScore([
    call({ as_of_date: "2026-01-01", observed: "bullish", correct: true }),
    call({ as_of_date: "2026-02-01", observed: "bullish", correct: true }),
    call({ as_of_date: "2026-03-01", observed: "bearish", correct: true }),
  ]);
  assert.equal(score.n_calls, 2);
  assert.equal(score.system_accuracy, 1.0);
  // persistence: d2 predicts d1's bullish (hit), d3 predicts d2's bullish vs bearish (miss) → 0.5
  assert.equal(score.persistence_accuracy, 0.5);
  assert.equal(score.lift, score.system_accuracy - score.persistence_accuracy);
});

test("neutral observed is excluded as a target but still serves as the prior for the next call", () => {
  // d1 bullish, d2 bullish, d3 NEUTRAL, d4 bullish — candidates d2,d3,d4; d3 dropped (neutral target).
  const score = computeSkillScore([
    call({ as_of_date: "2026-01-01", observed: "bullish" }),
    call({ as_of_date: "2026-02-01", observed: "bullish" }),
    call({ as_of_date: "2026-03-01", observed: "neutral" }),
    call({ as_of_date: "2026-04-01", observed: "bullish" }),
  ]);
  assert.equal(score.n_calls, 2); // d2 and d4 only
});

test("neutral prior makes the persistence null predict neutral, which counts as a persistence miss", () => {
  // d1 neutral, d2 bullish, d3 bullish. Scored targets: d2, d3 (d1 = first, excluded).
  //   d2: prior d1 is neutral → persistence predicts neutral vs bullish → MISS
  //   d3: prior d2 is bullish → persistence predicts bullish vs bullish → HIT
  // → persistence gets exactly 1 of 2, proving the neutral prior was not skipped.
  const score = computeSkillScore([
    call({ as_of_date: "2026-01-01", observed: "neutral", correct: true }),
    call({ as_of_date: "2026-02-01", observed: "bullish", correct: true }),
    call({ as_of_date: "2026-03-01", observed: "bullish", correct: true }),
  ]);
  assert.equal(score.n_calls, 2);
  assert.equal(score.n_persistence_correct, 1);
  assert.equal(score.persistence_accuracy, 0.5);
});

test("lift equals system_accuracy minus persistence_accuracy exactly", () => {
  const score = computeSkillScore([
    call({ as_of_date: "2026-01-01", observed: "bullish", correct: true }),
    call({ as_of_date: "2026-02-01", observed: "bearish", correct: false }),
    call({ as_of_date: "2026-03-01", observed: "bullish", correct: true }),
  ]);
  assert.equal(score.lift, score.system_accuracy - score.persistence_accuracy);
});

// ── n_families: derived from the input calls, not a separate param ───────────────
test("n_families counts distinct family strings across the input calls", () => {
  const score = computeSkillScore([
    call({ slug: "a", family: "A" }),
    call({ slug: "b", family: "A" }),
    call({ slug: "c", family: "B" }),
  ]);
  assert.equal(score.n_families, 2);
});

test("n_families reflects only the families actually present (2 of a possible 5)", () => {
  const score = computeSkillScore([
    call({ slug: "a", family: "sba" }),
    call({ slug: "b", family: "tdt" }),
  ]);
  assert.equal(score.n_families, 2);
});

// ── empty / zero-denominator: no throw ──────────────────────────────────────────
test("empty calls: every field zero, no throw", () => {
  const score = computeSkillScore([]);
  assert.equal(score.n_calls, 0);
  assert.equal(score.n_families, 0);
  assert.equal(score.system_accuracy, 0);
  assert.equal(score.lake_tier1_accuracy, 0);
  assert.equal(score.persistence_accuracy, 0);
  assert.equal(score.lift, 0);
});

test("single call per slug: no prior anywhere → n_calls 0, accuracies 0", () => {
  const score = computeSkillScore([
    call({ slug: "a", as_of_date: "2026-01-01" }),
    call({ slug: "b", as_of_date: "2026-01-01" }),
  ]);
  assert.equal(score.n_calls, 0);
  assert.equal(score.system_accuracy, 0);
});

test("n_correct and n_persistence_correct are raw integers", () => {
  const score = computeSkillScore([
    call({ as_of_date: "2026-01-01", observed: "bullish", correct: true }),
    call({ as_of_date: "2026-02-01", observed: "bullish", correct: true }),
  ]);
  assert.equal(Number.isInteger(score.n_correct), true);
  assert.equal(Number.isInteger(score.n_persistence_correct), true);
  assert.equal(score.n_correct, 1); // only d2 is in-set
});

// ── ODD provenance is NOT silent: the structural proof ──────────────────────────
test("mixed lake_tier1 + odd_extract: blended system_accuracy differs from lake_tier1_accuracy", () => {
  const score = computeSkillScore([
    // slug a — all lake_tier1, in-set d2,d3 both correct
    call({
      slug: "a",
      family: "tdt",
      as_of_date: "2026-01-01",
      source_tag: "lake_tier1",
      observed: "bullish",
      correct: true,
    }),
    call({
      slug: "a",
      family: "tdt",
      as_of_date: "2026-02-01",
      source_tag: "lake_tier1",
      observed: "bullish",
      correct: true,
    }),
    call({
      slug: "a",
      family: "tdt",
      as_of_date: "2026-03-01",
      source_tag: "lake_tier1",
      observed: "bullish",
      correct: true,
    }),
    // slug b — odd_extract, in-set d2 incorrect
    call({
      slug: "b",
      family: "leepa",
      as_of_date: "2026-01-01",
      source_tag: "odd_extract",
      observed: "bullish",
      correct: false,
    }),
    call({
      slug: "b",
      family: "leepa",
      as_of_date: "2026-02-01",
      source_tag: "odd_extract",
      observed: "bullish",
      correct: false,
    }),
  ]);
  assert.equal(score.n_calls, 3); // a:d2, a:d3, b:d2
  assert.equal(score.lake_tier1_accuracy, 1.0); // 2/2 lake_tier1 in-set correct
  assert.notEqual(score.system_accuracy, score.lake_tier1_accuracy); // blended 2/3 ≠ 1.0
  assert.ok(Math.abs(score.system_accuracy - 2 / 3) < 1e-9);
});

test("n_calls_by_tag partitions the scored denominator (sums to n_calls)", () => {
  const score = computeSkillScore([
    call({ slug: "a", as_of_date: "2026-01-01", source_tag: "lake_tier1" }),
    call({ slug: "a", as_of_date: "2026-02-01", source_tag: "lake_tier1" }),
    call({ slug: "b", as_of_date: "2026-01-01", source_tag: "odd_extract" }),
    call({ slug: "b", as_of_date: "2026-02-01", source_tag: "odd_extract" }),
  ]);
  const summed = Object.values(score.n_calls_by_tag).reduce((a, b) => a + b, 0);
  assert.equal(summed, score.n_calls);
  assert.equal(score.n_calls_by_tag.lake_tier1, 1);
  assert.equal(score.n_calls_by_tag.odd_extract, 1);
});
