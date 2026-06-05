import { test } from "bun:test";
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
  assert.ok(metricNames.includes("swfl_post_ian_claims_ratio"));
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

test("outputProducer: conclusion uses Mode 1 template on fixture (50-claim Ian-2022 33931 pushes AAL > $800)", async () => {
  // Post-Step-4: the extended fixture carries 51 Ian-2022 claims for 33931
  // (Fort Myers Beach), pushing per-insured-property AAL above the $800 Mode 1
  // trigger. The producer now drops into the barrier-veto template — same
  // surface the live OpenFEMA archive will produce once these PRs ship to main.
  // The realized-loss aggregate numbers (storm_year_total_usd, baseline, post_
  // ian_ratio) are still surfaced as KEY METRICS, not prose.
  const result = await runProducer();
  assert.match(
    result.conclusion,
    /\+50-70 bps/,
    "Mode 1 cap-rate language must appear when the fixture's 33931 AAL clears $800",
  );
  assert.match(
    result.conclusion,
    /Barrier-island|barrier island/i,
    "Mode 1 must surface barrier-island framing",
  );
  assert.match(
    result.conclusion,
    /33931/,
    "Mode 1 must name the top barrier ZIP (33931 Fort Myers Beach)",
  );
  assert.doesNotMatch(
    result.conclusion,
    /\+20-35 bps/,
    "Mode 2 coastal-mainland language must not appear when Mode 1 fires",
  );
});

// --------------------------------------------------------------------------
// Anti-regression — plan §G.4 #1: end-to-end Mode 1 via real fixture data.
// 51 Ian-2022 claims in 33931 (1 original + 50 catastrophic added in Step 4)
// drive the per-insured-property AAL above the $800 threshold through
// aggregateZipRollupTop6's full math path, not synthetic input.
// --------------------------------------------------------------------------

test("anti-regression §G.4 #1: 33931 fixture-driven Mode 1 — AAL>$800, barrier 1.0, cap-rate 60 bps, ins-pct>5%", async () => {
  const result = await runProducer();
  const findVal = (slug: string) =>
    result.key_metrics.find((m) => m.metric === slug)?.value as
      | number
      | undefined;

  const aal = findVal("swfl_zip_33931_flood_aal_usd_per_insured_property");
  assert.ok(aal !== undefined, "33931 AAL metric must be present");
  assert.ok(
    aal! > 800,
    `33931 AAL must clear the $800 Mode 1 threshold via real fixture math (got ${aal})`,
  );

  const barrier = findVal("swfl_zip_33931_barrier_island_score");
  assert.equal(
    barrier,
    1.0,
    "33931 must classify as barrier (score 1.0) via swfl-geo lookup",
  );

  const bps = findVal("swfl_zip_33931_flood_cap_rate_adj_bps");
  assert.equal(
    bps,
    60,
    "33931's barrier 1.0 score must map to 60 bps cap-rate midpoint",
  );

  const ins = findVal("swfl_zip_33931_insurance_pct_typical_noi");
  assert.ok(
    ins !== undefined,
    "33931 insurance_pct_typical_noi must be present",
  );
  assert.ok(
    ins! > 0.05,
    `33931 imputed flood insurance must run > 5% of NOI at 8% cap (got ${ins})`,
  );
});

