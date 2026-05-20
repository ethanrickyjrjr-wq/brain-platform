// One-shot fixture extension — appends ZIP-stratified rows to
// refinery/__fixtures__/fema-nfip-swfl.sample.json so the env-swfl Mode 1
// anti-regression test can run end-to-end through aggregateZipRollupTop6.
// Run once with `node scripts/extend-nfip-fixture.mjs`; do not re-run blindly
// (would duplicate rows).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const fp = join("refinery", "__fixtures__", "fema-nfip-swfl.sample.json");
const data = JSON.parse(readFileSync(fp, "utf-8"));

const before = data.claims.length;

// ----- 50 catastrophic 33931 Ian-2022 claims -----
// 40 at full-cap-ish: B $260k + C $80k + ICO $20k = $360k paid, BV $400k.
// 10 at major:         B $230k + C $70k + ICO $15k = $315k paid, BV $360k.
// Combined with the existing fixture-ian-001 ($290k paid, BV $625k) this
// pushes 33931's 10-year per-insured-property AAL to ~$850/yr (denom 2100
// = 7000 pop × 0.30 NSI proxy), comfortably above the $800 Mode 1 trigger.
for (let i = 1; i <= 40; i++) {
  data.claims.push({
    id: `fixture-ian-33931-${String(i).padStart(3, "0")}`,
    year_of_loss: 2022,
    date_of_loss: "2022-09-28",
    state: "FL",
    county_code: "12071",
    reported_city: "FORT MYERS BEACH",
    reported_zipcode: "33931",
    flood_zone: "VE",
    occupancy_type: 1,
    number_of_floors_insured: 1,
    amount_paid_on_building_claim: 260000,
    amount_paid_on_contents_claim: 80000,
    amount_paid_on_ico_claim: 20000,
    building_property_value: 400000,
    building_damage_amount: 360000,
  });
}
for (let i = 41; i <= 50; i++) {
  data.claims.push({
    id: `fixture-ian-33931-${String(i).padStart(3, "0")}`,
    year_of_loss: 2022,
    date_of_loss: "2022-09-28",
    state: "FL",
    county_code: "12071",
    reported_city: "FORT MYERS BEACH",
    reported_zipcode: "33931",
    flood_zone: "VE",
    occupancy_type: 1,
    number_of_floors_insured: 1,
    amount_paid_on_building_claim: 230000,
    amount_paid_on_contents_claim: 70000,
    amount_paid_on_ico_claim: 15000,
    building_property_value: 360000,
    building_damage_amount: 315000,
  });
}

// ----- 3 inland 34112 (East Naples) baseline-noise claims -----
// Small seasonal flooding / plumbing-driven claims. AAL << $800 by design —
// proves the rollup correctly bins inland claims separately from coastal
// ones; the ZIPs still won't surface in the top-6 emission because the
// barrier-island catastrophes dominate the ranking.
const inland = [
  {
    id: "fixture-inland-34112-001",
    year: 2019,
    date: "2019-08-12",
    B: 8000,
    C: 1500,
    BV: 280000,
    DMG: 9500,
  },
  {
    id: "fixture-inland-34112-002",
    year: 2023,
    date: "2023-07-25",
    B: 6500,
    C: 1000,
    BV: 290000,
    DMG: 7500,
  },
  {
    id: "fixture-inland-34112-003",
    year: 2025,
    date: "2025-06-30",
    B: 4000,
    C: 700,
    BV: 300000,
    DMG: 4700,
  },
];
for (const r of inland) {
  data.claims.push({
    id: r.id,
    year_of_loss: r.year,
    date_of_loss: r.date,
    state: "FL",
    county_code: "12021",
    reported_city: "NAPLES",
    reported_zipcode: "34112",
    flood_zone: "X",
    occupancy_type: 1,
    number_of_floors_insured: 1,
    amount_paid_on_building_claim: r.B,
    amount_paid_on_contents_claim: r.C,
    amount_paid_on_ico_claim: 0,
    building_property_value: r.BV,
    building_damage_amount: r.DMG,
  });
}

