import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  applyOverrideCascade,
  applyRelevanceFloor,
  composeConclusion,
  computeRelevanceFactor,
  detectContradictions,
  emptySynthesisResult,
  propagateDecay,
  rollupKeyMetrics,
  voteDirection,
} from "./synth.mts";
import type {
  BrainOutput,
  BrainOutputDirection,
  BrainOutputMetric,
  BrainTrustTier,
} from "../types/brain-output.mts";
import type { ExogenousSignal } from "../types/exogenous-signal.mts";
import type { OverrideRule } from "../constitution/types.mts";

const NOW = new Date("2026-05-15T20:00:00Z");

/**
 * Test-only metric factory — fills in Lane 1B's required fields (variable_type,
 * units, source) with sensible defaults so call sites stay tight. Override any
 * of the inputs at the call site.
 */
function metric(
  m: {
    metric: string;
    value: number | string;
    direction: "rising" | "falling" | "stable";
    label: string;
  },
  opts: Partial<BrainOutputMetric> = {},
): BrainOutputMetric {
  const variable_type =
    typeof m.value === "string"
      ? "categorical"
      : (opts.variable_type ?? "extensive");
  return {
    ...m,
    variable_type,
    ...(variable_type === "categorical"
      ? {}
      : { units: opts.units ?? "count" }),
    source: opts.source ?? {
      url: `test://${m.metric}`,
      fetched_at: NOW.toISOString(),
      tier: 1,
      citation: `test metric ${m.metric}`,
    },
    ...(opts.display_format !== undefined
      ? { display_format: opts.display_format }
      : {}),
  };
}

function brain(
  brain_id: string,
  direction: BrainOutputDirection,
  magnitude: number,
  confidence: number,
  opts: {
    half_life_hours?: number;
    computed_at?: string;
    trust_tier?: BrainTrustTier;
    key_metrics?: BrainOutputMetric[];
    caveats?: string[];
  } = {},
): BrainOutput {
  return {
    brain_id,
    version: 1,
    refined_at: opts.computed_at ?? NOW.toISOString(),
    direction,
    magnitude,
    drivers: [],
    overrides: [],
    conclusion: `${brain_id} reads ${direction}`,
    key_metrics: opts.key_metrics ?? [],
    caveats: opts.caveats ?? [],
    contradicts: [],
    confidence,
    joint_integrity: 1,
    confidence_dispersion: 0,
    chain_depth: 0,
    trust_tier: opts.trust_tier ?? 2,
    upstream_count: 0,
    relevance: {
      decay_curve: "weeks",
      half_life_hours: opts.half_life_hours ?? 720,
      computed_at: opts.computed_at ?? NOW.toISOString(),
    },
    exogenous_signals: [],
  };
}

// ---- computeRelevanceFactor ------------------------------------------------

test("computeRelevanceFactor: brand-new returns 1.0", () => {
  const b = brain("x", "bullish", 0.5, 0.8, { computed_at: NOW.toISOString() });
  assert.equal(computeRelevanceFactor(b, NOW), 1);
});

test("computeRelevanceFactor: one half-life old returns 0.5", () => {
  const computed_at = new Date(NOW.getTime() - 24 * 3600 * 1000).toISOString();
  const b = brain("x", "bullish", 0.5, 0.8, {
    half_life_hours: 24,
    computed_at,
  });
  assert.ok(Math.abs(computeRelevanceFactor(b, NOW) - 0.5) < 1e-9);
});

test("computeRelevanceFactor: very stale → near 0 (spec test 11)", () => {
  // 30 days old, half-life 168h → factor ≈ 2^-4.28 ≈ 0.05
  const computed_at = new Date(
    NOW.getTime() - 30 * 24 * 3600 * 1000,
  ).toISOString();
  const b = brain("x", "bullish", 0.5, 0.8, {
    half_life_hours: 168,
    computed_at,
  });
  const f = computeRelevanceFactor(b, NOW);
  assert.ok(f > 0 && f < 0.06, `expected tiny positive, got ${f}`);
});

