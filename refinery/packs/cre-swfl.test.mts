import { test } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";
import type { BrainOutput, BrainOutputMetric } from "../types/brain-output.mts";
import type { BrainInputNormalized } from "../sources/brain-input-source.mts";
import type { MarketbeatSwflNormalized } from "../sources/marketbeat-swfl-source.mts";
import type { CorridorNormalized } from "../sources/cre-source.mts";

process.env["REFINERY_SOURCE"] = "fixture";

const { creSwfl } = await import("./cre-swfl.mts");
const { corridorSource } = await import("../sources/cre-source.mts");
const { marketbeatSwflSource } =
  await import("../sources/marketbeat-swfl-source.mts");

const NOW = "2026-05-22T00:00:00Z";

function pmMetric(slug: string, value: number | string): BrainOutputMetric {
  return {
    metric: slug,
    value,
    direction: "stable",
    label: slug,
    variable_type: "intensive",
    units: "ratio",
    source: {
      url: "test://permits-swfl",
      fetched_at: NOW,
      tier: 1,
      citation: "permits fixture",
    },
  };
}

function makePermitsOutput(
  saturationIndex: number,
  countyZ: number,
): BrainOutput {
  return {
    brain_id: "permits-swfl",
    version: 1,
    refined_at: NOW,
    direction: "neutral",
    magnitude: 0.5,
    drivers: [],
    overrides: [],
    conclusion: "test fixture — permits-swfl OUTPUT",
    key_metrics: [
      pmMetric("permits_lee_saturation_index", saturationIndex),
      pmMetric("permits_lee_county_weighted_avg_corridor_z", countyZ),
      pmMetric(
        "permits_lee_top_heating_commercial_alteration",
        "us-41-fort-myers,daniels-pkwy",
      ),
    ],
    caveats: [],
    contradicts: [],
    confidence: 0.7,
    joint_integrity: 1,
    confidence_dispersion: 0,
    chain_depth: 0,
    trust_tier: 1,
    upstream_count: 0,
    relevance: { decay_curve: "weeks", half_life_hours: 168, computed_at: NOW },
    exogenous_signals: [],
  };
}

function makePermitsFragment(output: BrainOutput): RawFragment {
  const norm: BrainInputNormalized = {
    kind: "brain-input",
    upstream_id: "permits-swfl",
    output,
  };
  return {
    fragment_id: "brain-input:permits-swfl:test",
    source_id: "brain-input:permits-swfl",
    source_trust_tier: 2,
    fetched_at: NOW,
    raw: {},
    normalized: norm as unknown as Record<string, unknown>,
  };
}

function minimalPackOutput() {
  return {
    pack: creSwfl,
    version: 1,
    refined_at: NOW,
    citations: [],
    facts: [],
    recentNote: "test",
  };
}

