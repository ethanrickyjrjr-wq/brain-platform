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
  BrainOutputDetailTable,
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
    typeof m.value === "string" ? "categorical" : (opts.variable_type ?? "extensive");
  return {
    ...m,
    variable_type,
    ...(variable_type === "categorical" ? {} : { units: opts.units ?? "count" }),
    source: opts.source ?? {
      url: `test://${m.metric}`,
      fetched_at: NOW.toISOString(),
      tier: 1,
      citation: `test metric ${m.metric}`,
    },
    ...(opts.display_format !== undefined ? { display_format: opts.display_format } : {}),
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
    detail_tables?: BrainOutputDetailTable[];
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
    ...(opts.detail_tables ? { detail_tables: opts.detail_tables } : {}),
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
  const computed_at = new Date(NOW.getTime() - 30 * 24 * 3600 * 1000).toISOString();
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
  const { passing, excluded, caveats } = applyRelevanceFloor([fresh, stale], 0.1, NOW);
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
  const PER_ZIP_CAVEAT = "Flood barrier risk at ZIP 33931: barrier=1.0, AAL=$1200/yr";
  const envSwfl = brain("env-swfl", "bearish", 0.7, 0.8, {
    half_life_hours: 168,
    computed_at: new Date(NOW.getTime() - 30 * 24 * 3600 * 1000).toISOString(),
    caveats: [PER_ZIP_CAVEAT],
  });
  const { passing, excluded, caveats: floorCaveats } = applyRelevanceFloor([envSwfl], 0.1, NOW);
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
  const ups = [brain("a", "bullish", 0.7, 0.7), brain("b", "bearish", 0.7, 0.7)];
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

test("voteDirection: all neutral upstreams → neutral (directional=0), neutral brains in drivers", () => {
  const ups = [brain("macro-us", "neutral", 0.9, 0.9), brain("macro-fl", "neutral", 0.5, 0.8)];
  const vote = voteDirection(ups.map((u) => ({ upstream: u, factor: 1 })));
  assert.equal(vote.direction, "neutral");
  assert.equal(vote.magnitude, 0);
  // Neutral brains are the drivers so composeConditionalThesis can cite them.
  assert.deepEqual(vote.drivers, ["macro-us", "macro-fl"]);
});

test("voteDirection: neutral brains abstain — directional minority clears threshold", () => {
  // 15 neutral + 7 bearish. Old denominator: 22 brains, bearish=7/22≈32% → mixed.
  // New denominator: bearish is 100% of directional → bearish.
  const ups = [
    ...Array.from({ length: 15 }, (_, i) => brain(`neutral_${i}`, "neutral", 0.5, 0.7)),
    ...Array.from({ length: 7 }, (_, i) => brain(`bearish_${i}`, "bearish", 0.5, 0.7)),
  ];
  const vote = voteDirection(ups.map((u) => ({ upstream: u, factor: 1 })));
  assert.equal(vote.direction, "bearish");
  assert.ok(vote.agreement_ratio > 0.6, `expected ratio > 0.6, got ${vote.agreement_ratio}`);
  assert.ok(
    !vote.drivers.some((d) => d.startsWith("neutral_")),
    "neutral brains must not appear in drivers",
  );
});

test("voteDirection: small bearish alongside large neutral → bearish (neutral abstains)", () => {
  // The neutral brain's high weight should NOT suppress the directional signal.
  const neutralBrain = brain("macro-us", "neutral", 0.9, 0.9);
  const bearishBrain = brain("cre-swfl", "bearish", 0.1, 0.9);
  const passing = [
    { upstream: neutralBrain, factor: 1 },
    { upstream: bearishBrain, factor: 1 },
  ];
  const vote = voteDirection(passing);
  assert.equal(vote.direction, "bearish");
  assert.ok(vote.agreement_ratio > 0.6);
  assert.ok(vote.drivers.includes("cre-swfl"));
  assert.ok(!vote.drivers.includes("macro-us"), "neutral brain must not be in drivers");
});

// ---- applyOverrideCascade --------------------------------------------------

const FLOOD_RULE: OverrideRule = {
  priority: 90,
  override_id: "flood-veto",
  effect: "force_bearish",
  condition: (upstreams) =>
    upstreams.some((u) =>
      u.key_metrics.some(
        (m) => m.metric === "flood_risk_pct" && typeof m.value === "number" && m.value > 15,
      ),
    ),
};

const SIGNAL_RULE: OverrideRule = {
  priority: 100,
  override_id: "exogenous-critical-confirmed",
  effect: "force_signal_direction",
  condition: (_u, signals) =>
    signals.some(
      (s) => s.severity === "critical" && s.classification === "confirmed" && s.confidence > 0.85,
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
  const result = applyOverrideCascade(vote, passing, signals, [SIGNAL_RULE, FLOOD_RULE]);
  assert.equal(result.direction, "bullish");
  assert.deepEqual(result.overrides, ["exogenous-critical-confirmed"]);
});

// ---- detectContradictions --------------------------------------------------

test("detectContradictions: high-conf opposite → contradiction (spec test 7)", () => {
  const a = brain("a", "bullish", 0.7, 0.7);
  const b = brain("b", "bearish", 0.7, 0.7);
  const out = detectContradictions([a, b].map((u) => ({ upstream: u, factor: 1 })));
  assert.deepEqual(out, ["a (bullish) vs b (bearish)"]);
});

test("detectContradictions: low-confidence pair → no contradiction", () => {
  const a = brain("a", "bullish", 0.7, 0.4);
  const b = brain("b", "bearish", 0.7, 0.7);
  const out = detectContradictions([a, b].map((u) => ({ upstream: u, factor: 1 })));
  assert.equal(out.length, 0);
});

test("detectContradictions: neutral and mixed pairs skipped", () => {
  const a = brain("a", "neutral", 0.7, 0.9);
  const b = brain("b", "bearish", 0.7, 0.9);
  const c = brain("c", "mixed", 0.7, 0.9);
  const d = brain("d", "bullish", 0.7, 0.9);
  const out = detectContradictions([a, b, c, d].map((u) => ({ upstream: u, factor: 1 })));
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
  // Both T1 → t1Count=2, cap=3. Reserve: a_m0, b_m0. Fill: 1 slot → a_m1
  // (ties broken by DAG order; "a" is index 0).
  const ups = [
    brain("a", "bullish", 0.5, 0.8, { trust_tier: 1, key_metrics: mk("a", 3) }),
    brain("b", "bullish", 0.5, 0.8, { trust_tier: 1, key_metrics: mk("b", 2) }),
  ];
  const passing = ups.map((u) => ({ upstream: u, factor: 1 }));
  const out = rollupKeyMetrics(passing);
  assert.equal(out.length, 3);
  // Reserve pass first (a_m0, b_m0), then fill pass (a_m1) — ordering
  // is "all seats reserved, then all fills," not "all of a, then all of b."
  assert.deepEqual(
    out.map((m) => m.metric),
    ["a_m0", "b_m0", "a_m1"],
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

test("rollupKeyMetrics: dynamic cap = t1Count + 1, all T1 brains appear", () => {
  // 3 T1 brains + 4 T2 brains → cap = 3+1 = 4
  const mk = (slug: string): BrainOutputMetric[] => [
    metric({ metric: slug, value: 1, direction: "rising", label: slug }),
  ];
  const t1s = Array.from({ length: 3 }, (_, i) =>
    brain(`t1_${i}`, "bullish", 0.9, 0.9, {
      key_metrics: mk(`t1_${i}`),
      trust_tier: 1,
    }),
  );
  const t2s = Array.from({ length: 4 }, (_, i) =>
    brain(`t2_${i}`, "bullish", 0.5, 0.7, {
      key_metrics: mk(`t2_${i}`),
      trust_tier: 2,
    }),
  );
  const out = rollupKeyMetrics([
    ...t1s.map((u) => ({ upstream: u, factor: 1 })),
    ...t2s.map((u) => ({ upstream: u, factor: 1 })),
  ]);
  const slugs = out.map((m) => m.metric);
  assert.equal(out.length, 4);
  assert.ok(slugs.includes("t1_0"));
  assert.ok(slugs.includes("t1_1"));
  assert.ok(slugs.includes("t1_2"));
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
  assert.ok(r.half_life_hours > 950, `expected near 1000, got ${r.half_life_hours}`);
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
  assert.deepEqual(r.caveats, ["All upstream brains below relevance threshold"]);
  assert.deepEqual(r.exogenous_signals, []);
});

// ---- composeConditionalThesis (dossier authoring) --------------------------

import { composeConditionalThesis, composeGrainBoundary, predictedWindow } from "./synth.mts";

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

test("composeConditionalThesis: mixed vote → directional sub-calls first, split context last", () => {
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
  // Two directional sub-calls + one split-context claim.
  assert.ok(claims.length >= 2, `expected at least 2 claims, got ${claims.length}`);
  // The split-context claim must be last.
  const last = claims[claims.length - 1];
  assert.equal(last.then_direction, "mixed");
  assert.match(last.condition, /split/);
  // The first claim must be directional (gradeable by deriveGradeFields[0]).
  assert.ok(
    claims[0].then_direction === "bullish" || claims[0].then_direction === "bearish",
    `expected claims[0] to be directional, got ${claims[0].then_direction}`,
  );
  // Both brain_ids must appear somewhere in the claims.
  const allRefs = claims.flatMap((c) => c.basis_refs);
  assert.ok(allRefs.includes("cre-swfl") || allRefs.includes("sector-credit-swfl"));
});

test("composeConditionalThesis: neutral vote → holding-pattern claim", () => {
  const passing = [{ upstream: brain("macro-us", "neutral", 0.5, 0.8), factor: 1 }];
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

// ---- composeConditionalThesis: gradeable-anchor selection (yield-leak fix B) ----

import { resolveGradeConfig } from "../vocab/loader.mts";
import type { ResolvedGradeConfig } from "../vocab/loader.mts";
import { deriveGradeFields } from "./predictions-log.mts";

/** Stub grade-config resolver: only the named slugs are gradeable, with the given block. */
function gcStub(
  map: Record<string, Partial<ResolvedGradeConfig> & { gradeable: true }>,
): (slug: string) => ResolvedGradeConfig {
  return (slug) => {
    const base: ResolvedGradeConfig = {
      slug,
      concept_id: slug,
      gradeable: false,
      window_days: null,
      epsilon: null,
      epsilon_mode: null,
      grade_basis: null,
      direction_polarity: "none",
      source: { window: null, epsilon: null, polarity: null },
    };
    return map[slug] ? { ...base, ...map[slug] } : base;
  };
}

test("composeConditionalThesis: directional read anchors on the first GRADEABLE driver, not key_metrics[0]", () => {
  const m0 = metric({
    metric: "cre_categorical_index",
    value: 5,
    direction: "rising",
    label: "idx",
  });
  const m1 = metric({ metric: "velocity_z", value: 1.4, direction: "rising", label: "vz" });
  const passing = [
    {
      upstream: brain("properties-lee-value", "bullish", 0.8, 0.9, { key_metrics: [m0, m1] }),
      factor: 1,
    },
  ];
  const claims = composeConditionalThesis({
    passing,
    vote: voteDirection(passing),
    trust_tier: 2,
    finalKeyMetrics: [m0, m1], // both survive the rollup for this test
    gradeConfigFor: gcStub({
      velocity_z: {
        gradeable: true,
        grade_basis: "sign",
        epsilon: 0.1,
        epsilon_mode: "absolute",
        direction_polarity: "higher_is_bullish",
        window_days: 180,
      },
    }),
  });
  assert.equal(claims[0].then_direction, "bullish");
  assert.ok(claims[0].basis_refs.includes("velocity_z")); // the gradeable, checkable anchor
  assert.ok(!claims[0].basis_refs.includes("cre_categorical_index")); // the non-gradeable top metric is NOT cited
});

test("composeConditionalThesis: a sign-basis driver CONTRADICTING the claim is skipped → non-gradeable fallback", () => {
  // Bullish claim, but the only gradeable slug is a NEGATIVE higher-is-bullish z (bearish-signed).
  const mNeg = metric({ metric: "velocity_z", value: -1.4, direction: "falling", label: "vz" });
  const mPlain = metric({
    metric: "cre_categorical_index",
    value: 5,
    direction: "rising",
    label: "idx",
  });
  const passing = [
    {
      upstream: brain("properties-lee-value", "bullish", 0.8, 0.9, { key_metrics: [mNeg, mPlain] }),
      factor: 1,
    },
  ];
  const claims = composeConditionalThesis({
    passing,
    vote: voteDirection(passing),
    trust_tier: 2,
    finalKeyMetrics: [mNeg, mPlain],
    gradeConfigFor: gcStub({
      velocity_z: {
        gradeable: true,
        grade_basis: "sign",
        epsilon: 0.1,
        epsilon_mode: "absolute",
        direction_polarity: "higher_is_bullish",
        window_days: 180,
      },
    }),
  });
  // The contradicting gradeable slug must NOT be the cited anchor (would mis-grade);
  // it falls back to the non-gradeable numeric driver so the row is honestly ungradeable.
  assert.ok(!claims[0].basis_refs.includes("velocity_z"));
  assert.ok(claims[0].basis_refs.includes("cre_categorical_index"));
});

test("composeConditionalThesis → deriveGradeFields: real resolver makes a directional master call GRADEABLE", () => {
  // properties_lee_sales_velocity_zscore is a real gradeable slug (sign, higher_is_bullish).
  const vz = metric({
    metric: "properties_lee_sales_velocity_zscore",
    value: 1.4,
    direction: "rising",
    label: "vz",
  });
  const passing = [
    {
      upstream: brain("properties-lee-value", "bullish", 0.8, 0.9, { key_metrics: [vz] }),
      factor: 1,
    },
  ];
  const claims = composeConditionalThesis({
    passing,
    vote: voteDirection(passing),
    trust_tier: 2,
    finalKeyMetrics: [vz],
    gradeConfigFor: resolveGradeConfig,
  });
  // Feed the produced claims + the same numeric metric back through the LIVE capture path.
  const output = {
    ...brain("master", "bullish", 0.8, 0.9, { key_metrics: [vz] }),
    conditional_claims: claims,
  };
  const g = deriveGradeFields(output);
  assert.equal(g.grade_status, "gradeable");
  assert.equal(g.gradeable_slug, "properties_lee_sales_velocity_zscore");
  assert.equal(g.predicted_direction, "bullish");
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

test("composeConditionalThesis: neutral vote — basis_refs cites only the neutral brain", () => {
  // With neutral-abstains, a neutral vote requires directional weight = 0.
  // Use a single neutral brain so the premise is unambiguous.
  // The neutral brain must appear in basis_refs.
  const neutralBrain = brain("macro-us", "neutral", 0.9, 0.9);
  const passing = [{ upstream: neutralBrain, factor: 1 }];
  const vote = voteDirection(passing);
  assert.equal(vote.direction, "neutral", "vote must be neutral for this test");
  const claims = composeConditionalThesis({
    passing,
    vote,
    trust_tier: 2,
    finalKeyMetrics: rollupKeyMetrics(passing),
  });
  assert.equal(claims[0].then_direction, "neutral");
  assert.ok(
    claims[0].basis_refs.includes("macro-us"),
    "neutral brain_id must appear in basis_refs",
  );
});

// ---- composeGrainBoundary --------------------------------------------------

test("composeGrainBoundary: well-formed grain + non-empty boundary + excluded note", () => {
  const passing = [{ upstream: brain("macro-us", "bullish", 0.5, 0.8), factor: 1 }];
  const gb = composeGrainBoundary({
    passing,
    originalCount: 3,
    relevanceFloor: 0.1,
  });
  assert.equal(gb.finest_grain, "county-month");
  assert.ok(gb.not_available.length > 0);
  // originalCount(3) - passing(1) = 2 excluded → that line appears.
  assert.ok(gb.not_available.some((s) => /2 upstream read\(s\) fell below/.test(s)));
  // finest_grain must satisfy the grain-guard <unit>-<period> format.
  assert.match(gb.finest_grain, /^[a-z]+-[a-z]+$/);
});

test("composeGrainBoundary: env-swfl contributing per-ZIP metrics this run → flood route offered", () => {
  // env-swfl is a master upstream; when it actually emits swfl_zip_* metrics
  // this run (i.e. §1 FEMA per-ZIP data is live), master holds a finer grain
  // than county for flood — surface it as a plain user offer.
  const passing = [
    {
      upstream: brain("env-swfl", "bearish", 0.6, 0.8, {
        key_metrics: [
          metric({
            metric: "swfl_zip_33931_flood_aal_usd_per_insured_property",
            value: 850,
            direction: "stable",
            label: "33931 flood AAL per insured property",
          }),
        ],
      }),
      factor: 1,
    },
  ];
  const gb = composeGrainBoundary({
    passing,
    originalCount: 1,
    relevanceFloor: 0.1,
  });
  assert.ok(gb.routes && gb.routes.length > 0, "expected a route offer");
  assert.ok(
    gb.routes!.some((r) => /flood/i.test(r) && /zip/i.test(r)),
    `expected a per-ZIP flood offer, got: ${JSON.stringify(gb.routes)}`,
  );
});

test("composeGrainBoundary: env-swfl wired but NO per-ZIP metrics this run → no flood route (gate on data, not wiring)", () => {
  // Same bug class as the §2 MarketBeat caveat: a present-but-empty upstream
  // must not light an offer. env-swfl with only metro-level metrics holds no
  // finer grain this run.
  const passing = [
    {
      upstream: brain("env-swfl", "bearish", 0.6, 0.8, {
        key_metrics: [
          metric({
            metric: "swfl_metro_flood_aal_usd",
            value: 700,
            direction: "stable",
            label: "metro flood AAL",
          }),
        ],
      }),
      factor: 1,
    },
  ];
  const gb = composeGrainBoundary({
    passing,
    originalCount: 1,
    relevanceFloor: 0.1,
  });
  assert.ok(
    !gb.routes || gb.routes.length === 0,
    `expected no routes when env-swfl emits no per-ZIP metrics, got: ${JSON.stringify(gb.routes)}`,
  );
});

test("composeGrainBoundary: no env-swfl upstream → no routes", () => {
  const passing = [{ upstream: brain("macro-us", "bullish", 0.5, 0.8), factor: 1 }];
  const gb = composeGrainBoundary({
    passing,
    originalCount: 1,
    relevanceFloor: 0.1,
  });
  assert.ok(!gb.routes || gb.routes.length === 0);
});

test("composeGrainBoundary: cre contributing corridor_pulse_signals_live → corridor route, distinct from flood", () => {
  // cre forwards a deterministic count of live corridor current-events signals;
  // master offers an area current-events route so a downstream Claude routes to
  // the corridor brain instead of free-styling (the FMB charge-off failure).
  const passing = [
    {
      upstream: brain("cre-swfl", "bullish", 0.5, 0.8, {
        key_metrics: [
          metric({
            metric: "corridor_pulse_signals_live",
            value: 7,
            direction: "stable",
            label: "Live corridor current-events signals informing this read (7)",
          }),
        ],
      }),
      factor: 1,
    },
  ];
  const gb = composeGrainBoundary({
    passing,
    originalCount: 1,
    relevanceFloor: 0.1,
  });
  const corridorRoute = gb.routes?.find((r) => /current events/i.test(r) && /area/i.test(r));
  assert.ok(
    corridorRoute,
    `expected a corridor current-events offer, got: ${JSON.stringify(gb.routes)}`,
  );
  // Mandatory disambiguation: it must NOT read like the per-ZIP flood route.
  assert.doesNotMatch(corridorRoute!, /flood|zip/i);
});

test("composeGrainBoundary: cre wired but corridor_pulse_signals_live=0 → no corridor route (gate on contribution)", () => {
  // corridor-pulse is TTL-bounded; a 0 count means it emptied this run. cre still
  // votes, but the area route must stay dark — the inverse-FMB false-offer guard.
  const passing = [
    {
      upstream: brain("cre-swfl", "bullish", 0.5, 0.8, {
        key_metrics: [
          metric({
            metric: "corridor_pulse_signals_live",
            value: 0,
            direction: "stable",
            label: "Live corridor current-events signals informing this read (0)",
          }),
          metric({
            metric: "cap_rate_median",
            value: 6.1,
            direction: "stable",
            label: "Median SWFL CRE cap rate",
          }),
        ],
      }),
      factor: 1,
    },
  ];
  const gb = composeGrainBoundary({
    passing,
    originalCount: 1,
    relevanceFloor: 0.1,
  });
  assert.ok(
    !gb.routes || !gb.routes.some((r) => /current events/i.test(r)),
    `expected no corridor route when the count is 0, got: ${JSON.stringify(gb.routes)}`,
  );
});

test("composeGrainBoundary: env per-ZIP + cre corridor signals → both routes, clearly distinct", () => {
  const passing = [
    {
      upstream: brain("env-swfl", "bearish", 0.6, 0.8, {
        key_metrics: [
          metric({
            metric: "swfl_zip_33931_aal",
            value: 1200,
            direction: "rising",
            label: "ZIP 33931 average annual flood loss",
          }),
        ],
      }),
      factor: 1,
    },
    {
      upstream: brain("cre-swfl", "bullish", 0.5, 0.8, {
        key_metrics: [
          metric({
            metric: "corridor_pulse_signals_live",
            value: 4,
            direction: "stable",
            label: "Live corridor current-events signals informing this read (4)",
          }),
        ],
      }),
      factor: 1,
    },
  ];
  const gb = composeGrainBoundary({
    passing,
    originalCount: 2,
    relevanceFloor: 0.1,
  });
  assert.equal(gb.routes?.length, 2, `expected both routes, got: ${JSON.stringify(gb.routes)}`);
  const flood = gb.routes!.find((r) => /flood/i.test(r));
  const corridor = gb.routes!.find((r) => /current events/i.test(r));
  assert.ok(flood && corridor, "expected one flood route and one corridor route");
  assert.notEqual(flood, corridor);
});

test("cre→master hop: corridor count buried at index 2 is SEEN by the route gate but NOT lifted into master's dossier", () => {
  // Coherence proof for the two-claims-in-tension concern. cre appends
  // corridor_pulse_signals_live AFTER its medians, so it lives at index >= 2.
  // master.mts feeds the SAME `passing` (full upstream BrainOutputs, from
  // lastUpstreams = …map(n => n.output)) to BOTH:
  //   • composeGrainBoundary (master.mts:183) — reads the FULL key_metrics array,
  //   • rollupKeyMetrics      (master.mts:143) — lifts only key_metrics[0]/[1].
  // So the gate must fire from index 2 AND the count must stay out of the dossier.
  const cre = brain("cre-swfl", "bullish", 0.5, 0.8, {
    trust_tier: 1,
    key_metrics: [
      metric({
        metric: "cap_rate_median",
        value: 6.1,
        direction: "stable",
        label: "Median SWFL CRE cap rate",
      }),
      metric({
        metric: "vacancy_rate_median",
        value: 7.4,
        direction: "stable",
        label: "Median SWFL CRE vacancy rate",
      }),
      metric({
        metric: "corridor_pulse_signals_live",
        value: 9,
        direction: "stable",
        label: "Live corridor current-events signals informing this read (9)",
      }),
    ],
  });
  const passing = [{ upstream: cre, factor: 1 }];

  // (a) The gate reads the full array → route fires even with the count at [2].
  const gb = composeGrainBoundary({
    passing,
    originalCount: 1,
    relevanceFloor: 0.1,
  });
  assert.ok(
    gb.routes?.some((r) => /current events/i.test(r)),
    `expected the corridor route to fire from a count at index 2, got: ${JSON.stringify(gb.routes)}`,
  );

  // (b) The dossier rollup lifts only [0]/[1] → the count never reaches master.
  const rolled = rollupKeyMetrics(passing);
  assert.ok(
    !rolled.some((m) => m.metric === "corridor_pulse_signals_live"),
    `corridor count must not reach master's dossier, got: ${rolled.map((m) => m.metric).join(", ")}`,
  );
  // Guard against a vacuous pass: rollup did lift a real median.
  assert.ok(
    rolled.some((m) => m.metric === "cap_rate_median"),
    "expected cap_rate_median in the rollup (sanity)",
  );
});

// ---- composeGrainBoundary: housing per-ZIP route ---------------------------

/** Minimal valid housing-swfl per-ZIP detail table for the route-gate tests. */
function zipDetailTable(zipKeys: string[]): BrainOutputDetailTable {
  return {
    id: "housing_by_zip",
    title: "SWFL housing by ZIP — test window",
    grain: "zip",
    columns: [
      {
        id: "median_sale_price",
        label: "Median sale price",
        display_format: "currency",
        units: "USD",
      },
    ],
    rows: zipKeys.map((z) => ({
      key: z,
      label: z,
      cells: { median_sale_price: 500000 },
    })),
    source: {
      url: "test://housing-swfl/by-zip",
      fetched_at: NOW.toISOString(),
      tier: 3,
      citation: "test Redfin per-ZIP",
    },
  };
}

test("composeGrainBoundary: housing-swfl contributing a per-ZIP detail table this run → housing route offered, distinct from flood/corridor", () => {
  // housing-swfl publishes one row per SWFL ZIP in a detail_tables entry
  // (grain "zip") — finer than master's county-month headline. When that table
  // actually carries rows this run, master holds a finer grain for housing —
  // surface it as a plain per-ZIP offer (parity with the env-swfl flood route).
  const passing = [
    {
      upstream: brain("housing-swfl", "bullish", 0.5, 0.8, {
        detail_tables: [zipDetailTable(["33913"])],
      }),
      factor: 1,
    },
  ];
  const gb = composeGrainBoundary({
    passing,
    originalCount: 1,
    relevanceFloor: 0.1,
  });
  const housingRoute = gb.routes?.find((r) => /housing/i.test(r) && /zip/i.test(r));
  assert.ok(housingRoute, `expected a per-ZIP housing offer, got: ${JSON.stringify(gb.routes)}`);
  // Mandatory disambiguation: must not read like the flood or corridor route.
  assert.doesNotMatch(housingRoute!, /flood|current events/i);
});

test("composeGrainBoundary: housing-swfl wired but its per-ZIP table is empty → no housing route (gate on data, not wiring)", () => {
  // housing-swfl emits detail_tables: [] when Redfin returns no SWFL ZIP
  // medians (housing-swfl.mts:525). A present-but-empty table must not light
  // the offer — same inverse-FMB false-offer guard as the flood/corridor gates.
  const passing = [
    {
      upstream: brain("housing-swfl", "bullish", 0.5, 0.8, {
        detail_tables: [zipDetailTable([])],
      }),
      factor: 1,
    },
  ];
  const gb = composeGrainBoundary({
    passing,
    originalCount: 1,
    relevanceFloor: 0.1,
  });
  assert.ok(
    !gb.routes || !gb.routes.some((r) => /housing/i.test(r)),
    `expected no housing route when the per-ZIP table is empty, got: ${JSON.stringify(gb.routes)}`,
  );
});

test("composeGrainBoundary: no housing-swfl upstream → no housing route", () => {
  const passing = [{ upstream: brain("macro-us", "bullish", 0.5, 0.8), factor: 1 }];
  const gb = composeGrainBoundary({
    passing,
    originalCount: 1,
    relevanceFloor: 0.1,
  });
  assert.ok(!gb.routes || !gb.routes.some((r) => /housing/i.test(r)));
});

test("composeGrainBoundary: env per-ZIP + cre corridor + housing per-ZIP → three routes, each distinct", () => {
  const passing = [
    {
      upstream: brain("env-swfl", "bearish", 0.6, 0.8, {
        key_metrics: [
          metric({
            metric: "swfl_zip_33931_aal",
            value: 1200,
            direction: "rising",
            label: "ZIP 33931 average annual flood loss",
          }),
        ],
      }),
      factor: 1,
    },
    {
      upstream: brain("cre-swfl", "bullish", 0.5, 0.8, {
        key_metrics: [
          metric({
            metric: "corridor_pulse_signals_live",
            value: 4,
            direction: "stable",
            label: "Live corridor current-events signals informing this read (4)",
          }),
        ],
      }),
      factor: 1,
    },
    {
      upstream: brain("housing-swfl", "bullish", 0.5, 0.8, {
        detail_tables: [zipDetailTable(["33913", "34109"])],
      }),
      factor: 1,
    },
  ];
  const gb = composeGrainBoundary({
    passing,
    originalCount: 3,
    relevanceFloor: 0.1,
  });
  assert.equal(
    gb.routes?.length,
    3,
    `expected three distinct routes, got: ${JSON.stringify(gb.routes)}`,
  );
  const flood = gb.routes!.find((r) => /flood/i.test(r));
  const corridor = gb.routes!.find((r) => /current events/i.test(r));
  const housing = gb.routes!.find((r) => /housing/i.test(r));
  assert.ok(
    flood && corridor && housing,
    "expected one flood, one corridor, and one housing route",
  );
  assert.doesNotMatch(housing!, /flood|current events/i);
});

// ---- predictedWindow -------------------------------------------------------

test("predictedWindow: neutral vote → undefined", () => {
  const passing = [{ upstream: brain("macro-us", "neutral", 0.5, 0.8), factor: 1 }];
  assert.equal(predictedWindow({ passing, vote: voteDirection(passing) }), undefined);
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
  const passing = [{ upstream: brain("cre-swfl", "bullish", 0.8, 0.9), factor: 1 }];
  const w = predictedWindow({ passing, vote: voteDirection(passing) });
  assert.match(String(w), /quarters/);
});