// ---- applyRelevanceFloor ---------------------------------------------------

test("applyRelevanceFloor: separates passing/excluded and emits caveats", () => {
  const fresh = brain("fresh", "bullish", 0.7, 0.8, {
    computed_at: NOW.toISOString(),
  });
  const stale = brain("stale", "bearish", 0.5, 0.7, {
    half_life_hours: 168,
    computed_at: new Date(NOW.getTime() - 30 * 24 * 3600 * 1000).toISOString(),
  });
  const { passing, excluded, caveats } = applyRelevanceFloor(
    [fresh, stale],
    0.1,
    NOW,
  );
  assert.equal(passing.length, 1);
  assert.equal(passing[0].upstream.brain_id, "fresh");
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].upstream.brain_id, "stale");
  assert.equal(caveats.length, 1);
  assert.match(caveats[0], /stale.*below floor 0\.1/);
});

test("applyRelevanceFloor: excluded brain's upstream caveats do not appear — floor caveat does", () => {
  // Codifies the intentional policy in master.mts lines 175-176:
  // "Excluded upstreams' caveats are intentionally dropped — they're below
  //  the relevance floor and the floor caveats already speak for them."
  //
  // Fixture: env-swfl is 30 days old with half_life_hours=168 →
  //   factor ≈ 2^(-30*24/168) ≈ 0.05, which is below the 0.1 floor.
  //   This is what makes it excluded — not merely that it carries caveats.
  const PER_ZIP_CAVEAT =
    "Flood barrier risk at ZIP 33931: barrier=1.0, AAL=$1200/yr";
  const envSwfl = brain("env-swfl", "bearish", 0.7, 0.8, {
    half_life_hours: 168,
    computed_at: new Date(NOW.getTime() - 30 * 24 * 3600 * 1000).toISOString(),
    caveats: [PER_ZIP_CAVEAT],
  });
  const {
    passing,
    excluded,
    caveats: floorCaveats,
  } = applyRelevanceFloor([envSwfl], 0.1, NOW);
  // Confirm env-swfl is actually excluded by staleness, not just fixture-set.
  assert.equal(excluded.length, 1);
  assert.equal(passing.length, 0);
  // (a) Floor exclusion caveat fires.
  assert.equal(floorCaveats.length, 1);
  assert.match(floorCaveats[0], /env-swfl.*below floor/);
  // (b) Per-ZIP caveats do NOT flow through. The master producer collects
  //     upstream caveats via `passing.flatMap(p => p.upstream.caveats)`;
  //     with passing empty, that yields [] and the per-ZIP detail is gone.
  const upstreamCaveats = passing.flatMap((p) => p.upstream.caveats);
  assert.equal(upstreamCaveats.length, 0);
  assert.ok(!floorCaveats.some((c) => c.includes("33931")));
});

// ---- voteDirection ---------------------------------------------------------

test("voteDirection: unanimous bullish → bullish, high magnitude (spec test 6)", () => {
  const ups = [
    brain("a", "bullish", 0.8, 0.9),
    brain("b", "bullish", 0.85, 0.9),
    brain("c", "bullish", 0.8, 0.85),
  ];
  const vote = voteDirection(ups.map((u) => ({ upstream: u, factor: 1 })));
  assert.equal(vote.direction, "bullish");
  assert.ok(vote.magnitude > 0.75);
  assert.deepEqual(vote.drivers.sort(), ["a", "b", "c"]);
});

test("voteDirection: balanced bullish/bearish → mixed (spec test 7)", () => {
  const ups = [
    brain("a", "bullish", 0.7, 0.7),
    brain("b", "bearish", 0.7, 0.7),
  ];
  const vote = voteDirection(ups.map((u) => ({ upstream: u, factor: 1 })));
  assert.equal(vote.direction, "mixed");
  assert.ok(vote.agreement_ratio < 0.6);
});

