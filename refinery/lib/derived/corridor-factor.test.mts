import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  computeCorridorFactor,
  percentileRank,
  bandFor,
  DEFAULT_CORRIDOR_FACTOR_CONFIG,
  type CorridorFactorInput,
  type CorridorFactorConfig,
} from "./corridor-factor.mts";

/** Helper: build a full-data corridor input. */
function row(
  name: string,
  cap: number | null,
  vac: number | null,
  abs: number | null,
  rent: number | null,
): CorridorFactorInput {
  return {
    name,
    cap_rate_pct: cap,
    vacancy_rate_pct: vac,
    absorption_sqft: abs,
    asking_rent_psf: rent,
  };
}

function byName(
  results: ReturnType<typeof computeCorridorFactor>,
  name: string,
) {
  const r = results.find((x) => x.name === name);
  assert.ok(r, `expected a result for ${name}`);
  return r;
}

// ── percentileRank ───────────────────────────────────────────────────────────

test("percentileRank: single-element cohort → 50 (nothing to rank against)", () => {
  assert.equal(percentileRank(5, [5]), 50);
});

test("percentileRank: empty cohort → 50 (degenerate guard)", () => {
  assert.equal(percentileRank(5, []), 50);
});

test("percentileRank: max value in cohort → high percentile", () => {
  // [1,2,3,4], value 4: 3 below + 0.5*1 tie = 3.5/4 = 87.5
  assert.equal(percentileRank(4, [1, 2, 3, 4]), 87.5);
});

test("percentileRank: min value in cohort → low percentile", () => {
  // value 1: 0 below + 0.5*1 tie = 0.5/4 = 12.5
  assert.equal(percentileRank(1, [1, 2, 3, 4]), 12.5);
});

test("percentileRank: identical values share mid-rank 50", () => {
  assert.equal(percentileRank(7, [7, 7, 7, 7]), 50);
});

// ── bandFor ──────────────────────────────────────────────────────────────────

test("bandFor: null score → unknown", () => {
  assert.equal(bandFor(null, { strong: 67, neutral: 34 }), "unknown");
});

test("bandFor: thresholds (strong/neutral/soft boundaries)", () => {
  const b = { strong: 67, neutral: 34 };
  assert.equal(bandFor(67, b), "strong");
  assert.equal(bandFor(66, b), "neutral");
  assert.equal(bandFor(34, b), "neutral");
  assert.equal(bandFor(33, b), "soft");
  assert.equal(bandFor(0, b), "soft");
  assert.equal(bandFor(100, b), "strong");
});

// ── polarity orientation ─────────────────────────────────────────────────────

test("polarity: vacancy is lower_is_better — the LOWEST-vacancy corridor scores highest on that component", () => {
  // Hold every other metric identical so vacancy is the only differentiator.
  const inputs = [
    row("low-vac", 6, 2, 1000, 20),
    row("mid-vac", 6, 8, 1000, 20),
    row("high-vac", 6, 20, 1000, 20),
  ];
  const out = computeCorridorFactor(inputs);
  const vacComp = (name: string) =>
    byName(out, name).components.find((c) => c.metric === "vacancy_rate_pct")!;

  // Lower vacancy → higher oriented percentile (orientation inverts the raw).
  assert.ok(
    vacComp("low-vac").orientedPercentile! >
      vacComp("high-vac").orientedPercentile!,
    "low vacancy should out-score high vacancy on the vacancy component",
  );
  // And the overall score follows, since vacancy is the only mover.
  assert.ok(byName(out, "low-vac").score! > byName(out, "high-vac").score!);
});

test("polarity: absorption is higher_is_better — the HIGHEST-absorption corridor scores highest", () => {
  const inputs = [
    row("low-abs", 6, 8, 100, 20),
    row("high-abs", 6, 8, 50_000, 20),
  ];
  const out = computeCorridorFactor(inputs);
  const absComp = (name: string) =>
    byName(out, name).components.find((c) => c.metric === "absorption_sqft")!;
  assert.ok(
    absComp("high-abs").orientedPercentile! >
      absComp("low-abs").orientedPercentile!,
  );
});

