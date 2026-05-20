import { test } from "bun:test";
import assert from "node:assert/strict";

process.env["REFINERY_SOURCE"] = "fixture";

const {
  femaNfipSource,
  SWFL_STORM_YEARS,
  SWFL_STORM_YEARS_LAST_REVIEWED,
  aggregateZipRollupTop6,
  AAL_WINDOW_YEARS,
  INSURED_PENETRATION_FACTOR,
  ZIP_POPULATION_2020,
  SWFL_ZIP_POPULATION_DEFAULT,
} = await import("./fema-nfip-source.mts");

test("fixture mode returns fragments", async () => {
  const fragments = await femaNfipSource.fetch();
  assert.ok(fragments.length > 0, "expected at least one fragment");
});

test("fragments split into county-year aggregates + exactly one swfl-aggregate", async () => {
  const fragments = await femaNfipSource.fetch();
  const countyYears = fragments.filter(
    (f) => (f.normalized as { kind: string }).kind === "nfip-county-year",
  );
  const aggregates = fragments.filter(
    (f) => (f.normalized as { kind: string }).kind === "nfip-swfl-aggregate",
  );
  assert.ok(
    countyYears.length > 0,
    "expected at least one county-year fragment",
  );
  assert.equal(
    aggregates.length,
    1,
    "expected exactly one swfl-aggregate fragment",
  );
});

test("every county-year fragment has the required aggregate fields", async () => {
  const fragments = await femaNfipSource.fetch();
  for (const f of fragments) {
    const n = f.normalized as Record<string, unknown>;
    if (n["kind"] !== "nfip-county-year") continue;
    assert.equal(typeof n["county_code"], "string");
    assert.equal(typeof n["county_name"], "string");
    assert.equal(typeof n["year"], "number");
    assert.equal(typeof n["is_storm_year"], "boolean");
    assert.equal(typeof n["paid_total_usd"], "number");
    assert.equal(typeof n["claim_count"], "number");
    assert.ok((n["paid_total_usd"] as number) > 0);
    assert.ok((n["claim_count"] as number) > 0);
  }
});

test("swfl-aggregate carries all 4 storm-vs-baseline metrics", async () => {
  const fragments = await femaNfipSource.fetch();
  const agg = fragments.find(
    (f) => (f.normalized as { kind: string }).kind === "nfip-swfl-aggregate",
  );
  assert.ok(agg, "expected swfl-aggregate fragment");
  const n = agg!.normalized as Record<string, unknown>;
  assert.equal(typeof n["storm_year_total_usd"], "number");
  assert.equal(typeof n["baseline_annual_usd"], "number");
  assert.equal(typeof n["storm_year_count_since_2000"], "number");
  assert.equal(typeof n["post_ian_ratio"], "number");
  assert.equal(typeof n["latest_complete_year"], "number");
  assert.equal(typeof n["latest_complete_year_total_usd"], "number");
  assert.equal(
    n["storm_year_list_reviewed_at"],
    SWFL_STORM_YEARS_LAST_REVIEWED,
  );
  assert.ok(
    Array.isArray(n["county_codes"]) &&
      (n["county_codes"] as string[]).length === 6,
    "county_codes should be the 6 SWFL FIPS",
  );
});

test("storm-year total includes Ian 2022 — should dominate non-storm baseline", async () => {
  const fragments = await femaNfipSource.fetch();
  const agg = fragments.find(
    (f) => (f.normalized as { kind: string }).kind === "nfip-swfl-aggregate",
  );
  const n = agg!.normalized as Record<string, unknown>;
  // Ian fixture alone contributes ~$2.27M; total across Wilma+Irma+Ian is ~$3.5M.
  // Always at least 30x the non-storm baseline (~$50-90k per year).
  assert.ok(
    (n["storm_year_total_usd"] as number) > 1_000_000,
    `storm_year_total_usd should exceed $1M (got ${n["storm_year_total_usd"]})`,
  );
  assert.ok(
    (n["storm_year_total_usd"] as number) >
      (n["baseline_annual_usd"] as number) * 10,
    "storm-year total should be >10x baseline (Ian's signal must not be averaged away)",
  );
});