test("voteDirection: mixed upstream splits weight 50/50 (spec test 15)", () => {
  // Heavy mixed upstream dilutes the lighter bearish reading below 0.60.
  // bearish weight: 0.4 * 0.5 = 0.2; mixed split: 0.5 * (1.0 * 1.0) = 0.5 each
  // → bearish total 0.7, bullish 0.5, ratio 0.583 < 0.6 → mixed.
  const ups = [brain("a", "bearish", 0.4, 0.5), brain("b", "mixed", 1.0, 1.0)];
  const vote = voteDirection(ups.map((u) => ({ upstream: u, factor: 1 })));
  assert.equal(vote.direction, "mixed");
  // Confirm the split happened: bullish weight purely from mixed = 0.5
  assert.ok(Math.abs(vote.weights.bullish - 0.5) < 1e-9);
});

test("voteDirection: empty passing → neutral, magnitude 0", () => {
  const vote = voteDirection([]);
  assert.equal(vote.direction, "neutral");
  assert.equal(vote.magnitude, 0);
  assert.deepEqual(vote.drivers, []);
});

// ---- applyOverrideCascade --------------------------------------------------

const FLOOD_RULE: OverrideRule = {
  priority: 90,
  override_id: "flood-veto",
  effect: "force_bearish",
  condition: (upstreams) =>
    upstreams.some((u) =>
      u.key_metrics.some(
        (m) =>
          m.metric === "flood_risk_pct" &&
          typeof m.value === "number" &&
          m.value > 15,
      ),
    ),
};

const SIGNAL_RULE: OverrideRule = {
  priority: 100,
  override_id: "exogenous-critical-confirmed",
  effect: "force_signal_direction",
  condition: (_u, signals) =>
    signals.some(
      (s) =>
        s.severity === "critical" &&
        s.classification === "confirmed" &&
        s.confidence > 0.85,
    ),
};

test("applyOverrideCascade: flood veto forces bearish, mag floor 0.85 (spec test 9)", () => {
  const u = brain("a", "bullish", 0.5, 0.9, {
    key_metrics: [
      metric({
        metric: "flood_risk_pct",
        value: 25,
        direction: "rising",
        label: "Flood risk",
      }),
    ],
  });
  const passing = [{ upstream: u, factor: 1 }];
  const vote = voteDirection(passing);
  const result = applyOverrideCascade(vote, passing, [], [FLOOD_RULE]);
  assert.equal(result.direction, "bearish");
  assert.ok(result.magnitude >= 0.85);
  assert.deepEqual(result.overrides, ["flood-veto"]);
  assert.equal(result.caveats.length, 1);
  assert.match(result.caveats[0], /flood-veto/);
});

test("applyOverrideCascade: priority — bullish signal beats flood (spec test 10)", () => {
  const u = brain("a", "bullish", 0.5, 0.9, {
    key_metrics: [
      metric({
        metric: "flood_risk_pct",
        value: 25,
        direction: "rising",
        label: "Flood",
      }),
    ],
  });
  const passing = [{ upstream: u, factor: 1 }];
  const vote = voteDirection(passing);
  const signals: ExogenousSignal[] = [
    {
      signal_type: "weather",
      entity: "Storm X",
      direction: "bullish",
      severity: "critical",
      confidence: 0.95,
      classification: "confirmed",
      decay_curve: "hours",
      source: "NOAA",
      observed_at: NOW.toISOString(),
    },
  ];
  const result = applyOverrideCascade(vote, passing, signals, [
    SIGNAL_RULE,
    FLOOD_RULE,
  ]);
  assert.equal(result.direction, "bullish");
  assert.deepEqual(result.overrides, ["exogenous-critical-confirmed"]);
});

// ---- detectContradictions --------------------------------------------------

