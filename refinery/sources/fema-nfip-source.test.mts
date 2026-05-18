import { test } from "node:test";
import assert from "node:assert/strict";

process.env["REFINERY_SOURCE"] = "fixture";

const { femaNfipSource, SWFL_STORM_YEARS, SWFL_STORM_YEARS_LAST_REVIEWED } =
  await import("./fema-nfip-source.mts");

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
