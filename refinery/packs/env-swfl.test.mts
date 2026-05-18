import { test } from "node:test";
import assert from "node:assert/strict";

process.env["REFINERY_SOURCE"] = "fixture";

const { envSwfl, voteEnvDirection } = await import("./env-swfl.mts");
const { envSwflSource } = await import("../sources/env-swfl-source.mts");
const { femaNfipSource } = await import("../sources/fema-nfip-source.mts");

/**
 * Minimal EnvSnapshot stub for voteEnvDirection unit tests. The function only
 * reads area fields, so a partial object cast through unknown is fine.
 */
function snapshot(opts: {
  totalArea?: number;
  sfhaArea?: number;
  veArea?: number;
}): never {
  return {
    counties: [],
    swfl_total_area_sq_deg: opts.totalArea ?? 0,
    swfl_sfha_area_sq_deg: opts.sfhaArea ?? 0,
    swfl_ve_area_sq_deg: opts.veArea ?? 0,
    swfl_ve_polygon_count: 0,
    earliest_fetched_at: "2026-05-17T00:00:00Z",
    nfip: null,
    nfip_fetched_at: null,
  } as unknown as never;
}

// --------------------------------------------------------------------------
// voteEnvDirection — storm-shadow override fires within 3 years of any storm.
// --------------------------------------------------------------------------

test("voteEnvDirection: storm-shadow fires in 2026 (Ian 2022 within 3yr) — bearish 0.6 floor even with zero SFHA", () => {
  const v = voteEnvDirection(snapshot({}), 2026);
  assert.equal(v.direction, "bearish");
  assert.ok(
    v.magnitude >= 0.6,
    `expected magnitude >= 0.6, got ${v.magnitude}`,
  );
});

test("voteEnvDirection: storm-shadow active in 2025 (Ian+Helene+Milton all recent)", () => {
  const v = voteEnvDirection(snapshot({}), 2025);
  assert.equal(v.direction, "bearish");
  assert.equal(
    v.magnitude,
    0.6,
    "with 0% SFHA, the storm-shadow floor is exactly 0.6",
  );
});

test("voteEnvDirection: storm-shadow expires in 2028 (3yr past Milton 2024 = 2027 last covered)", () => {
  // 2028 - 2024 = 4 > 3, so no storm within window. With 0% SFHA, neutral.
  const v = voteEnvDirection(snapshot({}), 2028);
  assert.equal(v.direction, "neutral");
  assert.equal(v.magnitude, 0.2);
});

test("voteEnvDirection: outside shadow + high SFHA → bearish driven by SFHA tier (0.8)", () => {
  const v = voteEnvDirection(
    snapshot({ totalArea: 100, sfhaArea: 50 }), // 50% SFHA
    2030,
  );
  assert.equal(v.direction, "bearish");
  assert.equal(v.magnitude, 0.8, "SFHA > 0.4 triggers the top tier");
});

test("voteEnvDirection: in-shadow + high SFHA → magnitude is max(0.6, sfha-tier) = 0.8", () => {
  const v = voteEnvDirection(snapshot({ totalArea: 100, sfhaArea: 50 }), 2026);
  assert.equal(v.direction, "bearish");
  assert.equal(
    v.magnitude,
    0.8,
    "storm-shadow uses max(0.6, sfha-tier); 0.8 wins",
  );
});

test("voteEnvDirection: outside shadow + zero SFHA → neutral 0.2 (the unhappy-path default)", () => {
  const v = voteEnvDirection(snapshot({}), 2050);
  assert.equal(v.direction, "neutral");
  assert.equal(v.magnitude, 0.2);
});

// --------------------------------------------------------------------------
// outputProducer — emit 4 NFIP metrics when NFIP fragment is present.
// --------------------------------------------------------------------------

async function runProducer() {
  const envFrags = await envSwflSource.fetch();
  const nfipFrags = await femaNfipSource.fetch();
  envSwfl.corpusSummary!([...envFrags, ...nfipFrags]);
  return envSwfl.outputProducer!({
    pack: envSwfl,
    version: 1,
    refined_at: new Date().toISOString(),
    citations: [],
    facts: [],
    recentNote: "",
  } as unknown as Parameters<NonNullable<typeof envSwfl.outputProducer>>[0]);
}

async function runProducerNoNfip() {
  const envFrags = await envSwflSource.fetch();
  envSwfl.corpusSummary!([...envFrags]);
  return envSwfl.outputProducer!({
    pack: envSwfl,
    version: 1,
    refined_at: new Date().toISOString(),
    citations: [],
    facts: [],
    recentNote: "",
  } as unknown as Parameters<NonNullable<typeof envSwfl.outputProducer>>[0]);
}