test("detectContradictions: high-conf opposite → contradiction (spec test 7)", () => {
  const a = brain("a", "bullish", 0.7, 0.7);
  const b = brain("b", "bearish", 0.7, 0.7);
  const out = detectContradictions(
    [a, b].map((u) => ({ upstream: u, factor: 1 })),
  );
  assert.deepEqual(out, ["a (bullish) vs b (bearish)"]);
});

test("detectContradictions: low-confidence pair → no contradiction", () => {
  const a = brain("a", "bullish", 0.7, 0.4);
  const b = brain("b", "bearish", 0.7, 0.7);
  const out = detectContradictions(
    [a, b].map((u) => ({ upstream: u, factor: 1 })),
  );
  assert.equal(out.length, 0);
});

test("detectContradictions: neutral and mixed pairs skipped", () => {
  const a = brain("a", "neutral", 0.7, 0.9);
  const b = brain("b", "bearish", 0.7, 0.9);
  const c = brain("c", "mixed", 0.7, 0.9);
  const d = brain("d", "bullish", 0.7, 0.9);
  const out = detectContradictions(
    [a, b, c, d].map((u) => ({ upstream: u, factor: 1 })),
  );
  assert.deepEqual(out, ["b (bearish) vs d (bullish)"]);
});

// ---- composeConclusion -----------------------------------------------------

test("composeConclusion: full template + plural", () => {
  const c = composeConclusion({
    direction: "bullish",
    magnitude: 0.8,
    drivers: ["a", "b"],
    overrides: [],
    contradicts: [],
    confidence: 0.72,
    trust_tier: 2,
    upstream_count: 2,
  });
  assert.match(c, /Read is bullish \(high magnitude\)/);
  assert.match(c, /Driven by: a, b/);
  assert.match(c, /0\.72/);
  assert.match(c, /T2/);
  assert.match(c, /2 upstream brains/);
});

test("composeConclusion: singular and low magnitude", () => {
  const c = composeConclusion({
    direction: "neutral",
    magnitude: 0.3,
    drivers: ["a"],
    overrides: [],
    contradicts: [],
    confidence: 0.6,
    trust_tier: 1,
    upstream_count: 1,
  });
  assert.match(c, /low magnitude/);
  assert.match(c, /1 upstream brain\./);
});

test("composeConclusion: overrides + contradicts surfaced", () => {
  const c = composeConclusion({
    direction: "bearish",
    magnitude: 0.85,
    drivers: ["a"],
    overrides: ["flood-veto"],
    contradicts: ["a (bullish) vs b (bearish)"],
    confidence: 0.5,
    trust_tier: 3,
    upstream_count: 2,
  });
  assert.match(c, /Overrides: flood-veto/);
  assert.match(c, /Note conflicts: a \(bullish\) vs b \(bearish\)/);
});

// ---- rollupKeyMetrics ------------------------------------------------------

test("rollupKeyMetrics: reserve-then-fill — every upstream gets a seat first", () => {
  const mk = (prefix: string, n: number): BrainOutputMetric[] =>
    Array.from({ length: n }, (_, i) =>
      metric({
        metric: `${prefix}_m${i}`,
        value: i,
        direction: "rising" as const,
        label: `${prefix} M${i}`,
      }),
    );
  const ups = [
    brain("a", "bullish", 0.5, 0.8, { key_metrics: mk("a", 3) }),
    brain("b", "bullish", 0.5, 0.8, { key_metrics: mk("b", 2) }),
  ];
  const passing = ups.map((u) => ({ upstream: u, factor: 1 }));
  const out = rollupKeyMetrics(passing);
  assert.equal(out.length, 4);
  // Reserve pass first (a_m0, b_m0), then fill pass (a_m1, b_m1) — ordering
  // is "all seats reserved, then all fills," not "all of a, then all of b."
  assert.deepEqual(
    out.map((m) => m.metric),
    ["a_m0", "b_m0", "a_m1", "b_m1"],
  );
});