test("baseline excludes storm years — never sees Ian/Irma/Wilma magnitudes", async () => {
  const fragments = await femaNfipSource.fetch();
  const agg = fragments.find(
    (f) => (f.normalized as { kind: string }).kind === "nfip-swfl-aggregate",
  );
  const n = agg!.normalized as Record<string, unknown>;
  // Non-storm yearly totals in the fixture: ~$44k-$88k. Baseline median must
  // fall in that range — never near storm-year magnitudes ($455k+).
  assert.ok(
    (n["baseline_annual_usd"] as number) < 200_000,
    `baseline should be < $200k (got ${n["baseline_annual_usd"]}) — would mean a storm year leaked into the non-storm set`,
  );
  assert.ok(
    (n["baseline_annual_usd"] as number) > 10_000,
    `baseline should be > $10k (got ${n["baseline_annual_usd"]}) — would mean too few non-storm years populated in fixture`,
  );
});

test("storm_year_count_since_2000 matches hardcoded SWFL_STORM_YEARS filtered to >= 2000", async () => {
  const fragments = await femaNfipSource.fetch();
  const agg = fragments.find(
    (f) => (f.normalized as { kind: string }).kind === "nfip-swfl-aggregate",
  );
  const n = agg!.normalized as Record<string, unknown>;
  // Deduped set of years where year >= 2000. Charley 2004, Wilma 2005, Irma 2017,
  // Ian 2022, Helene+Milton both 2024 (one year, two storms) = 5 distinct years.
  const expected = new Set(
    SWFL_STORM_YEARS.filter((s) => s.year >= 2000).map((s) => s.year),
  ).size;
  assert.equal(n["storm_year_count_since_2000"], expected);
  assert.equal(expected, 5, "expected 5 distinct SWFL storm years since 2000");
});

test("post_ian_ratio reflects latest_complete_year vs baseline", async () => {
  const fragments = await femaNfipSource.fetch();
  const agg = fragments.find(
    (f) => (f.normalized as { kind: string }).kind === "nfip-swfl-aggregate",
  );
  const n = agg!.normalized as Record<string, unknown>;
  // Fixture's max year is 2025 (non-storm). Ratio should be > 0 and a finite number.
  assert.equal(n["latest_complete_year"], 2025);
  assert.ok(
    (n["latest_complete_year_total_usd"] as number) > 0,
    "latest_complete_year_total_usd must be > 0 when latest year has data",
  );
  assert.ok(
    Number.isFinite(n["post_ian_ratio"] as number),
    "post_ian_ratio must be a finite number",
  );
  // 2025 non-storm total ~$87,800 / baseline median ~$56,150 ≈ 1.56. Loose bound.
  assert.ok(
    (n["post_ian_ratio"] as number) > 0.5 &&
      (n["post_ian_ratio"] as number) < 5,
    `post_ian_ratio should sit between 0.5 and 5 for the fixture (got ${n["post_ian_ratio"]})`,
  );
});

test("storm-year flagging: Ian 2022 fragment must carry is_storm_year=true and storm_name", async () => {
  const fragments = await femaNfipSource.fetch();
  const ianLee = fragments.find((f) => {
    const n = f.normalized as Record<string, unknown>;
    return (
      n["kind"] === "nfip-county-year" &&
      n["year"] === 2022 &&
      n["county_code"] === "12071"
    );
  });
  assert.ok(ianLee, "expected a 2022 Lee County fragment");
  const n = ianLee!.normalized as Record<string, unknown>;
  assert.equal(n["is_storm_year"], true);
  assert.equal(n["storm_name"], "Ian");
});

test("non-storm year fragment carries is_storm_year=false and storm_name=null", async () => {
  const fragments = await femaNfipSource.fetch();
  const nonStorm = fragments.find((f) => {
    const n = f.normalized as Record<string, unknown>;
    return n["kind"] === "nfip-county-year" && n["year"] === 2023;
  });
  assert.ok(nonStorm, "expected a 2023 fragment");
  const n = nonStorm!.normalized as Record<string, unknown>;
  assert.equal(n["is_storm_year"], false);
  assert.equal(n["storm_name"], null);
});