test("anti-regression: 33931 is top-ranked ZIP in fixture (100th percentile)", async () => {
  const result = await runProducer();
  const rank = result.key_metrics.find(
    (m) => m.metric === "swfl_zip_33931_flood_aal_pct_swfl_rank",
  );
  assert.ok(rank, "33931 percentile-rank metric must be present");
  assert.equal(
    rank!.value,
    100,
    "33931 must rank 100th percentile (highest AAL) given the catastrophic Ian-2022 row count",
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

test("envSwfl pack: 4 sources wired (env-swfl-source + fema-nfip-source + usgs-water-source + noaa-ghcn-rainfall-source)", () => {
  assert.equal(envSwfl.sources.length, 4);
  const ids = envSwfl.sources.map((s) => s.source_id);
  assert.ok(ids.includes("fema_nfhl"));
  assert.ok(ids.includes("fema_nfip_claims"));
  assert.ok(ids.includes("usgs_water"));
  assert.ok(ids.includes("noaa_ghcn_rainfall"));
});

test("envSwfl pack: stays a leaf brain (input_brains: [])", () => {
  assert.deepEqual(envSwfl.input_brains, []);
});

test("envSwfl pack: scope text broadened to mention realized loss", () => {
  assert.match(envSwfl.scope, /realized loss/i);
  assert.match(envSwfl.scope, /NFIP/);
});

// --------------------------------------------------------------------------
// Per-ZIP flood logic — Group B Step 3 of the env-swfl restructure.
// docs/superpowers/plans/2026-05-19-env-swfl-flood-restructure.md §A.
//
// The producer now emits 5 metrics per top SWFL ZIP and a mode-branched
// conclusion. Mode selection joins NfipZipAggregate fragments against the
// barrier-island classification from refinery/lib/swfl-geo.mts:
//   Mode 1 (barrier-veto): any barrier ZIP with AAL >= $800.
//   Mode 2 (coastal-mainland): no Mode-1 trigger, ≥1 ZIP with barrier_score ≥ 0.5.
//   Mode 3 (inland-only): all snapshot ZIPs at barrier_score 0.0.
// --------------------------------------------------------------------------

const FAKE_FETCHED_AT = "2026-05-19T00:00:00Z";

interface SyntheticZipOpts {
  zip: string;
  aal: number;
  median_bv: number;
  pct_rank?: number;
  county_code?: string;
  county_name?: string;
}

function makeZipFragment(opts: SyntheticZipOpts): never {
  const denom = 2100; // arbitrary — only paid_total uses it for consistency
  return {
    fragment_id: `frag_synth_zip_${opts.zip}`,
    source_id: "fema_nfip_claims",
    source_trust_tier: 1,
    fetched_at: FAKE_FETCHED_AT,
    raw: { zip: opts.zip, county_code: opts.county_code ?? "12071" },
    normalized: {
      kind: "nfip-zip-aggregate",
      zip: opts.zip,
      county_code: opts.county_code ?? "12071",
      county_name: opts.county_name ?? "Lee",
      aal_usd_per_insured_property: opts.aal,
      aal_pct_swfl_rank: opts.pct_rank ?? 100,
      median_building_property_value_usd: opts.median_bv,
      claim_count_in_window: 5,
      window_years: 10,
      window_end_year: 2025,
      insured_denominator: denom,
      insured_denominator_basis: "synthetic test fixture",
      paid_total_in_window_usd: opts.aal * 10 * denom,
    },
  } as unknown as never;
}

async function runProducerWithSyntheticZips(
  zipOpts: SyntheticZipOpts[],
): Promise<ReturnType<NonNullable<typeof envSwfl.outputProducer>>> {
  const envFrags = await envSwflSource.fetch();
  const zipFrags = zipOpts.map(makeZipFragment);
  envSwfl.corpusSummary!([...envFrags, ...(zipFrags as never[])]);
  return envSwfl.outputProducer!({
    pack: envSwfl,
    version: 1,
    refined_at: new Date().toISOString(),
    citations: [],
    facts: [],
    recentNote: "",
  } as unknown as Parameters<NonNullable<typeof envSwfl.outputProducer>>[0]);
}

test("outputProducer per-ZIP: emits 5 metrics per top ZIP (AAL, rank, barrier, cap-rate bps, ins-pct-NOI)", async () => {
  const result = await runProducerWithSyntheticZips([
    { zip: "33931", aal: 1200, median_bv: 600000, pct_rank: 100 },
    { zip: "33914", aal: 200, median_bv: 400000, pct_rank: 50 },
  ]);
  const names = result.key_metrics.map((m) => m.metric);
  for (const zip of ["33931", "33914"]) {
    assert.ok(
      names.includes(`swfl_zip_${zip}_flood_aal_usd_per_insured_property`),
      `missing AAL metric for ${zip}`,
    );
    assert.ok(
      names.includes(`swfl_zip_${zip}_flood_aal_pct_swfl_rank`),
      `missing rank metric for ${zip}`,
    );
    assert.ok(
      names.includes(`swfl_zip_${zip}_barrier_island_score`),
      `missing barrier-score metric for ${zip}`,
    );
    assert.ok(
      names.includes(`swfl_zip_${zip}_flood_cap_rate_adj_bps`),
      `missing cap-rate bps metric for ${zip}`,
    );
    assert.ok(
      names.includes(`swfl_zip_${zip}_insurance_pct_typical_noi`),
      `missing insurance-pct-NOI metric for ${zip}`,
    );
  }
});

test("outputProducer per-ZIP: barrier_island_score matches swfl-geo lookup", async () => {
  const result = await runProducerWithSyntheticZips([
    { zip: "33931", aal: 1200, median_bv: 600000 }, // barrier 1.0
    {
      zip: "33914",
      aal: 200,
      median_bv: 400000,
      pct_rank: 50,
    }, // coastal-mainland 0.5
    {
      zip: "34112",
      aal: 30,
      median_bv: 250000,
      pct_rank: 10,
      county_code: "12021",
      county_name: "Collier",
    }, // inland 0.0
  ]);
  const findVal = (slug: string) =>
    result.key_metrics.find((m) => m.metric === slug)?.value;
  assert.equal(findVal("swfl_zip_33931_barrier_island_score"), 1.0);
  assert.equal(findVal("swfl_zip_33914_barrier_island_score"), 0.5);
  assert.equal(findVal("swfl_zip_34112_barrier_island_score"), 0.0);
});

test("outputProducer per-ZIP: cap_rate_adj_bps equals capRateBpsFor(barrier_score)", async () => {
  const result = await runProducerWithSyntheticZips([
    { zip: "33931", aal: 1200, median_bv: 600000 },
    { zip: "33914", aal: 200, median_bv: 400000, pct_rank: 50 },
    {
      zip: "34112",
      aal: 30,
      median_bv: 250000,
      pct_rank: 10,
      county_code: "12021",
      county_name: "Collier",
    },
  ]);
  const findVal = (slug: string) =>
    result.key_metrics.find((m) => m.metric === slug)?.value;
  assert.equal(findVal("swfl_zip_33931_flood_cap_rate_adj_bps"), 60);
  assert.equal(findVal("swfl_zip_33914_flood_cap_rate_adj_bps"), 27.5);
  assert.equal(findVal("swfl_zip_34112_flood_cap_rate_adj_bps"), 0);
});

test("outputProducer per-ZIP: insurance_pct_typical_noi = (AAL × 2) / (median_bv × 0.08)", async () => {
  // For 33931 with AAL=1200, median_bv=600000:
  //   (1200 × 2) / (600000 × 0.08) = 2400 / 48000 = 0.05
  const result = await runProducerWithSyntheticZips([
    { zip: "33931", aal: 1200, median_bv: 600000 },
  ]);
  const ins = result.key_metrics.find(
    (m) => m.metric === "swfl_zip_33931_insurance_pct_typical_noi",
  );
  assert.ok(ins, "insurance_pct_typical_noi metric must exist for 33931");
  assert.ok(
    Math.abs((ins!.value as number) - 0.05) < 0.001,
    `expected 0.05, got ${ins!.value}`,
  );
});

test("outputProducer per-ZIP: insurance_pct_typical_noi degrades gracefully when median_bv = 0", async () => {
  // Defensive — median_bv could be 0 for a ZIP with no building_property_value rows.
  // The metric must NOT emit NaN/Infinity. Either omit the metric or emit 0.
  const result = await runProducerWithSyntheticZips([
    { zip: "33931", aal: 1200, median_bv: 0 },
  ]);
  const ins = result.key_metrics.find(
    (m) => m.metric === "swfl_zip_33931_insurance_pct_typical_noi",
  );
  if (ins) {
    assert.ok(
      Number.isFinite(ins.value as number),
      `insurance_pct_typical_noi must be finite, got ${ins.value}`,
    );
  }
});

test("outputProducer Mode 1 (barrier + AAL ≥ $800): conclusion uses '+50-70 bps' + barrier framing", async () => {
  const result = await runProducerWithSyntheticZips([
    { zip: "33931", aal: 1200, median_bv: 600000 },
    { zip: "33914", aal: 200, median_bv: 400000, pct_rank: 50 },
  ]);
  assert.match(
    result.conclusion,
    /\+50-70 bps/,
    "Mode 1 conclusion must surface the barrier-island cap-rate range literal",
  );
  assert.match(
    result.conclusion,
    /Barrier-island|barrier island/i,
    "Mode 1 conclusion must name the barrier-island framing",
  );
  assert.match(
    result.conclusion,
    /33931/,
    "Mode 1 conclusion must name the top barrier ZIP",
  );
});

test("outputProducer Mode 2 (no Mode-1 barrier, coastal-mainland present): conclusion uses '+20-35 bps'", async () => {
  const result = await runProducerWithSyntheticZips([
    {
      zip: "33914",
      aal: 300,
      median_bv: 400000,
    }, // coastal-mainland only
  ]);
  assert.match(
    result.conclusion,
    /\+20-35 bps/,
    "Mode 2 conclusion must surface the coastal-mainland cap-rate range literal",
  );
  assert.doesNotMatch(
    result.conclusion,
    /\+50-70 bps/,
    "Mode 2 must not use the barrier-island cap-rate language",
  );
});

test("outputProducer Mode 3 (inland-only): conclusion uses 'no flood cap-rate adjustment'", async () => {
  const result = await runProducerWithSyntheticZips([
    {
      zip: "34112",
      aal: 50,
      median_bv: 250000,
      county_code: "12021",
      county_name: "Collier",
    },
  ]);
  assert.match(
    result.conclusion,
    /no flood cap-rate adjustment/i,
    "Mode 3 conclusion must surface the no-adjustment framing",
  );
  assert.doesNotMatch(result.conclusion, /\+50-70 bps/);
  assert.doesNotMatch(result.conclusion, /\+20-35 bps/);
});

test("outputProducer Mode 1: barrier ZIP below $800 threshold falls to Mode 2 (coastal-mainland)", async () => {
  // 33931 is barrier (1.0) but AAL only $500 — below the $800 trigger.
  // The conclusion should fall to Mode 2, not Mode 1.
  const result = await runProducerWithSyntheticZips([
    { zip: "33931", aal: 500, median_bv: 600000 },
  ]);
  assert.doesNotMatch(
    result.conclusion,
    /\+50-70 bps/,
    "barrier-but-sub-threshold ZIP must not fire Mode 1",
  );
  // Falls to Mode 2 (barrier_score 1.0 still satisfies >= 0.5).
  assert.match(result.conclusion, /\+20-35 bps/);
});

test("outputProducer: SWFL anchor metrics (sfha_pct, ve_zone_pct) still emit when ZIP aggregates present (demoted, not removed)", async () => {
  const result = await runProducerWithSyntheticZips([
    { zip: "33931", aal: 1200, median_bv: 600000 },
  ]);
  const names = result.key_metrics.map((m) => m.metric);
  assert.ok(
    names.includes("swfl_sfha_pct_area_weighted"),
    "SWFL SFHA anchor metric must still emit",
  );
  assert.ok(
    names.includes("swfl_ve_zone_pct_area_weighted"),
    "SWFL VE anchor metric must still emit",
  );
});

// --------------------------------------------------------------------------
// voteEnvDirection with the new per-ZIP mode signal.
// Tests pin currentYear=2030 so the storm-shadow override doesn't dominate.
// --------------------------------------------------------------------------

/** Snapshot stub extended with the new zipAggregates field. */
function snapshotWithZips(zipOpts: SyntheticZipOpts[]): never {
  const zipAggregates = zipOpts.map((o) => ({
    kind: "nfip-zip-aggregate",
    zip: o.zip,
    county_code: o.county_code ?? "12071",
    county_name: o.county_name ?? "Lee",
    aal_usd_per_insured_property: o.aal,
    aal_pct_swfl_rank: o.pct_rank ?? 100,
    median_building_property_value_usd: o.median_bv,
    claim_count_in_window: 5,
    window_years: 10,
    window_end_year: 2025,
    insured_denominator: 2100,
    insured_denominator_basis: "synthetic",
    paid_total_in_window_usd: o.aal * 10 * 2100,
  }));
  return {
    counties: [],
    swfl_total_area_sq_deg: 0,
    swfl_sfha_area_sq_deg: 0,
    swfl_ve_area_sq_deg: 0,
    swfl_ve_polygon_count: 0,
    earliest_fetched_at: "2026-05-17T00:00:00Z",
    nfip: null,
    nfip_fetched_at: null,
    hydro: null,
    hydro_fetched_at: null,
    zipAggregates,
  } as unknown as never;
}

test("voteEnvDirection Mode 1 (barrier + AAL ≥ $800): bearish 0.8 outside storm shadow", () => {
  const v = voteEnvDirection(
    snapshotWithZips([{ zip: "33931", aal: 1200, median_bv: 600000 }]),
    2030,
  );
  assert.equal(v.direction, "bearish");
  assert.equal(
    v.magnitude,
    0.8,
    "Mode 1 should produce the top-tier bearish magnitude",
  );
});

test("voteEnvDirection Mode 2 (coastal-mainland only): bearish ~0.4 outside storm shadow", () => {
  const v = voteEnvDirection(
    snapshotWithZips([{ zip: "33914", aal: 300, median_bv: 400000 }]),
    2030,
  );
  assert.equal(v.direction, "bearish");
  assert.equal(
    v.magnitude,
    0.4,
    "Mode 2 should produce the mid bearish magnitude",
  );
});

test("voteEnvDirection Mode 3 (inland only): neutral 0.2 outside storm shadow", () => {
  const v = voteEnvDirection(
    snapshotWithZips([
      {
        zip: "34112",
        aal: 50,
        median_bv: 250000,
        county_code: "12021",
        county_name: "Collier",
      },
    ]),
    2030,
  );
  assert.equal(v.direction, "neutral");
  assert.equal(v.magnitude, 0.2);
});

test("voteEnvDirection: storm-shadow still overrides Mode 3 in 2026 — bearish floor 0.6", () => {
  const v = voteEnvDirection(
    snapshotWithZips([
      {
        zip: "34112",
        aal: 50,
        median_bv: 250000,
        county_code: "12021",
        county_name: "Collier",
      },
    ]),
    2026,
  );
  assert.equal(v.direction, "bearish");
  assert.ok(
    v.magnitude >= 0.6,
    `storm-shadow floor of 0.6 must hold over Mode 3's 0.2 (got ${v.magnitude})`,
  );
});

test("voteEnvDirection: empty zipAggregates falls back to SFHA/VE area logic (no regression for NFHL-only path)", () => {
  // No zip aggregates AND high SFHA area → falls back to legacy tier and emits 0.8.
  const v = voteEnvDirection(
    snapshotWithZips([]) /* zipAggregates = [] */,
    2030,
  );
  assert.equal(
    v.direction,
    "neutral",
    "with empty zips AND zero SFHA, direction is neutral (the unhappy-path default)",
  );
  assert.equal(v.magnitude, 0.2);
});