// ----- 4 Helene + Milton 2024 storm-year rows -----
// Fills out SWFL_STORM_YEARS coverage so post_ian_ratio and the storm-vs-
// baseline rollup see 2024 as a meaningful storm year (not just 2022 Ian).
data.claims.push({
  id: "fixture-helene-001",
  year_of_loss: 2024,
  date_of_loss: "2024-09-26",
  state: "FL",
  county_code: "12015",
  reported_city: "PUNTA GORDA",
  reported_zipcode: "33950",
  flood_zone: "AE",
  occupancy_type: 1,
  number_of_floors_insured: 1,
  amount_paid_on_building_claim: 70000,
  amount_paid_on_contents_claim: 10000,
  amount_paid_on_ico_claim: 0,
  building_property_value: 350000,
  building_damage_amount: 82000,
});
data.claims.push({
  id: "fixture-helene-002",
  year_of_loss: 2024,
  date_of_loss: "2024-09-26",
  state: "FL",
  county_code: "12015",
  reported_city: "PORT CHARLOTTE",
  reported_zipcode: "33952",
  flood_zone: "AE",
  occupancy_type: 1,
  number_of_floors_insured: 1,
  amount_paid_on_building_claim: 52000,
  amount_paid_on_contents_claim: 8000,
  amount_paid_on_ico_claim: 0,
  building_property_value: 300000,
  building_damage_amount: 62000,
});
data.claims.push({
  id: "fixture-milton-001",
  year_of_loss: 2024,
  date_of_loss: "2024-10-09",
  state: "FL",
  county_code: "12071",
  reported_city: "CAPE CORAL",
  reported_zipcode: "33914",
  flood_zone: "AE",
  occupancy_type: 1,
  number_of_floors_insured: 1,
  amount_paid_on_building_claim: 78000,
  amount_paid_on_contents_claim: 12000,
  amount_paid_on_ico_claim: 0,
  building_property_value: 420000,
  building_damage_amount: 92000,
});
data.claims.push({
  id: "fixture-milton-002",
  year_of_loss: 2024,
  date_of_loss: "2024-10-09",
  state: "FL",
  county_code: "12021",
  reported_city: "NAPLES",
  reported_zipcode: "34102",
  flood_zone: "AE",
  occupancy_type: 1,
  number_of_floors_insured: 1,
  amount_paid_on_building_claim: 60000,
  amount_paid_on_contents_claim: 10000,
  amount_paid_on_ico_claim: 0,
  building_property_value: 450000,
  building_damage_amount: 72000,
});

// Update the top-level comment to reflect the new shape and total row count.
data._comment =
  "OpenFEMA FimaNfipClaims SWFL fixture, normalized to Tier 2 columns (data_lake.fema_nfip_claims). " +
  `${data.claims.length} hand-picked rows spanning storm + non-storm years for env-swfl ` +
  "storm-vs-baseline aggregation + per-ZIP rollup. Storm years populated: Wilma 2005 (3 rows), " +
  "Irma 2017 (5 rows), Ian 2022 (10 mixed-ZIP rows + 50 catastrophic 33931 Fort Myers Beach rows added " +
  "2026-05-19 to push 33931 AAL > $800/yr Mode 1 barrier-veto trigger), Helene+Milton 2024 (4 rows). " +
  "Non-storm years populated (for baseline-median): 2008, 2011, 2014, 2019 (3 rows incl. 34112 inland), " +
  "2023 (3 rows incl. 34112 inland), 2025 (3 rows incl. 34112 inland). " +
  "Inland 34112 East Naples rows added 2026-05-19 for ZIP-stratified coverage. " +
  "Counties covered: Lee (12071), Collier (12021), Charlotte (12015) — the storm-impact core. " +
  "Switch to REFINERY_SOURCE=live for the full ~200k-500k row Tier 2 archive across all 6 SWFL counties.";

writeFileSync(fp, JSON.stringify(data, null, 2) + "\n");
console.log(`Before: ${before} rows. After: ${data.claims.length} rows.`);
