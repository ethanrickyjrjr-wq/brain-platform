import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  computeDirection,
  pickEarliestObservation,
  runGrader,
  type CandidateObservation,
  type DuePrediction,
  type GradePayload,
  type GraderStore,
  type Observation,
} from "./grade-predictions.mts";
import type { ResolvedGradeConfig } from "../vocab/loader.mts";

// ── config helpers ─────────────────────────────────────────────────────────────
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

// ── computeDirection: delta basis, absolute epsilon ─────────────────────────────
test("delta/higher_is_bullish/absolute: move above deadband is bullish", () => {
  assert.equal(computeDirection(4.2, 4.0, cfg({})), "bullish");
});

test("delta/higher_is_bullish/absolute: move below deadband is bearish", () => {
  assert.equal(computeDirection(3.8, 4.0, cfg({})), "bearish");
});

test("delta/absolute: move inside deadband is neutral", () => {
  assert.equal(computeDirection(4.03, 4.0, cfg({})), "neutral");
});

test("delta/absolute: move exactly on the deadband edge is neutral (<=)", () => {
  assert.equal(computeDirection(4.05, 4.0, cfg({})), "neutral");
});

// ── computeDirection: polarity flip ─────────────────────────────────────────────
test("delta/lower_is_bullish: a rise flips to bearish", () => {
  const c = cfg({ direction_polarity: "lower_is_bullish" });
  assert.equal(computeDirection(4.2, 4.0, c), "bearish");
});

test("delta/lower_is_bullish: a fall flips to bullish", () => {
  const c = cfg({ direction_polarity: "lower_is_bullish" });
  assert.equal(computeDirection(3.8, 4.0, c), "bullish");
});

test("lower_is_bullish: an inside-deadband move stays neutral (no flip)", () => {
  const c = cfg({ direction_polarity: "lower_is_bullish" });
  assert.equal(computeDirection(4.03, 4.0, c), "neutral");
});

// ── computeDirection: relative epsilon ──────────────────────────────────────────
test("delta/relative: deadband scales with |baseline|", () => {
  // baseline 100, epsilon 0.05 -> deadband 5. diff 6 clears it.
  const c = cfg({ epsilon_mode: "relative", epsilon: 0.05 });
  assert.equal(computeDirection(106, 100, c), "bullish");
});

test("delta/relative: a move within the scaled deadband is neutral", () => {
  const c = cfg({ epsilon_mode: "relative", epsilon: 0.05 });
  assert.equal(computeDirection(104, 100, c), "neutral");
});

// ── computeDirection: sign basis ────────────────────────────────────────────────
test("sign basis grades the value's own sign, ignoring baseline", () => {
  const c = cfg({ grade_basis: "sign", epsilon: 0.5 });
  assert.equal(computeDirection(1.2, 999, c), "bullish");
  assert.equal(computeDirection(-1.2, -999, c), "bearish");
});

test("sign basis: value inside |epsilon| is neutral", () => {
  const c = cfg({ grade_basis: "sign", epsilon: 0.5 });
  assert.equal(computeDirection(0.3, 0, c), "neutral");
});

test("sign basis honors polarity flip", () => {
  const c = cfg({
    grade_basis: "sign",
    epsilon: 0.5,
    direction_polarity: "lower_is_bullish",
  });
  // a negative change is bearish-raw, flips to bullish for lower_is_bullish
  assert.equal(computeDirection(-1.2, 0, c), "bullish");
});

// ── pickEarliestObservation ─────────────────────────────────────────────────────
function cand(
  brain_id: string,
  observed_at: string,
  value: number,
): CandidateObservation {
  return { brain_id, observed_at, value, source_url: `src://${brain_id}` };
}

test("pickEarliestObservation returns null for no candidates", () => {
  assert.equal(pickEarliestObservation([]), null);
});

test("pickEarliestObservation picks the earliest vintage", () => {
  const got = pickEarliestObservation([
    cand("env-swfl", "2026-09-01T00:00:00+00:00", 7),
    cand("env-swfl", "2026-08-01T00:00:00+00:00", 5),
  ]);
  assert.equal(got?.value, 5);
});

test("pickEarliestObservation prefers the leaf over master at the same vintage", () => {
  const got = pickEarliestObservation([
    cand("master", "2026-08-01T00:00:00+00:00", 9),
    cand("env-swfl", "2026-08-01T00:00:00+00:00", 5),
  ]);
  assert.equal(got?.value, 5);
  assert.equal(got?.source_url, "src://env-swfl");
});