test("fragment_ids are unique", async () => {
  const fragments = await femaNfipSource.fetch();
  const ids = fragments.map((f) => f.fragment_id);
  assert.equal(new Set(ids).size, ids.length);
});

test("citationMeta returns a fema_nfip_claims-cited source with reviewed date", () => {
  const meta = femaNfipSource.citationMeta("2026-05-17", 86400);
  assert.ok(meta.source.includes("fema_nfip_claims"));
  assert.ok(meta.source.includes("FimaNfipClaims"));
  assert.ok(
    meta.source.includes(SWFL_STORM_YEARS_LAST_REVIEWED),
    "citation must surface the storm-list reviewed date",
  );
  assert.equal(typeof meta.verified, "string");
  assert.equal(typeof meta.expires, "string");
});

// Live-path safety: silent zero rows produce a hollow brain. Mirror fdot.
test("assertClaimsNonEmpty throws with actionable message on 0 rows", async () => {
  const { assertClaimsNonEmpty } = await import("./fema-nfip-source.mts");
  assert.throws(
    () => assertClaimsNonEmpty([]),
    (err: Error) => {
      assert.match(err.message, /returned 0 rows/);
      assert.match(err.message, /python -m ingest\.pipelines\.fema\.pipeline/);
      assert.match(err.message, /fema_nfip_claims_grant\.sql/);
      assert.match(err.message, /service_role/);
      return true;
    },
  );
});

test("assertClaimsNonEmpty is a no-op on non-empty input", async () => {
  const { assertClaimsNonEmpty } = await import("./fema-nfip-source.mts");
  const oneRow = [
    {
      id: "x",
      year_of_loss: 2022,
      date_of_loss: "2022-09-28",
      state: "FL",
      county_code: "12071",
      reported_city: "FORT MYERS",
      reported_zipcode: "33901",
      flood_zone: "AE",
      occupancy_type: 1,
      number_of_floors_insured: 1,
      amount_paid_on_building_claim: 100,
      amount_paid_on_contents_claim: 10,
      amount_paid_on_ico_claim: 0,
      building_property_value: 1000,
      building_damage_amount: 110,
    },
  ];
  assert.doesNotThrow(() => assertClaimsNonEmpty(oneRow as never));
});

// ---------------------------------------------------------------------
// NfipZipAggregate — per-ZIP AAL$/yr per insured property, top-6 rollup.
// Group B Step 2 of docs/superpowers/plans/2026-05-19-env-swfl-flood-restructure.md.
// ---------------------------------------------------------------------

test("fetch() emits ≤6 nfip-zip-aggregate fragments alongside county-year + swfl-aggregate", async () => {
  const fragments = await femaNfipSource.fetch();
  const zipAggs = fragments.filter(
    (f) => (f.normalized as { kind: string }).kind === "nfip-zip-aggregate",
  );
  assert.ok(zipAggs.length > 0, "expected at least one nfip-zip-aggregate");
  assert.ok(
    zipAggs.length <= 6,
    `expected at most 6 nfip-zip-aggregate fragments (top-6 cap), got ${zipAggs.length}`,
  );
});

test("nfip-zip-aggregate fragments carry the full v1 AAL schema", async () => {
  const fragments = await femaNfipSource.fetch();
  const zipAggs = fragments.filter(
    (f) => (f.normalized as { kind: string }).kind === "nfip-zip-aggregate",
  );
  for (const f of zipAggs) {
    const n = f.normalized as Record<string, unknown>;
    assert.equal(typeof n["zip"], "string");
    assert.match(n["zip"] as string, /^\d{5}$/);
    assert.equal(typeof n["county_code"], "string");
    assert.equal(typeof n["county_name"], "string");
    assert.equal(typeof n["aal_usd_per_insured_property"], "number");
    assert.equal(typeof n["aal_pct_swfl_rank"], "number");
    assert.equal(typeof n["median_building_property_value_usd"], "number");
    assert.equal(typeof n["claim_count_in_window"], "number");
    assert.equal(typeof n["window_years"], "number");
    assert.equal(typeof n["window_end_year"], "number");
    assert.equal(typeof n["insured_denominator"], "number");
    assert.equal(typeof n["insured_denominator_basis"], "string");
    assert.equal(typeof n["paid_total_in_window_usd"], "number");
    assert.ok(
      (n["aal_pct_swfl_rank"] as number) >= 0 &&
        (n["aal_pct_swfl_rank"] as number) <= 100,
      `percentile rank must be in [0, 100], got ${n["aal_pct_swfl_rank"]}`,
    );
    assert.ok((n["window_years"] as number) === AAL_WINDOW_YEARS);
    assert.ok((n["insured_denominator"] as number) > 0);
    assert.ok((n["claim_count_in_window"] as number) > 0);
  }
});