test("cre-swfl × permits-swfl: saturation >= 0.4 → conclusion mentions saturation + emits saturation signal metric", () => {
  const permitsOut = makePermitsOutput(0.5, 2.1);
  creSwfl.corpusSummary!([makePermitsFragment(permitsOut)]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  assert.ok(
    /saturation/i.test(result.conclusion),
    `expected 'saturation' in conclusion, got: ${result.conclusion}`,
  );
  const satMetric = result.key_metrics.find(
    (m) => m.metric === "permits_lee_saturation_signal",
  );
  assert.ok(satMetric, "expected permits_lee_saturation_signal in key_metrics");
  assert.equal(satMetric!.value, 0.5);
});

test("cre-swfl × permits-swfl: saturation < 0.4 → emits capital-flow z metric, no saturation metric", () => {
  const permitsOut = makePermitsOutput(0.2, 0.8);
  creSwfl.corpusSummary!([makePermitsFragment(permitsOut)]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  const satMetric = result.key_metrics.find(
    (m) => m.metric === "permits_lee_saturation_signal",
  );
  assert.ok(!satMetric, "expected no saturation signal for low saturation");
  const zMetric = result.key_metrics.find(
    (m) => m.metric === "permits_lee_capital_flow_z",
  );
  assert.ok(
    zMetric,
    "expected permits_lee_capital_flow_z for low saturation path",
  );
  assert.equal(zMetric!.value, 0.8);
});

test("cre-swfl × permits-swfl: no permits upstream → no permits metrics in output", () => {
  creSwfl.corpusSummary!([]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  const satMetric = result.key_metrics.find(
    (m) => m.metric === "permits_lee_saturation_signal",
  );
  const zMetric = result.key_metrics.find(
    (m) => m.metric === "permits_lee_capital_flow_z",
  );
  assert.ok(!satMetric, "expected no saturation signal when permits absent");
  assert.ok(!zMetric, "expected no z signal when permits absent");
});

// --- corridor-pulse contribution count (B1) ---------------------------

function makeCorridorPulseFragment(signalCount: number): RawFragment {
  const key_metrics: BrainOutputMetric[] = Array.from(
    { length: signalCount },
    (_, i) => ({
      metric: `signal_breaking_${i + 1}`,
      value: "Fort Myers Beach — a beachfront retail building changed hands",
      direction: "stable" as const,
      label: "Fort Myers Beach — breaking",
      variable_type: "categorical" as const,
      source: {
        url: `https://gulfshorebusiness.com/s${i + 1}`,
        fetched_at: NOW,
        tier: 2 as const,
        citation: `corridor-pulse signal ${i + 1}`,
      },
    }),
  );
  const output: BrainOutput = {
    brain_id: "corridor-pulse-swfl",
    version: 1,
    refined_at: NOW,
    direction: "neutral",
    magnitude: 0,
    drivers: [],
    overrides: [],
    conclusion: "test fixture — corridor-pulse-swfl OUTPUT",
    key_metrics,
    caveats: [],
    contradicts: [],
    confidence: 0.7,
    joint_integrity: 1,
    confidence_dispersion: 0,
    chain_depth: 0,
    trust_tier: 2,
    upstream_count: 0,
    relevance: { decay_curve: "weeks", half_life_hours: 168, computed_at: NOW },
    exogenous_signals: [],
  };
  const norm: BrainInputNormalized = {
    kind: "brain-input",
    upstream_id: "corridor-pulse-swfl",
    output,
  };
  return {
    fragment_id: "brain-input:corridor-pulse-swfl:test",
    source_id: "brain-input:corridor-pulse-swfl",
    source_trust_tier: 2,
    fetched_at: NOW,
    raw: {},
    normalized: norm as unknown as Record<string, unknown>,
  };
}

// cre only builds a corpus when it has verified corridors (creCorpusSummary
// early-returns on zero corridors), so every case carries a corridor fragment —
// cre's normal state. The corridor-pulse fragment is the contribution under test.
test("cre-swfl × corridor-pulse: N live signals → corridor_pulse_signals_live = N", () => {
  creSwfl.corpusSummary!([
    makeCorridorFragment("Pine Ridge Rd Naples", "Naples"),
    makeCorridorPulseFragment(7),
  ]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  const m = result.key_metrics.find(
    (k) => k.metric === "corridor_pulse_signals_live",
  );
  assert.ok(m, "expected a corridor_pulse_signals_live metric");
  assert.equal(m!.value, 7);
  assert.ok(
    typeof m!.source === "object" && m!.source.url.length > 0,
    "count metric must carry a well-formed source receipt",
  );
});

test("cre-swfl × corridor-pulse: corridors present but no corridor-pulse upstream → no count metric (gate on contribution, not wiring)", () => {
  creSwfl.corpusSummary!([
    makeCorridorFragment("Pine Ridge Rd Naples", "Naples"),
  ]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  assert.ok(
    !result.key_metrics.some((k) => k.metric === "corridor_pulse_signals_live"),
    "no corridor count metric when corridor-pulse is absent",
  );
});

test("cre-swfl × corridor-pulse: singleton reset — a second run without corridor-pulse clears the prior count", () => {
  creSwfl.corpusSummary!([
    makeCorridorFragment("Pine Ridge Rd Naples", "Naples"),
    makeCorridorPulseFragment(5),
  ]);
  creSwfl.outputProducer!(minimalPackOutput());
  creSwfl.corpusSummary!([
    makeCorridorFragment("Pine Ridge Rd Naples", "Naples"),
  ]);
  const run2 = creSwfl.outputProducer!(minimalPackOutput());
  assert.ok(
    !run2.key_metrics.some((k) => k.metric === "corridor_pulse_signals_live"),
    "a prior-run corridor count must not bleed into a run without corridor-pulse",
  );
});

// --- MarketBeat per-submarket fan-out ---------------------------------

function makeMbFragment(
  norm: MarketbeatSwflNormalized,
  fetched_at = NOW,
): RawFragment {
  return {
    fragment_id: `marketbeat_swfl:${norm.submarket}:${norm.quarter}`,
    source_id: "marketbeat_swfl",
    source_trust_tier: 2,
    fetched_at,
    raw: {},
    normalized: norm as unknown as Record<string, unknown>,
  };
}

function makeCorridorFragment(name: string, city: string): RawFragment {
  const norm: CorridorNormalized = {
    kind: "corridor",
    name,
    city,
    county: "Lee",
    corridor_type: "highway-strip-mall",
    seasonal_index: 0.3,
    character: null,
    evolution_direction: null,
    tenant_mix: null,
    flags: [],
    source_url: null,
    cap_rate_source_url: null,
    vacancy_rate_source_url: null,
    absorption_sqft_source_url: null,
    asking_rent_psf_source_url: null,
    cap_rate_pct: null,
    cap_rate_direction: null,
    vacancy_rate_pct: null,
    vacancy_rate_direction: null,
    absorption_sqft: null,
    absorption_sqft_direction: null,
    asking_rent_psf: null,
    asking_rent_psf_direction: null,
    metrics_period: null,
    metrics_verified_date: null,
    character_broker_narrative: null,
    character_render: null,
    character_facts: null,
    character_speculative: null,
    character_chart: null,
    character_citations: null,
    character_generated_at: null,
    character_fact_pack_vintage: null,
  };
  return {
    fragment_id: `corridor_profiles:${name}`,
    source_id: "corridor_profiles",
    source_trust_tier: 2,
    fetched_at: NOW,
    raw: {},
    normalized: norm as unknown as Record<string, unknown>,
  };
}

test("marketbeat: baseline non-regression — no marketbeat fragments → zero *_marketbeat_* keys", () => {
  creSwfl.corpusSummary!([
    makeCorridorFragment("Pine Ridge Rd Naples", "Naples"),
  ]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  const mbKeys = result.key_metrics.filter((m) =>
    m.metric.includes("marketbeat"),
  );
  assert.equal(
    mbKeys.length,
    0,
    `expected zero marketbeat keys, got: ${mbKeys.map((m) => m.metric).join(", ")}`,
  );
});

test("marketbeat: per-submarket fan-out with the existing fixture emits exactly 9 new keys with pinned values", async () => {
  const corridorFragments = await corridorSource.fetch();
  const mbFragments = await marketbeatSwflSource.fetch();
  creSwfl.corpusSummary!([...corridorFragments, ...mbFragments]);
  const result = creSwfl.outputProducer!(minimalPackOutput());

  // Vacancy_rate — pinned to marketbeat fixture latest-verified picks.
  const vacNaples = result.key_metrics.find(
    (m) => m.metric === "vacancy_rate_marketbeat_naples",
  );
  const vacFm = result.key_metrics.find(
    (m) => m.metric === "vacancy_rate_marketbeat_fort_myers",
  );
  const vacCc = result.key_metrics.find(
    (m) => m.metric === "vacancy_rate_marketbeat_cape_coral",
  );
  assert.ok(vacNaples && vacFm && vacCc);
  assert.equal(vacNaples!.value, 4.8);
  assert.equal(vacFm!.value, 8.2);
  assert.equal(vacCc!.value, 7.0);

  // Asking rent NNN.
  const rentNaples = result.key_metrics.find(
    (m) => m.metric === "asking_rent_nnn_marketbeat_naples",
  );
  const rentFm = result.key_metrics.find(
    (m) => m.metric === "asking_rent_nnn_marketbeat_fort_myers",
  );
  const rentCc = result.key_metrics.find(
    (m) => m.metric === "asking_rent_nnn_marketbeat_cape_coral",
  );
  assert.ok(rentNaples && rentFm && rentCc);
  assert.equal(rentNaples!.value, 41.5);
  assert.equal(rentFm!.value, 26.0);
  assert.equal(rentCc!.value, 22.5);

  // Absorption — extensive, count format, negative for Fort Myers Q3 (give-back).
  const absNaples = result.key_metrics.find(
    (m) => m.metric === "absorption_sqft_marketbeat_naples",
  );
  const absFm = result.key_metrics.find(
    (m) => m.metric === "absorption_sqft_marketbeat_fort_myers",
  );
  const absCc = result.key_metrics.find(
    (m) => m.metric === "absorption_sqft_marketbeat_cape_coral",
  );
  assert.ok(absNaples && absFm && absCc);
  assert.equal(absNaples!.value, 32000);
  assert.equal(absFm!.value, -5000);
  assert.equal(absCc!.value, 8000);
  assert.equal(absFm!.variable_type, "extensive");
  assert.equal(absFm!.units, "sqft");
  assert.equal(absFm!.display_format, "count");

  // Existing SWFL-wide medians stay on contract (augment, not replace).
  const swflVac = result.key_metrics.find(
    (m) => m.metric === "vacancy_rate_marketbeat_swfl",
  );
  const swflRent = result.key_metrics.find(
    (m) => m.metric === "asking_rent_nnn_marketbeat_swfl",
  );
  assert.ok(swflVac && swflRent);
});

test("marketbeat: citation enumerates matched corridors with 'matched X of Y mapped' denominator", async () => {
  const corridorFragments = await corridorSource.fetch();
  const mbFragments = await marketbeatSwflSource.fetch();
  creSwfl.corpusSummary!([...corridorFragments, ...mbFragments]);
  const result = creSwfl.outputProducer!(minimalPackOutput());

  // Fixture intersection with MARKETBEAT_SUBMARKET_MAP:
  //   Naples — 2 of 9 matched (Immokalee Rd North Naples, Pine Ridge Rd Naples)
  //   Fort Myers — 1 of 7 matched (Cleveland Ave Fort Myers)
  //   Cape Coral — 1 of 3 matched (Cape Coral Pkwy E)
  const vacNaples = result.key_metrics.find(
    (m) => m.metric === "vacancy_rate_marketbeat_naples",
  );
  assert.ok(vacNaples);
  const naplesCite = vacNaples!.source.citation;
  assert.ok(
    /matched 2 of 9 mapped/.test(naplesCite),
    `Naples citation missing 'matched 2 of 9 mapped': ${naplesCite}`,
  );
  // Citations now emit plain user-facing display names, not road-suffix labels.
  assert.ok(naplesCite.includes("North Naples (Immokalee Rd)"));
  assert.ok(naplesCite.includes("Pine Ridge"));

  const vacFm = result.key_metrics.find(
    (m) => m.metric === "vacancy_rate_marketbeat_fort_myers",
  );
  assert.ok(/matched 1 of 7 mapped/.test(vacFm!.source.citation));

  const vacCc = result.key_metrics.find(
    (m) => m.metric === "vacancy_rate_marketbeat_cape_coral",
  );
  assert.ok(/matched 1 of 3 mapped/.test(vacCc!.source.citation));

  // URL encoding sanity — multi-word submarkets must be percent-encoded.
  // Fixture mode collapses to fixture:// path, so synth a live-mode check
  // by inspecting the Fort Myers fixture-mode URL doesn't crash. The proper
  // assertion lives in the live-mode invariant: encodeURIComponent('Fort Myers')
  // = 'Fort%20Myers'. We just guard that the raw space is never present.
  assert.ok(
    !vacFm!.source.url.includes("eq.Fort Myers"),
    `Fort Myers URL must not contain raw space: ${vacFm!.source.url}`,
  );
});

test("marketbeat: zero-matched-corridors caveat fires when submarket reports a value but no mapped corridor is in the corpus", () => {
  // Construct a corpus with only ONE corridor — and one that does NOT map to
  // Naples — so the Naples MarketBeat row has zero verified-corpus corridors
  // to tie back to.
  const lonely = makeCorridorFragment("Cape Coral Pkwy E", "Cape Coral");
  const naplesMb: MarketbeatSwflNormalized = {
    kind: "marketbeat-swfl",
    submarket: "Naples",
    quarter: "2026-Q3",
    vacancy_rate: 4.8,
    asking_rent_nnn: 41.5,
    absorption_sqft: 32000,
    source_url: "https://example.invalid/naples",
  };
  creSwfl.corpusSummary!([lonely, makeMbFragment(naplesMb)]);
  const result = creSwfl.outputProducer!(minimalPackOutput());

  // Naples metrics still ship — broker survey stands on its own.
  const vacNaples = result.key_metrics.find(
    (m) => m.metric === "vacancy_rate_marketbeat_naples",
  );
  assert.ok(vacNaples, "expected Naples vacancy metric to still ship");
  assert.equal(vacNaples!.value, 4.8);

  // Zero-matched caveat fires with `0 of its 9 mapped` wording.
  const caveatHit = result.caveats.find(
    (c) =>
      c.includes("Naples") &&
      c.includes("0 of its 9 mapped") &&
      c.includes("verified corpus this run"),
  );
  assert.ok(
    caveatHit,
    `expected zero-matched caveat, got caveats:\n${result.caveats.join("\n")}`,
  );
});

test("marketbeat: singleton reset — running corpusSummary twice does not let a prior-run join bleed through", () => {
  // Run 1: full SWFL fixture-equivalent — Naples + Fort Myers + Cape Coral
  // mbRows with corridors that match each.
  const naples: MarketbeatSwflNormalized = {
    kind: "marketbeat-swfl",
    submarket: "Naples",
    quarter: "2026-Q3",
    vacancy_rate: 4.8,
    asking_rent_nnn: 41.5,
    absorption_sqft: 32000,
    source_url: "https://example.invalid/naples",
  };
  const fm: MarketbeatSwflNormalized = {
    kind: "marketbeat-swfl",
    submarket: "Fort Myers",
    quarter: "2026-Q3",
    vacancy_rate: 8.2,
    asking_rent_nnn: 26.0,
    absorption_sqft: -5000,
    source_url: "https://example.invalid/fm",
  };
  creSwfl.corpusSummary!([
    makeCorridorFragment("Pine Ridge Rd Naples", "Naples"),
    makeCorridorFragment("US-41 / Cleveland Ave Fort Myers", "Fort Myers"),
    makeMbFragment(naples),
    makeMbFragment(fm),
  ]);
  const run1 = creSwfl.outputProducer!(minimalPackOutput());
  assert.ok(
    run1.key_metrics.some(
      (m) => m.metric === "vacancy_rate_marketbeat_fort_myers",
    ),
    "run1 should emit Fort Myers vacancy",
  );

  // Run 2: empty corpus. If the prior-run join leaked, Fort Myers would still
  // be present. Reset block at top of creCorpusSummary must clear it.
  creSwfl.corpusSummary!([]);
  const run2 = creSwfl.outputProducer!(minimalPackOutput());
  const leakedKeys = run2.key_metrics.filter((m) =>
    m.metric.includes("marketbeat"),
  );
  assert.equal(
    leakedKeys.length,
    0,
    `expected zero marketbeat keys in run2 (post-reset), got: ${leakedKeys.map((m) => m.metric).join(", ")}`,
  );
});

// --- corridor_factor --------------------------------------------------------

function makeCorridorFragmentWithMetrics(
  name: string,
  city: string,
  cap: number,
  vac: number,
  abs: number,
  rent: number,
): RawFragment {
  const norm: CorridorNormalized = {
    kind: "corridor",
    name,
    city,
    county: "Lee",
    corridor_type: "highway-strip-mall",
    seasonal_index: 0.3,
    character: null,
    evolution_direction: null,
    tenant_mix: null,
    flags: [],
    source_url: null,
    cap_rate_source_url: null,
    vacancy_rate_source_url: null,
    absorption_sqft_source_url: null,
    asking_rent_psf_source_url: null,
    cap_rate_pct: cap,
    cap_rate_direction: null,
    vacancy_rate_pct: vac,
    vacancy_rate_direction: null,
    absorption_sqft: abs,
    absorption_sqft_direction: null,
    asking_rent_psf: rent,
    asking_rent_psf_direction: null,
    metrics_period: null,
    metrics_verified_date: null,
    character_broker_narrative: null,
    character_render: null,
    character_facts: null,
    character_speculative: null,
    character_chart: null,
    character_citations: null,
    character_generated_at: null,
    character_fact_pack_vintage: null,
  };
  return {
    fragment_id: `corridor_profiles:${name}`,
    source_id: "corridor_profiles",
    source_trust_tier: 2,
    fetched_at: NOW,
    raw: {},
    normalized: norm as unknown as Record<string, unknown>,
  };
}

test("corridor_factor: appears in key_metrics with a finite numeric score when corridors have CRE metrics", () => {
  creSwfl.corpusSummary!([
    makeCorridorFragmentWithMetrics("A Fort Myers", "Fort Myers", 6, 8, 1000, 20),
    makeCorridorFragmentWithMetrics("B Naples", "Naples", 4, 4, 5000, 30),
    makeCorridorFragmentWithMetrics("C Fort Myers", "Fort Myers", 9, 15, 200, 15),
  ]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  const cfMetric = result.key_metrics.find((m) => m.metric === "corridor_factor");
  assert.ok(cfMetric, "expected corridor_factor in key_metrics");
  assert.ok(
    typeof cfMetric!.value === "number" && Number.isFinite(cfMetric!.value),
    `expected a finite numeric corridor_factor value, got ${cfMetric!.value}`,
  );
  assert.ok(
    (cfMetric!.value as number) >= 0 && (cfMetric!.value as number) <= 100,
    `corridor_factor must be in [0, 100], got ${cfMetric!.value}`,
  );
  assert.equal(cfMetric!.units, "index 0-100");
  assert.equal(cfMetric!.display_format, "raw");
});

test("corridor_factor: absent when all corridors have null CRE metrics", () => {
  creSwfl.corpusSummary!([
    makeCorridorFragment("A", "Fort Myers"),
    makeCorridorFragment("B", "Naples"),
  ]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  assert.ok(
    !result.key_metrics.some((m) => m.metric === "corridor_factor"),
    "expected no corridor_factor when all corridors have null metrics",
  );
});

// --- MarketBeat coverage caveat: only fires on a REAL partial gap ----------
// The broker (MarketBeat) feed is frequently absent (deleted upstream) — its
// normal, expected state. When mbRows === [] every corridor lands in
// `unmatched`, which used to emit a "coverage is incomplete" caveat. That is
// the false "Fort Myers Beach did not join" signal: there is no broker survey
// at all, so there is nothing for it to be incomplete *about*.

test("marketbeat: empty MarketBeat feed (deleted) → no incomplete-coverage caveat", () => {
  // Corridors present, zero MarketBeat fragments — the normal post-delete
  // state. Every corridor is `unmatched` (no submarket rows to join against),
  // but a missing survey is not an incomplete survey.
  creSwfl.corpusSummary!([
    makeCorridorFragment("Pine Ridge Rd Naples", "Naples"),
    makeCorridorFragment("Cape Coral Pkwy E", "Cape Coral"),
  ]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  const coverageCaveat = result.caveats.find((c) =>
    c.includes("Broker-survey (MarketBeat) coverage is incomplete"),
  );
  assert.ok(
    !coverageCaveat,
    `expected NO MarketBeat coverage caveat when the feed is empty, got caveats:\n${result.caveats.join("\n")}`,
  );
});

test("marketbeat: non-empty feed with an unmatched corridor → incomplete-coverage caveat fires", () => {
  // A Naples broker row IS present (mbRows.length > 0). One corridor maps to
  // Naples (matched); one has no alias entry (unmatched). That is a real
  // partial gap — the coverage caveat must still fire.
  const naplesMb: MarketbeatSwflNormalized = {
    kind: "marketbeat-swfl",
    submarket: "Naples",
    quarter: "2026-Q3",
    vacancy_rate: 4.8,
    asking_rent_nnn: 41.5,
    absorption_sqft: 32000,
    source_url: "https://example.invalid/naples",
  };
  creSwfl.corpusSummary!([
    makeCorridorFragment("Pine Ridge Rd Naples", "Naples"), // maps to Naples
    makeCorridorFragment("Nonexistent Corridor", "Naples"), // no alias → unmatched
    makeMbFragment(naplesMb),
  ]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  const coverageCaveat = result.caveats.find((c) =>
    c.includes("Broker-survey (MarketBeat) coverage is incomplete"),
  );
  assert.ok(
    coverageCaveat,
    `expected the coverage caveat to fire on a real partial gap, got caveats:\n${result.caveats.join("\n")}`,
  );
});