test("pickEarliestObservation: earliest vintage beats leaf-preference", () => {
  // master is strictly earlier than the leaf -> master wins (tiebreak is vintage-equal only)
  const got = pickEarliestObservation([
    cand("master", "2026-07-01T00:00:00+00:00", 9),
    cand("env-swfl", "2026-08-01T00:00:00+00:00", 5),
  ]);
  assert.equal(got?.value, 9);
});

// ── in-memory fake store ────────────────────────────────────────────────────────
interface SeedPrediction extends DuePrediction {
  grade_status: string;
}
interface FakeOutcome {
  prediction_id: string;
  grade_method: string;
  payload: GradePayload;
}

function makeFakeStore(opts: {
  predictions: SeedPrediction[];
  observations?: Record<string, Observation | null>;
}) {
  const predictions = opts.predictions.map((p) => ({ ...p }));
  const observations = opts.observations ?? {};
  const outcomes: FakeOutcome[] = [];

  const store: GraderStore = {
    async selectDue() {
      // Mirrors the real query: status in (gradeable, pending_data), window closed,
      // and no machine outcome yet. The pending_data inclusion is the requeue fix.
      return predictions
        .filter(
          (p) =>
            (p.grade_status === "gradeable" ||
              p.grade_status === "pending_data") &&
            !outcomes.some(
              (o) => o.prediction_id === p.id && o.grade_method === "machine",
            ),
        )
        .map(({ grade_status: _s, ...due }) => due);
    },
    async findObservation(slug) {
      return observations[slug] ?? null;
    },
    async gradePrediction(payload) {
      // Emulate the partial unique index: one machine outcome per prediction.
      const exists = outcomes.some(
        (o) =>
          o.prediction_id === payload.prediction_id &&
          o.grade_method === "machine",
      );
      if (!exists) {
        outcomes.push({
          prediction_id: payload.prediction_id,
          grade_method: "machine",
          payload,
        });
      }
      const p = predictions.find((x) => x.id === payload.prediction_id);
      if (p) p.grade_status = "graded";
    },
    async markPendingData(id) {
      const p = predictions.find((x) => x.id === id);
      if (p) p.grade_status = "pending_data";
    },
    async markUngradeable(id) {
      const p = predictions.find((x) => x.id === id);
      if (p) p.grade_status = "ungradeable";
    },
  };

  return { store, predictions, outcomes };
}

function duePrediction(over: Partial<SeedPrediction> = {}): SeedPrediction {
  return {
    id: "p1",
    gradeable_slug: "test_slug",
    baseline_value: 4.0,
    predicted_direction: "bullish",
    window_end_date: "2026-01-01",
    grade_status: "gradeable",
    ...over,
  };
}

const gradeableResolver = () => cfg({});

// ── runGrader ───────────────────────────────────────────────────────────────────
test("runGrader banks one outcome for a due prediction with an observation", async () => {
  const { store, predictions, outcomes } = makeFakeStore({
    predictions: [duePrediction()],
    observations: {
      test_slug: {
        value: 4.5,
        observed_at: "2026-01-02T00:00:00+00:00",
        source_url: "src://leaf",
      },
    },
  });
  const tally = await runGrader(store, { resolveConfig: gradeableResolver });
  assert.equal(tally.graded, 1);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].payload.observed_direction, "bullish");
  assert.equal(outcomes[0].payload.direction_correct, true);
  assert.equal(predictions[0].grade_status, "graded");
});

test("runGrader is idempotent — a second run banks no new outcome", async () => {
  const { store, outcomes } = makeFakeStore({
    predictions: [duePrediction()],
    observations: {
      test_slug: {
        value: 4.5,
        observed_at: "2026-01-02T00:00:00+00:00",
        source_url: null,
      },
    },
  });
  await runGrader(store, { resolveConfig: gradeableResolver });
  await runGrader(store, { resolveConfig: gradeableResolver });
  assert.equal(outcomes.length, 1);
});

test("runGrader marks pending_data and banks nothing when the observation is missing", async () => {
  const { store, predictions, outcomes } = makeFakeStore({
    predictions: [duePrediction()],
    observations: {},
  });
  const tally = await runGrader(store, { resolveConfig: gradeableResolver });
  assert.equal(tally.pending, 1);
  assert.equal(tally.graded, 0);
  assert.equal(outcomes.length, 0);
  assert.equal(predictions[0].grade_status, "pending_data");
});