test("top-ranked ZIP in fixture is 33931 (Fort Myers Beach — Ian-2022 surge core)", async () => {
  const fragments = await femaNfipSource.fetch();
  const zipAggs = fragments
    .filter(
      (f) => (f.normalized as { kind: string }).kind === "nfip-zip-aggregate",
    )
    .map((f) => f.normalized as Record<string, unknown>);
  // The source emits fragments sorted by AAL desc, so the first one is top.
  assert.equal(
    zipAggs[0]["zip"],
    "33931",
    `top-ranked ZIP should be 33931 Fort Myers Beach, got ${zipAggs[0]["zip"]}`,
  );
  assert.equal(zipAggs[0]["aal_pct_swfl_rank"], 100);
});

test("AAL math matches paid_total_in_window / window_years / insured_denominator", async () => {
  const fragments = await femaNfipSource.fetch();
  const zipAggs = fragments
    .filter(
      (f) => (f.normalized as { kind: string }).kind === "nfip-zip-aggregate",
    )
    .map((f) => f.normalized as Record<string, unknown>);
  for (const n of zipAggs) {
    const paid = n["paid_total_in_window_usd"] as number;
    const windowYears = n["window_years"] as number;
    const denom = n["insured_denominator"] as number;
    const expected = paid / windowYears / denom;
    const actual = n["aal_usd_per_insured_property"] as number;
    // Tolerate small rounding (source rounds to 2 decimal places).
    assert.ok(
      Math.abs(actual - expected) < 0.02,
      `AAL ${actual} should equal ${expected} (= ${paid}/${windowYears}/${denom}) for ZIP ${n["zip"]}`,
    );
  }
});

test("percentile rank is monotone decreasing across the top-6 sorted by AAL", async () => {
  const fragments = await femaNfipSource.fetch();
  const zipAggs = fragments
    .filter(
      (f) => (f.normalized as { kind: string }).kind === "nfip-zip-aggregate",
    )
    .map((f) => f.normalized as Record<string, unknown>);
  for (let i = 1; i < zipAggs.length; i++) {
    const prevAal = zipAggs[i - 1]["aal_usd_per_insured_property"] as number;
    const thisAal = zipAggs[i]["aal_usd_per_insured_property"] as number;
    const prevRank = zipAggs[i - 1]["aal_pct_swfl_rank"] as number;
    const thisRank = zipAggs[i]["aal_pct_swfl_rank"] as number;
    assert.ok(
      prevAal >= thisAal,
      `AAL must be sorted desc (pos ${i - 1}=${prevAal}, pos ${i}=${thisAal})`,
    );
    assert.ok(
      prevRank >= thisRank,
      `percentile rank must be monotone decreasing (pos ${i - 1}=${prevRank}, pos ${i}=${thisRank})`,
    );
  }
});

test("window end year = max(year_of_loss) and span = AAL_WINDOW_YEARS across fragments", async () => {
  const fragments = await femaNfipSource.fetch();
  const zipAggs = fragments
    .filter(
      (f) => (f.normalized as { kind: string }).kind === "nfip-zip-aggregate",
    )
    .map((f) => f.normalized as Record<string, unknown>);
  // Fixture's max year_of_loss is 2025.
  for (const n of zipAggs) {
    assert.equal(
      n["window_end_year"],
      2025,
      `window_end_year should match fixture max year`,
    );
    assert.equal(n["window_years"], AAL_WINDOW_YEARS);
  }
});