test("rollupKeyMetrics: T1 upstream at the end of the DAG keeps its seat", () => {
  // Regression for Session 8 env-swfl bug: under the old DAG-order cap, a T1
  // brain placed 6th in input_brains lost its slot to T2 brains that ran
  // earlier. Reserve-then-fill must guarantee its inclusion.
  const mk = (slug: string): BrainOutputMetric[] => [
    metric({ metric: slug, value: 1, direction: "rising", label: slug }),
  ];
  const ups = [
    brain("franchise", "bullish", 0.5, 0.8, {
      trust_tier: 1,
      key_metrics: mk("survival"),
    }),
    brain("cre", "bullish", 0.5, 0.8, {
      trust_tier: 2,
      key_metrics: [
        metric({
          metric: "cap_rate",
          value: 6,
          direction: "falling",
          label: "cap",
        }),
        metric({
          metric: "vacancy",
          value: 5,
          direction: "falling",
          label: "vac",
        }),
      ],
    }),
    brain("macro", "bearish", 0.5, 0.8, {
      trust_tier: 1,
      key_metrics: [
        metric({
          metric: "sofr",
          value: 3.6,
          direction: "stable",
          label: "sofr",
        }),
        metric({
          metric: "fl_unemp",
          value: 4.7,
          direction: "rising",
          label: "unemp",
        }),
      ],
    }),
    brain("sector", "bearish", 0.5, 0.8, {
      trust_tier: 1,
      key_metrics: [
        metric({
          metric: "best_naics",
          value: 100,
          direction: "stable",
          label: "b",
        }),
        metric({
          metric: "worst_naics",
          value: 57,
          direction: "stable",
          label: "w",
        }),
      ],
    }),
    brain("tourism", "bullish", 0.5, 0.8, {
      trust_tier: 1,
      key_metrics: mk("tdt"),
    }),
    brain("env", "bearish", 0.5, 0.8, {
      trust_tier: 1,
      key_metrics: mk("lee_ve_zone"),
    }),
  ];
  const out = rollupKeyMetrics(ups.map((u) => ({ upstream: u, factor: 1 })));
  const slugs = out.map((m) => m.metric);
  assert.ok(
    slugs.includes("lee_ve_zone"),
    `expected env-swfl's metric to survive reserve-then-fill, got ${JSON.stringify(slugs)}`,
  );
  // Under the OLD DAG-order cap this would have been impossible: 1+2+2+2+1=8
  // would have filled the cap before env's index ticked.
});

test("rollupKeyMetrics: reserve overflow ranks by tier then weight then order", () => {
  // 10 upstreams, all contribute 1 metric. Reserve length (10) > cap (8).
  // T1 brains must keep their seats over T2 brains regardless of DAG order.
  const mk = (slug: string): BrainOutputMetric[] => [
    metric({ metric: slug, value: 1, direction: "rising", label: slug }),
  ];
  const ups = [
    brain("t2_a", "bullish", 0.5, 0.5, { trust_tier: 2, key_metrics: mk("a") }),
    brain("t2_b", "bullish", 0.5, 0.5, { trust_tier: 2, key_metrics: mk("b") }),
    brain("t2_c", "bullish", 0.5, 0.5, { trust_tier: 2, key_metrics: mk("c") }),
    brain("t1_d", "bullish", 0.5, 0.9, { trust_tier: 1, key_metrics: mk("d") }),
    brain("t1_e", "bullish", 0.5, 0.9, { trust_tier: 1, key_metrics: mk("e") }),
    brain("t1_f", "bullish", 0.5, 0.9, { trust_tier: 1, key_metrics: mk("f") }),
    brain("t1_g", "bullish", 0.5, 0.9, { trust_tier: 1, key_metrics: mk("g") }),
    brain("t1_h", "bullish", 0.5, 0.9, { trust_tier: 1, key_metrics: mk("h") }),
    brain("t1_i", "bullish", 0.5, 0.9, { trust_tier: 1, key_metrics: mk("i") }),
    brain("t1_j", "bullish", 0.5, 0.9, { trust_tier: 1, key_metrics: mk("j") }),
  ];
  const out = rollupKeyMetrics(ups.map((u) => ({ upstream: u, factor: 1 })));
  const slugs = out.map((m) => m.metric).sort();
  assert.equal(out.length, 8);
  // All 7 T1 brains must be present; only one T2 brain (the highest-confidence,
  // earliest-order one — but all T2s are tied, so DAG order wins → "a").
  assert.deepEqual(slugs, ["a", "d", "e", "f", "g", "h", "i", "j"]);
});