test("runGrader REQUEUES a pending_data row once its observation lands", async () => {
  // This guards the selectDue fix: a row already at pending_data must be re-selected.
  const { store, predictions, outcomes } = makeFakeStore({
    predictions: [duePrediction({ grade_status: "pending_data" })],
    observations: {
      test_slug: {
        value: 4.5,
        observed_at: "2026-01-02T00:00:00+00:00",
        source_url: null,
      },
    },
  });
  const tally = await runGrader(store, { resolveConfig: gradeableResolver });
  assert.equal(tally.graded, 1);
  assert.equal(outcomes.length, 1);
  assert.equal(predictions[0].grade_status, "graded");
});

test("runGrader skips (ungradeable) a slug that lost its config since capture", async () => {
  const { store, predictions, outcomes } = makeFakeStore({
    predictions: [duePrediction()],
    observations: {
      test_slug: {
        value: 4.5,
        observed_at: "2026-01-02T00:00:00+00:00",
        source_url: null,
      },
    },
  });
  const ungradeableResolver = (slug: string): ResolvedGradeConfig => ({
    slug,
    concept_id: null,
    gradeable: false,
    window_days: null,
    epsilon: null,
    epsilon_mode: null,
    grade_basis: null,
    direction_polarity: "none",
    source: { window: null, epsilon: null, polarity: null },
    reason: "test: unconfigured",
  });
  const tally = await runGrader(store, { resolveConfig: ungradeableResolver });
  assert.equal(tally.skipped, 1);
  assert.equal(outcomes.length, 0);
  assert.equal(predictions[0].grade_status, "ungradeable");
});

test("runGrader on an empty queue exits clean with a zero tally", async () => {
  const { store } = makeFakeStore({ predictions: [] });
  const tally = await runGrader(store, { resolveConfig: gradeableResolver });
  assert.deepEqual(tally, { graded: 0, pending: 0, skipped: 0, errors: 0 });
});

test("runGrader --dry-run computes the verdict but writes nothing", async () => {
  const { store, predictions, outcomes } = makeFakeStore({
    predictions: [duePrediction()],
    observations: {
      test_slug: {
        value: 4.5,
        observed_at: "2026-01-02T00:00:00+00:00",
        source_url: null,
      },
    },
  });
  const tally = await runGrader(store, {
    dryRun: true,
    resolveConfig: gradeableResolver,
  });
  assert.equal(tally.graded, 1);
  assert.equal(outcomes.length, 0);
  assert.equal(predictions[0].grade_status, "gradeable"); // untouched
});

test("runGrader tallies a store error and leaves the row queued", async () => {
  const { store, predictions, outcomes } = makeFakeStore({
    predictions: [duePrediction()],
    observations: {
      test_slug: {
        value: 4.5,
        observed_at: "2026-01-02T00:00:00+00:00",
        source_url: null,
      },
    },
  });
  store.gradePrediction = async () => {
    throw new Error("simulated RPC failure");
  };
  const tally = await runGrader(store, { resolveConfig: gradeableResolver });
  assert.equal(tally.errors, 1);
  assert.equal(tally.graded, 0);
  assert.equal(outcomes.length, 0);
  assert.equal(predictions[0].grade_status, "gradeable"); // still queued for retry
});

// ── error magnitude semantics (delta vs sign basis) ─────────────────────────────
test("delta basis records error as observed minus baseline", async () => {
  const { store, outcomes } = makeFakeStore({
    predictions: [duePrediction({ baseline_value: 4.0 })],
    observations: {
      test_slug: {
        value: 4.5,
        observed_at: "2026-01-02T00:00:00+00:00",
        source_url: null,
      },
    },
  });
  await runGrader(store, { resolveConfig: gradeableResolver });
  assert.equal(outcomes[0].payload.error, 0.5);
});

test("sign basis records error as the observed value itself, not the delta", async () => {
  const { store, outcomes } = makeFakeStore({
    // The metric is already a change/z-score: baseline 2.0, realized change -1.2.
    predictions: [
      duePrediction({ baseline_value: 2.0, predicted_direction: "bearish" }),
    ],
    observations: {
      test_slug: {
        value: -1.2,
        observed_at: "2026-01-02T00:00:00+00:00",
        source_url: null,
      },
    },
  });
  const signResolver = () =>
    cfg({
      grade_basis: "sign",
      epsilon: 0.5,
      direction_polarity: "higher_is_bullish",
    });
  await runGrader(store, { resolveConfig: signResolver });
  // error is the realized magnitude (-1.2), NOT observed - baseline (-3.2).
  assert.equal(outcomes[0].payload.error, -1.2);
  assert.equal(outcomes[0].payload.observed_direction, "bearish");
});