test("median_building_property_value_usd > 0 for every ZIP fragment", async () => {
  const fragments = await femaNfipSource.fetch();
  const zipAggs = fragments
    .filter(
      (f) => (f.normalized as { kind: string }).kind === "nfip-zip-aggregate",
    )
    .map((f) => f.normalized as Record<string, unknown>);
  for (const n of zipAggs) {
    assert.ok(
      (n["median_building_property_value_usd"] as number) > 0,
      `median building_property_value should be > 0 for ZIP ${n["zip"]}`,
    );
  }
});

test("aggregateZipRollupTop6 callable directly with synthetic ClaimRow[] — unknown ZIPs use SWFL fallback population", () => {
  // Synthetic input: 2 ZIPs, one in coverage table (33931, pop 7000) and one
  // outside it (33555 — picked as a clearly-unmapped 5-digit). Both with one
  // $100k claim row in window. The unknown ZIP must use SWFL_ZIP_POPULATION_DEFAULT
  // and carry "ZIP not in coverage table" in its insured_denominator_basis.
  const rows = [
    {
      id: "synth-known",
      year_of_loss: 2024,
      date_of_loss: "2024-09-26",
      state: "FL",
      county_code: "12071",
      reported_city: "FORT MYERS BEACH",
      reported_zipcode: "33931",
      flood_zone: "VE",
      occupancy_type: 1,
      number_of_floors_insured: 1,
      amount_paid_on_building_claim: 100000,
      amount_paid_on_contents_claim: 0,
      amount_paid_on_ico_claim: 0,
      building_property_value: 400000,
      building_damage_amount: 110000,
    },
    {
      id: "synth-unknown",
      year_of_loss: 2024,
      date_of_loss: "2024-09-26",
      state: "FL",
      county_code: "12071",
      reported_city: "SOMEWHERE",
      reported_zipcode: "33555",
      flood_zone: "AE",
      occupancy_type: 1,
      number_of_floors_insured: 1,
      amount_paid_on_building_claim: 100000,
      amount_paid_on_contents_claim: 0,
      amount_paid_on_ico_claim: 0,
      building_property_value: 300000,
      building_damage_amount: 105000,
    },
  ];
  const out = aggregateZipRollupTop6(rows as never);
  assert.equal(out.length, 2);
  const known = out.find((a) => a.zip === "33931");
  const unknown = out.find((a) => a.zip === "33555");
  assert.ok(known, "known ZIP 33931 should be in output");
  assert.ok(unknown, "unknown ZIP 33555 should be in output (no silent drop)");
  // Known ZIP uses table population.
  const expectedKnownDenom =
    (ZIP_POPULATION_2020.get("33931") ?? 0) * INSURED_PENETRATION_FACTOR;
  assert.ok(
    Math.abs(known!.insured_denominator - expectedKnownDenom) < 0.01,
    `known ZIP denom should be ${expectedKnownDenom}, got ${known!.insured_denominator}`,
  );
  // Unknown ZIP uses fallback.
  const expectedUnknownDenom =
    SWFL_ZIP_POPULATION_DEFAULT * INSURED_PENETRATION_FACTOR;
  assert.ok(
    Math.abs(unknown!.insured_denominator - expectedUnknownDenom) < 0.01,
    `unknown ZIP denom should be ${expectedUnknownDenom}, got ${unknown!.insured_denominator}`,
  );
  assert.match(unknown!.insured_denominator_basis, /not in coverage table/i);
  assert.doesNotMatch(
    known!.insured_denominator_basis,
    /not in coverage table/i,
  );
});