test("rollupKeyMetrics: caps at 8 across many upstreams", () => {
  const mk: BrainOutputMetric[] = [
    metric({ metric: "x", value: 1, direction: "rising", label: "X" }),
    metric({ metric: "y", value: 2, direction: "rising", label: "Y" }),
  ];
  const ups = Array.from({ length: 6 }, (_, i) =>
    brain(`u${i}`, "bullish", 0.5, 0.8, { key_metrics: mk }),
  );
  const out = rollupKeyMetrics(ups.map((u) => ({ upstream: u, factor: 1 })));
  assert.equal(out.length, 8);
});

// ---- propagateDecay --------------------------------------------------------

test("propagateDecay: equal weights → arithmetic mean half-life", () => {
  const ups = [
    brain("a", "bullish", 1.0, 1.0, { half_life_hours: 100 }),
    brain("b", "bearish", 1.0, 1.0, { half_life_hours: 200 }),
  ];
  const r = propagateDecay(
    ups.map((u) => ({ upstream: u, factor: 1 })),
    NOW,
  );
  assert.ok(Math.abs(r.half_life_hours - 150) < 1e-6);
  assert.equal(r.decay_curve, "days");
});

test("propagateDecay: weighted half-life (heavier upstream dominates)", () => {
  const heavy = brain("a", "bullish", 1.0, 1.0, { half_life_hours: 1000 });
  const light = brain("b", "bullish", 0.1, 0.1, { half_life_hours: 100 });
  const r = propagateDecay(
    [heavy, light].map((u) => ({ upstream: u, factor: 1 })),
    NOW,
  );
  // weights: 1.0 vs 0.01 → near-pure heavy → ~1000
  assert.ok(
    r.half_life_hours > 950,
    `expected near 1000, got ${r.half_life_hours}`,
  );
  assert.equal(r.decay_curve, "weeks");
});

test("propagateDecay: empty passing → 24h hours-decay", () => {
  const r = propagateDecay([], NOW);
  assert.equal(r.half_life_hours, 24);
  assert.equal(r.decay_curve, "hours");
});

// ---- emptySynthesisResult --------------------------------------------------

test("emptySynthesisResult: neutral, mag 0, count 0, tier 4 (spec test 12)", () => {
  const r = emptySynthesisResult(4, 0.1, NOW);
  assert.equal(r.direction, "neutral");
  assert.equal(r.magnitude, 0);
  assert.equal(r.upstream_count, 0);
  assert.equal(r.trust_tier, 4);
  assert.match(r.conclusion, /Insufficient current data/);
  assert.match(r.conclusion, /4 upstream brains below relevance floor 0\.1/);
  assert.deepEqual(r.caveats, [
    "All upstream brains below relevance threshold",
  ]);
  assert.deepEqual(r.exogenous_signals, []);
});

// ---- composeConditionalThesis (dossier authoring) --------------------------

import {
  composeConditionalThesis,
  composeGrainBoundary,
  predictedWindow,
} from "./synth.mts";