test("polarity: cap_rate default lens (lower_is_better) — flipping config to higher_is_better inverts the ranking", () => {
  // Two corridors differing ONLY in cap rate.
  const inputs = [
    row("low-cap", 4, 8, 1000, 20),
    row("high-cap", 9, 8, 1000, 20),
  ];

  // Default (corridor-health / owner lens): lower cap = stronger.
  const defaultOut = computeCorridorFactor(inputs);
  assert.ok(
    byName(defaultOut, "low-cap").score! >
      byName(defaultOut, "high-cap").score!,
    "default lens: compressing (lower) cap rate scores higher",
  );

  // Buyer/yield lens: flip cap_rate to higher_is_better → ranking inverts.
  const buyerConfig: CorridorFactorConfig = {
    ...DEFAULT_CORRIDOR_FACTOR_CONFIG,
    metrics: {
      ...DEFAULT_CORRIDOR_FACTOR_CONFIG.metrics,
      cap_rate_pct: { polarity: "higher_is_better", weight: 0.25 },
    },
  };
  const buyerOut = computeCorridorFactor(inputs, buyerConfig);
  assert.ok(
    byName(buyerOut, "high-cap").score! > byName(buyerOut, "low-cap").score!,
    "buyer lens: higher cap rate (more yield) scores higher",
  );
});

test("polarity is never inherited: rent and cap orient independently per config", () => {
  // One corridor with high rent + high cap, one with low rent + low cap.
  // Default: rent higher_is_better, cap lower_is_better — they pull opposite
  // directions, proving each metric reads its own config rather than a shared
  // sign.
  const inputs = [
    row("a", 9, 8, 1000, 30), // high cap (bad on health lens), high rent (good)
    row("b", 4, 8, 1000, 15), // low cap (good), low rent (bad)
  ];
  const out = computeCorridorFactor(inputs);
  const comp = (name: string, metric: string) =>
    byName(out, name).components.find((c) => c.metric === metric)!;

  // a: high cap → LOW cap component (lower_is_better); high rent → HIGH rent component
  assert.ok(comp("a", "cap_rate_pct").orientedPercentile! < 50);
  assert.ok(comp("a", "asking_rent_psf").orientedPercentile! > 50);
  // b: the mirror image
  assert.ok(comp("b", "cap_rate_pct").orientedPercentile! > 50);
  assert.ok(comp("b", "asking_rent_psf").orientedPercentile! < 50);
});

// ── missing data ─────────────────────────────────────────────────────────────

test("missing data: a corridor missing absorption still scores (no NaN), on its 3 present metrics", () => {
  const inputs = [
    row("full", 6, 8, 1000, 20),
    row("no-abs", 6, 8, null, 20), // absorption missing
    row("other", 7, 10, 2000, 22),
  ];
  const out = computeCorridorFactor(inputs);
  const r = byName(out, "no-abs");

  assert.ok(r.score != null, "score must not be null");
  assert.ok(Number.isFinite(r.score!), "score must not be NaN");
  assert.ok(r.score! >= 0 && r.score! <= 100);

  const absComp = r.components.find((c) => c.metric === "absorption_sqft")!;
  assert.equal(absComp.present, false);
  assert.equal(absComp.orientedPercentile, null);
  assert.equal(absComp.weight, 0, "absent metric carries zero weight");
});

test("missing data: present-metric weights renormalize to sum ~1 when one is absent", () => {
  const inputs = [row("full", 6, 8, 1000, 20), row("no-abs", 6, 8, null, 20)];
  const out = computeCorridorFactor(inputs);
  const r = byName(out, "no-abs");
  const presentWeightSum = r.components
    .filter((c) => c.present)
    .reduce((acc, c) => acc + c.weight, 0);
  assert.ok(
    Math.abs(presentWeightSum - 1) < 1e-9,
    `present weights should renormalize to 1, got ${presentWeightSum}`,
  );
  // 3 present metrics, equal default weights → each ~1/3.
  for (const c of r.components.filter((c) => c.present)) {
    assert.ok(Math.abs(c.weight - 1 / 3) < 1e-9);
  }
});