test("outputProducer: with NFIP fragments → 4 NFIP metrics surface alongside NFHL metrics", async () => {
  const result = await runProducer();
  const metricNames = result.key_metrics.map((m) => m.metric);
  assert.ok(metricNames.includes("swfl_storm_year_claims_usd"));
  assert.ok(metricNames.includes("swfl_nonstorm_claims_baseline"));
  assert.ok(metricNames.includes("swfl_storm_frequency"));
  assert.ok(metricNames.includes("swfl_flood_recovery_ratio"));
});

test("outputProducer: NFIP storm-year total carries a positive USD value", async () => {
  const result = await runProducer();
  const m = result.key_metrics.find(
    (x) => x.metric === "swfl_storm_year_claims_usd",
  );
  assert.ok(m, "swfl_storm_year_claims_usd should be present");
  assert.ok(
    (m!.value as number) > 1_000_000,
    `expected > $1M (got ${m!.value})`,
  );
});

test("outputProducer: NFIP storm-frequency = 5 (matches deduped years >= 2000 in hardcoded list)", async () => {
  const result = await runProducer();
  const m = result.key_metrics.find((x) => x.metric === "swfl_storm_frequency");
  assert.equal(m!.value, 5);
});

test("outputProducer: conclusion includes the realized-loss sentence when NFIP present", async () => {
  const result = await runProducer();
  assert.match(
    result.conclusion,
    /Realized loss/,
    "conclusion must surface the realized-loss bridge sentence when NFIP fragments arrived",
  );
  assert.match(
    result.conclusion,
    /baseline/i,
    "conclusion must mention the baseline so the storm-vs-baseline framing is legible",
  );
});

test("outputProducer: NFIP caveats present when NFIP fragments arrived", async () => {
  const result = await runProducer();
  const joined = result.caveats.join("\n");
  assert.match(
    joined,
    /policyholder-only/,
    "NFIP caveat about uninsured-loss undercount must appear",
  );
  assert.match(
    joined,
    /Storm-year list .* last reviewed/i,
    "Storm-list LAST_REVIEWED caveat must appear so the freshness obligation is visible",
  );
});

// --------------------------------------------------------------------------
// Regression — NFHL metrics still emitted when ONLY env-swfl-source ran.
// --------------------------------------------------------------------------

test("outputProducer regression: NFHL-only path still emits the 3 SWFL-wide metrics", async () => {
  const result = await runProducerNoNfip();
  const metricNames = result.key_metrics.map((m) => m.metric);
  assert.ok(metricNames.includes("swfl_sfha_pct_area_weighted"));
  assert.ok(metricNames.includes("swfl_ve_zone_pct_area_weighted"));
  assert.ok(metricNames.includes("swfl_ve_zone_polygon_count"));
});

test("outputProducer regression: NFHL-only path emits Lee County metrics (fixture only populates Lee)", async () => {
  const result = await runProducerNoNfip();
  const metricNames = result.key_metrics.map((m) => m.metric);
  assert.ok(metricNames.includes("lee_county_sfha_pct_area_weighted"));
  assert.ok(metricNames.includes("lee_county_ve_zone_pct_area_weighted"));
});

test("outputProducer regression: NFHL-only path does NOT emit NFIP metrics", async () => {
  const result = await runProducerNoNfip();
  const metricNames = result.key_metrics.map((m) => m.metric);
  assert.ok(!metricNames.includes("swfl_storm_year_claims_usd"));
  assert.ok(!metricNames.includes("swfl_nonstorm_claims_baseline"));
  assert.ok(!metricNames.includes("swfl_storm_frequency"));
  assert.ok(!metricNames.includes("swfl_flood_recovery_ratio"));
});

test("outputProducer regression: NFHL-only path conclusion does NOT include the realized-loss sentence", async () => {
  const result = await runProducerNoNfip();
  assert.doesNotMatch(
    result.conclusion,
    /Realized loss/,
    "the bridge sentence must only appear when NFIP fragments are present",
  );
});

// --------------------------------------------------------------------------
// Pack-level metadata invariants.
// --------------------------------------------------------------------------

test("envSwfl pack: 2 sources wired (env-swfl-source + fema-nfip-source)", () => {
  assert.equal(envSwfl.sources.length, 2);
  const ids = envSwfl.sources.map((s) => s.source_id);
  assert.ok(ids.includes("fema_nfhl"));
  assert.ok(ids.includes("fema_nfip_claims"));
});

test("envSwfl pack: stays a leaf brain (input_brains: [])", () => {
  assert.deepEqual(envSwfl.input_brains, []);
});

test("envSwfl pack: scope text broadened to mention realized loss", () => {
  assert.match(envSwfl.scope, /realized loss/i);
  assert.match(envSwfl.scope, /NFIP/);
});