test("composeConditionalThesis: bullish dominant domain → table row + citable basis_refs", () => {
  const tdt = metric({
    metric: "tdt_collections",
    value: 12_000_000,
    direction: "rising",
    label: "TDT",
  });
  const passing = [
    {
      upstream: brain("tourism-tdt", "bullish", 0.8, 0.9, {
        key_metrics: [tdt],
      }),
      factor: 1,
    },
  ];
  const vote = voteDirection(passing);
  const finalKeyMetrics = rollupKeyMetrics(passing);
  const claims = composeConditionalThesis({
    passing,
    vote,
    trust_tier: 2,
    finalKeyMetrics,
  });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].then_direction, "bullish");
  assert.match(claims[0].condition, /tourist-tax collections/);
  assert.ok(claims[0].falsifier.length > 0);
  // brain_id resolves against vote.drivers; metric resolves against finalKeyMetrics.
  assert.ok(claims[0].basis_refs.includes("tourism-tdt"));
  assert.ok(claims[0].basis_refs.includes("tdt_collections"));
});

test("composeConditionalThesis: mixed vote → split claim naming both sides", () => {
  const passing = [
    { upstream: brain("cre-swfl", "bullish", 0.7, 0.7), factor: 1 },
    { upstream: brain("sector-credit-swfl", "bearish", 0.7, 0.7), factor: 1 },
  ];
  const vote = voteDirection(passing);
  assert.equal(vote.direction, "mixed");
  const claims = composeConditionalThesis({
    passing,
    vote,
    trust_tier: 2,
    finalKeyMetrics: rollupKeyMetrics(passing),
  });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].then_direction, "mixed");
  assert.match(claims[0].condition, /split/);
  assert.ok(claims[0].basis_refs.includes("cre-swfl"));
  assert.ok(claims[0].basis_refs.includes("sector-credit-swfl"));
});

test("composeConditionalThesis: neutral vote → holding-pattern claim", () => {
  const passing = [
    { upstream: brain("macro-us", "neutral", 0.5, 0.8), factor: 1 },
  ];
  const vote = voteDirection(passing);
  assert.equal(vote.direction, "neutral");
  const claims = composeConditionalThesis({
    passing,
    vote,
    trust_tier: 2,
    finalKeyMetrics: rollupKeyMetrics(passing),
  });
  assert.equal(claims[0].then_direction, "neutral");
  assert.match(claims[0].condition, /without a decisive move/);
});

test("composeConditionalThesis: empty passing → no claims", () => {
  const claims = composeConditionalThesis({
    passing: [],
    vote: voteDirection([]),
    trust_tier: 4,
    finalKeyMetrics: [],
  });
  assert.deepEqual(claims, []);
});

test("composeConditionalThesis: dominant metric squeezed by cap — basis_refs drops dead metric ref", () => {
  // 9 bearish upstreams; cap=8. The dominant (highest mag×conf×factor) is
  // u0. rollupKeyMetrics fills 8 seats: u0 gets a reserved seat (pass 1),
  // so its metric slug IS in the rollup. But u8 (the 9th, lowest weight) is
  // the one squeezed — this test verifies the mechanism by using a
  // finalKeyMetrics that intentionally excludes the dominant's metric.
  const mk = (slug: string): BrainOutputMetric[] => [
    metric({ metric: slug, value: 1, direction: "falling", label: slug }),
  ];
  const passing = [
    {
      upstream: brain("macro-swfl", "bearish", 0.9, 0.9, {
        key_metrics: mk("dominant_metric"),
      }),
      factor: 1,
    },
    {
      upstream: brain("cre-swfl", "bearish", 0.5, 0.8, {
        key_metrics: mk("other_metric"),
      }),
      factor: 1,
    },
  ];
  const vote = voteDirection(passing);
  assert.equal(vote.direction, "bearish");
  // Simulate cap squeeze: finalKeyMetrics does NOT include dominant_metric.
  const squeezedFinalMetrics = [
    metric({
      metric: "other_metric",
      value: 1,
      direction: "falling",
      label: "other",
    }),
  ];
  const claims = composeConditionalThesis({
    passing,
    vote,
    trust_tier: 2,
    finalKeyMetrics: squeezedFinalMetrics,
  });
  assert.equal(claims.length, 1);
  // brain_id IS in vote.drivers → kept.
  assert.ok(claims[0].basis_refs.includes("macro-swfl"));
  // dominant_metric is NOT in finalKeyMetrics → dropped (no dead ref).
  assert.ok(!claims[0].basis_refs.includes("dominant_metric"));
});