test("missing data: a corridor missing absorption is NOT penalised — equal-on-present corridors tie", () => {
  // 'no-abs' and 'twin' are identical on the 3 metrics they both have; 'twin'
  // additionally has absorption. The absent metric must not drag 'no-abs' down.
  const inputs = [
    row("no-abs", 6, 8, null, 20),
    row("twin", 6, 8, 1000, 20),
    row("spread", 9, 2, 5000, 30),
  ];
  const out = computeCorridorFactor(inputs);
  // no-abs scored on {cap,vac,rent}; twin scored on {cap,vac,rent,abs}. On the
  // shared three, no-abs and twin have identical oriented percentiles, so the
  // gap is only the absorption term twin carries — no-abs is not pushed toward 0.
  const noAbs = byName(out, "no-abs");
  const twin = byName(out, "twin");
  for (const m of ["cap_rate_pct", "vacancy_rate_pct", "asking_rent_psf"]) {
    const a = noAbs.components.find((c) => c.metric === m)!;
    const b = twin.components.find((c) => c.metric === m)!;
    assert.equal(a.orientedPercentile, b.orientedPercentile);
  }
});

test("missing data: a corridor with ZERO inputs → score null, band unknown", () => {
  const inputs = [
    row("full", 6, 8, 1000, 20),
    row("empty", null, null, null, null),
  ];
  const out = computeCorridorFactor(inputs);
  const r = byName(out, "empty");
  assert.equal(r.score, null);
  assert.equal(r.band, "unknown");
  for (const c of r.components) {
    assert.equal(c.present, false);
    assert.equal(c.weight, 0);
  }
});

test("missing data: non-finite (NaN/Infinity) treated as absent, not propagated", () => {
  const inputs = [
    row("full", 6, 8, 1000, 20),
    row("nanny", NaN, 8, Infinity, 20),
  ];
  const out = computeCorridorFactor(inputs);
  const r = byName(out, "nanny");
  assert.ok(r.score != null && Number.isFinite(r.score));
  assert.equal(
    r.components.find((c) => c.metric === "cap_rate_pct")!.present,
    false,
  );
  assert.equal(
    r.components.find((c) => c.metric === "absorption_sqft")!.present,
    false,
  );
});

// ── shape / determinism ──────────────────────────────────────────────────────

test("output shape: integer score in 0–100 and a valid band for every corridor", () => {
  const inputs = [
    row("a", 4, 2, 5000, 30),
    row("b", 6, 8, 1000, 22),
    row("c", 9, 20, 100, 15),
  ];
  const out = computeCorridorFactor(inputs);
  assert.equal(out.length, 3);
  for (const r of out) {
    assert.ok(Number.isInteger(r.score), "score is an integer");
    assert.ok(r.score! >= 0 && r.score! <= 100);
    assert.ok(["strong", "neutral", "soft", "unknown"].includes(r.band));
    assert.equal(r.components.length, 4, "one component per metric");
  }
});

test("determinism: identical inputs → identical output, input order preserved", () => {
  const inputs = [
    row("a", 4, 2, 5000, 30),
    row("b", 6, 8, 1000, 22),
    row("c", 9, 20, 100, 15),
  ];
  const out1 = computeCorridorFactor(inputs);
  const out2 = computeCorridorFactor(inputs);
  assert.deepEqual(out1, out2);
  assert.deepEqual(
    out1.map((r) => r.name),
    ["a", "b", "c"],
  );
});

test("sanity: the all-around-best corridor lands 'strong', the all-around-worst lands 'soft' (default health lens)", () => {
  // best: low cap, low vacancy, high absorption, high rent.
  // worst: high cap, high vacancy, low absorption, low rent.
  const inputs = [
    row("best", 4, 2, 9000, 35),
    row("mid", 6, 8, 3000, 24),
    row("worst", 10, 22, 100, 12),
  ];
  const out = computeCorridorFactor(inputs);
  assert.equal(byName(out, "best").band, "strong");
  assert.equal(byName(out, "worst").band, "soft");
});