test("aggregateZipRollupTop6 honors topN cap and drops rows outside SWFL FIPS or outside window", () => {
  const rows = [
    // 7 distinct ZIPs in SWFL window — only top 6 should be emitted.
    ...["33931", "33957", "34145", "33921", "34102", "33914", "33901"].map(
      (zip, idx) => ({
        id: `swfl-${zip}`,
        year_of_loss: 2024,
        date_of_loss: "2024-09-26",
        state: "FL",
        county_code: "12071",
        reported_city: "X",
        reported_zipcode: zip,
        flood_zone: "AE",
        occupancy_type: 1,
        number_of_floors_insured: 1,
        // Decreasing paid amounts so the order of the top-6 is deterministic.
        amount_paid_on_building_claim: 500000 - idx * 10000,
        amount_paid_on_contents_claim: 0,
        amount_paid_on_ico_claim: 0,
        building_property_value: 400000,
        building_damage_amount: 100000,
      }),
    ),
    // Out-of-SWFL row (Miami-Dade) — must be dropped.
    {
      id: "out-of-swfl",
      year_of_loss: 2024,
      date_of_loss: "2024-09-26",
      state: "FL",
      county_code: "12086",
      reported_city: "MIAMI",
      reported_zipcode: "33101",
      flood_zone: "AE",
      occupancy_type: 1,
      number_of_floors_insured: 1,
      amount_paid_on_building_claim: 999999,
      amount_paid_on_contents_claim: 0,
      amount_paid_on_ico_claim: 0,
      building_property_value: 500000,
      building_damage_amount: 200000,
    },
    // Outside-window row — must be dropped (year 2000 + window 10y ending 2024 → window is 2015-2024).
    {
      id: "out-of-window",
      year_of_loss: 2000,
      date_of_loss: "2000-09-26",
      state: "FL",
      county_code: "12071",
      reported_city: "X",
      reported_zipcode: "33931",
      flood_zone: "AE",
      occupancy_type: 1,
      number_of_floors_insured: 1,
      amount_paid_on_building_claim: 999999,
      amount_paid_on_contents_claim: 0,
      amount_paid_on_ico_claim: 0,
      building_property_value: 500000,
      building_damage_amount: 200000,
    },
  ];
  const out = aggregateZipRollupTop6(rows as never);
  assert.equal(out.length, 6, "topN=6 cap should hold");
  assert.ok(
    !out.some((a) => a.zip === "33101"),
    "out-of-SWFL ZIP 33101 must be dropped",
  );
  // The 33931 fragment should reflect ONLY the in-window claim (500000), not the
  // 2000-year claim (999999). paid_total_in_window_usd should equal 500000.
  const fmb = out.find((a) => a.zip === "33931");
  assert.ok(fmb, "33931 should be present in top-6");
  assert.equal(
    fmb!.paid_total_in_window_usd,
    500000,
    "out-of-window claim must not contribute to 33931's paid_total",
  );
  // Window end year = 2024 (the max in this synthetic data).
  assert.equal(fmb!.window_end_year, 2024);
});

test("aggregateZipRollupTop6 returns empty when no rows have valid SWFL ZIP + year + county", () => {
  // All malformed: missing ZIP / missing year / non-SWFL county.
  const rows = [
    {
      id: "no-zip",
      year_of_loss: 2024,
      date_of_loss: "2024-09-26",
      state: "FL",
      county_code: "12071",
      reported_city: "X",
      reported_zipcode: null,
      flood_zone: "AE",
      occupancy_type: 1,
      number_of_floors_insured: 1,
      amount_paid_on_building_claim: 100,
      amount_paid_on_contents_claim: 0,
      amount_paid_on_ico_claim: 0,
      building_property_value: 1000,
      building_damage_amount: 110,
    },
  ];
  const out = aggregateZipRollupTop6(rows as never);
  assert.equal(out.length, 0);
});

test("nfip-zip-aggregate fragments have unique, deterministic fragment_ids keyed off the ZIP", async () => {
  const { fragmentId } = await import("../lib/ids.mts");
  const fragments = await femaNfipSource.fetch();
  const zipAggs = fragments.filter(
    (f) => (f.normalized as { kind: string }).kind === "nfip-zip-aggregate",
  );
  const ids = zipAggs.map((f) => f.fragment_id);
  assert.equal(new Set(ids).size, ids.length, "fragment_ids should be unique");
  for (const f of zipAggs) {
    const zip = (f.normalized as { zip: string }).zip;
    // The convention is fragmentId(SOURCE_ID, `zip-${zip}`). Verify by
    // reproducing the expected id from the normalized ZIP — locks the call
    // site to the documented natural-key shape without depending on the
    // sha256 internals.
    const expected = fragmentId("fema_nfip_claims", `zip-${zip}`);
    assert.equal(
      f.fragment_id,
      expected,
      `fragment_id for ZIP ${zip} must be derived from natural key "zip-${zip}"`,
    );
  }
});