test("composeConditionalThesis: neutral vote — brain_id in basis_refs resolves against drivers, not non-neutral dominant", () => {
  // A high-weight bearish brain coexists with a low-weight neutral brain.
  // The vote is neutral (the neutral brain's weight clears 60% of total).
  // The neutral brain must appear in basis_refs; the bearish brain must NOT.
  const neutralBrain = brain("macro-us", "neutral", 0.9, 0.9);
  const bearishBrain = brain("cre-swfl", "bearish", 0.1, 0.9);
  const passing = [
    { upstream: neutralBrain, factor: 1 },
    { upstream: bearishBrain, factor: 1 },
  ];
  const vote = voteDirection(passing);
  assert.equal(vote.direction, "neutral", "vote must be neutral for this test");
  const claims = composeConditionalThesis({
    passing,
    vote,
    trust_tier: 2,
    finalKeyMetrics: rollupKeyMetrics(passing),
  });
  assert.equal(claims[0].then_direction, "neutral");
  // Neutral driver must be cited.
  assert.ok(
    claims[0].basis_refs.includes("macro-us"),
    "neutral brain_id must appear in basis_refs",
  );
  // Non-neutral brain must NOT be cited (it is not in vote.drivers).
  assert.ok(
    !claims[0].basis_refs.includes("cre-swfl"),
    "bearish brain_id must not appear in basis_refs for a neutral vote",
  );
});

// ---- composeGrainBoundary --------------------------------------------------

test("composeGrainBoundary: well-formed grain + non-empty boundary + excluded note", () => {
  const passing = [
    { upstream: brain("macro-us", "bullish", 0.5, 0.8), factor: 1 },
  ];
  const gb = composeGrainBoundary({
    passing,
    originalCount: 3,
    relevanceFloor: 0.1,
  });
  assert.equal(gb.finest_grain, "county-month");
  assert.ok(gb.not_available.length > 0);
  // originalCount(3) - passing(1) = 2 excluded → that line appears.
  assert.ok(
    gb.not_available.some((s) => /2 upstream read\(s\) fell below/.test(s)),
  );
  // finest_grain must satisfy the grain-guard <unit>-<period> format.
  assert.match(gb.finest_grain, /^[a-z]+-[a-z]+$/);
});

// ---- predictedWindow -------------------------------------------------------

test("predictedWindow: neutral vote → undefined", () => {
  const passing = [
    { upstream: brain("macro-us", "neutral", 0.5, 0.8), factor: 1 },
  ];
  assert.equal(
    predictedWindow({ passing, vote: voteDirection(passing) }),
    undefined,
  );
});

test("predictedWindow: nowcast present → freight-shock horizon", () => {
  const passing = [
    {
      upstream: brain("logistics-swfl-nowcast", "bullish", 0.8, 0.9),
      factor: 1,
    },
    { upstream: brain("tourism-tdt", "bullish", 0.8, 0.9), factor: 1 },
  ];
  const w = predictedWindow({ passing, vote: voteDirection(passing) });
  assert.match(String(w), /freight-shock/);
});

test("predictedWindow: directional, no nowcast → quarters horizon", () => {
  const passing = [
    { upstream: brain("cre-swfl", "bullish", 0.8, 0.9), factor: 1 },
  ];
  const w = predictedWindow({ passing, vote: voteDirection(passing) });
  assert.match(String(w), /quarters/);
});
