import { test } from "bun:test";
import assert from "node:assert/strict";

// Fixture mode must be set before the source module loads so env.source
// resolves to "fixture" at import time.
process.env["REFINERY_SOURCE"] = "fixture";

const { marketbeatSwflSource, selectLatestVerifiedPerSubmarket } =
  await import("./marketbeat-swfl-source.mts");

// --- pure helper: selectLatestVerifiedPerSubmarket ---------------------

test("selectLatestVerifiedPerSubmarket: empty input returns empty output", () => {
  assert.deepEqual(selectLatestVerifiedPerSubmarket([]), []);
});

test("selectLatestVerifiedPerSubmarket: all-unverified cw_marketbeat rows return empty output", () => {
  const rows = [
    {
      source_name: "cw_marketbeat",
      submarket: "Naples",
      quarter: "2026-Q3",
      vacancy_rate: 5,
      asking_rent_nnn: 40,
      absorption_sqft: 100,
      source_url: null,
      verified: false,
    },
    {
      source_name: "cw_marketbeat",
      submarket: "Fort Myers",
      quarter: "2026-Q3",
      vacancy_rate: 6,
      asking_rent_nnn: 25,
      absorption_sqft: 200,
      source_url: null,
      verified: false,
    },
  ];
  assert.deepEqual(selectLatestVerifiedPerSubmarket(rows), []);
});

test("selectLatestVerifiedPerSubmarket: single verified cw_marketbeat quarter survives", () => {
  const rows = [
    {
      source_name: "cw_marketbeat",
      submarket: "Naples",
      quarter: "2026-Q3",
      vacancy_rate: 5,
      asking_rent_nnn: 40,
      absorption_sqft: 100,
      source_url: "https://example.com",
      verified: true,
    },
  ];
  const out = selectLatestVerifiedPerSubmarket(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].submarket, "Naples");
  assert.equal(out[0].quarter, "2026-Q3");
});

test("selectLatestVerifiedPerSubmarket: multi-quarter, latest verified wins", () => {
  const rows = [
    {
      source_name: "cw_marketbeat",
      submarket: "Naples",
      quarter: "2026-Q1",
      vacancy_rate: 5.5,
      asking_rent_nnn: 38,
      absorption_sqft: 25000,
      source_url: "https://example.com/q1",
      verified: true,
    },
    {
      source_name: "cw_marketbeat",
      submarket: "Naples",
      quarter: "2026-Q3",
      vacancy_rate: 4.8,
      asking_rent_nnn: 41.5,
      absorption_sqft: 32000,
      source_url: "https://example.com/q3",
      verified: true,
    },
  ];
  const out = selectLatestVerifiedPerSubmarket(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].quarter, "2026-Q3");
  assert.equal(out[0].vacancy_rate, 4.8);
  assert.equal(out[0].asking_rent_nnn, 41.5);
});

test("selectLatestVerifiedPerSubmarket: unverified latest does NOT outrank verified earlier", () => {
  // Cape Coral Q1 verified + Q2 unverified → Q1 wins, because unverified rows
  // are filtered out BEFORE the latest-quarter pick.
  const rows = [
    {
      source_name: "cw_marketbeat",
      submarket: "Cape Coral",
      quarter: "2026-Q1",
      vacancy_rate: 7.0,
      asking_rent_nnn: 22.5,
      absorption_sqft: 8000,
      source_url: "https://example.com/cc-q1",
      verified: true,
    },
    {
      source_name: "cw_marketbeat",
      submarket: "Cape Coral",
      quarter: "2026-Q2",
      vacancy_rate: 6.8,
      asking_rent_nnn: 23.0,
      absorption_sqft: 9000,
      source_url: "https://example.com/cc-q2",
      verified: false,
    },
  ];
  const out = selectLatestVerifiedPerSubmarket(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].quarter, "2026-Q1");
});

test("selectLatestVerifiedPerSubmarket: stable submarket alpha order in output", () => {
  const rows = [
    {
      source_name: "cw_marketbeat",
      submarket: "Naples",
      quarter: "2026-Q3",
      vacancy_rate: 5,
      asking_rent_nnn: 40,
      absorption_sqft: 100,
      source_url: null,
      verified: true,
    },
    {
      source_name: "cw_marketbeat",
      submarket: "Bonita Springs",
      quarter: "2026-Q3",
      vacancy_rate: 6,
      asking_rent_nnn: 32,
      absorption_sqft: 50,
      source_url: null,
      verified: true,
    },
    {
      source_name: "cw_marketbeat",
      submarket: "Fort Myers",
      quarter: "2026-Q3",
      vacancy_rate: 8,
      asking_rent_nnn: 26,
      absorption_sqft: -5,
      source_url: null,
      verified: true,
    },
  ];
  const out = selectLatestVerifiedPerSubmarket(rows);
  assert.deepEqual(
    out.map((r) => r.submarket),
    ["Bonita Springs", "Fort Myers", "Naples"],
  );
});

test("selectLatestVerifiedPerSubmarket: mhs_databook wins same-quarter collision over cw_marketbeat", () => {
  // Collision-winner rule (20260605 migration): on identical (sector, submarket,
  // quarter), mhs_databook replaces cw_marketbeat.
  const rows = [
    {
      source_name: "cw_marketbeat",
      sector: "retail",
      submarket: "Bonita Springs",
      quarter: "2026-Q1",
      vacancy_rate: 5.8,
      asking_rent_nnn: 32.5,
      absorption_sqft: 9000,
      source_url: "https://example.com/cw",
      verified: true,
    },
    {
      source_name: "mhs_databook",
      sector: "retail",
      submarket: "Bonita Springs",
      quarter: "2026-Q1",
      vacancy_rate: 6.2,
      asking_rent_nnn: 34.0,
      absorption_sqft: 11000,
      source_url: "https://example.com/mhs",
      verified: false,
      verified_vacancy: true,
      verified_rents: true,
      verified_absorption: false,
    },
  ];
  const out = selectLatestVerifiedPerSubmarket(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].source_name, "mhs_databook");
  assert.equal(out[0].vacancy_rate, 6.2);
});

test("selectLatestVerifiedPerSubmarket: mhs_databook with no per-field flags is excluded", () => {
  // An MHS row where all per-field flags are false must NOT enter the output —
  // it would carry only null metrics after normalization, which is useless.
  const rows = [
    {
      source_name: "mhs_databook",
      sector: "retail",
      submarket: "Naples",
      quarter: "2026-Q1",
      vacancy_rate: 5.0,
      asking_rent_nnn: 38.0,
      absorption_sqft: 20000,
      source_url: null,
      verified: false,
      verified_vacancy: false,
      verified_rents: false,
      verified_absorption: false,
    },
  ];
  assert.deepEqual(selectLatestVerifiedPerSubmarket(rows), []);
});

test("selectLatestVerifiedPerSubmarket: mhs_databook with only verified_vacancy is included", () => {
  const rows = [
    {
      source_name: "mhs_databook",
      sector: "retail",
      submarket: "Naples",
      quarter: "2026-Q1",
      vacancy_rate: 5.0,
      asking_rent_nnn: 38.0,
      absorption_sqft: 20000,
      source_url: null,
      verified: false,
      verified_vacancy: true,
      verified_rents: false,
      verified_absorption: false,
    },
  ];
  const out = selectLatestVerifiedPerSubmarket(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].source_name, "mhs_databook");
});

// --- marketbeatSwflSource (fixture mode) -------------------------------

test("fixture mode returns fragments after verified-filter + latest-per-submarket (all sectors)", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  // Fixture verified winners — per (sector, submarket), latest verified quarter:
  //   retail Naples         — cw_marketbeat Q3 (latest-wins over Q1)
  //   retail Fort Myers     — cw_marketbeat Q3
  //   retail Cape Coral     — cw_marketbeat Q1 (Q2 unverified → dropped)
  //   retail Bonita Springs — mhs_databook Q1 (collision winner over cw_marketbeat Q1;
  //                           Q3 cw_marketbeat unverified → dropped)
  //   industrial Naples       — mhs_databook Q1 (per-field flags all true)
  //   industrial East Naples  — mhs_databook Q1 (per-field flags all true)
  //   office Fort Myers       — mhs_databook Q1 (vacancy+rent verified; absorption dark)
  // Per-sector surfacing (2026-06-08): retail Naples and industrial Naples are
  // DISTINCT fragments — keyed on (sector, submarket), never deduped together.
  assert.equal(fragments.length, 7);
});

test("fixture mode surfaces retail + industrial + office as distinct sectors", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  const sectors = new Set(fragments.map((f) => (f.normalized as { sector?: string }).sector));
  assert.ok(sectors.has("retail"), "retail must surface");
  assert.ok(sectors.has("industrial"), "industrial must surface");
  assert.ok(sectors.has("office"), "office must surface");
});

test("retail Naples and industrial Naples coexist as separate, un-blended fragments", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  const napleses = fragments.filter(
    (f) => (f.normalized as { submarket: string }).submarket === "Naples",
  );
  // Two Naples rows — one retail, one industrial — never deduped on submarket alone.
  assert.equal(napleses.length, 2);
  const bySector = new Map(
    napleses.map((f) => {
      const n = f.normalized as { sector?: string; vacancy_rate: number };
      return [n.sector, n.vacancy_rate];
    }),
  );
  assert.equal(bySector.get("retail"), 4.8); // retail Q3 winner
  assert.equal(bySector.get("industrial"), 3.1); // industrial Q1 — its own value
});

test("every fragment has kind = marketbeat-swfl with the typed field set", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  for (const f of fragments) {
    const n = f.normalized as Record<string, unknown>;
    assert.equal(n["kind"], "marketbeat-swfl");
    assert.equal(typeof n["submarket"], "string");
    assert.equal(typeof n["quarter"], "string");
    assert.match(n["quarter"] as string, /^\d{4}-Q[1-4]$/);
    assert.equal(typeof n["source_name"], "string");
    // Nullable numerics — must be either null or number; never undefined / NaN.
    for (const field of ["vacancy_rate", "asking_rent_nnn", "absorption_sqft"]) {
      const v = n[field];
      assert.ok(
        v === null || (typeof v === "number" && Number.isFinite(v)),
        `${field} must be null or finite number, got ${v}`,
      );
    }
  }
});

test("retail Naples fragment carries the Q3 row (latest-wins) with the Q3 numbers", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  const naples = fragments.find(
    (f) =>
      (f.normalized as { submarket: string; sector?: string }).submarket === "Naples" &&
      (f.normalized as { sector?: string }).sector === "retail",
  );
  assert.ok(naples, "retail Naples fragment must be present");
  const n = naples!.normalized as Record<string, unknown>;
  assert.equal(n["quarter"], "2026-Q3");
  assert.equal(n["vacancy_rate"], 4.8);
  assert.equal(n["asking_rent_nnn"], 41.5);
  assert.equal(n["absorption_sqft"], 32000);
});

test("Cape Coral fragment carries the Q1 row because Q2 is unverified", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  const cc = fragments.find(
    (f) => (f.normalized as { submarket: string }).submarket === "Cape Coral",
  );
  assert.ok(cc, "Cape Coral fragment must be present");
  const n = cc!.normalized as Record<string, unknown>;
  assert.equal(n["quarter"], "2026-Q1");
});

test("Bonita Springs fragment is mhs_databook Q1 — collision winner over cw_marketbeat", async () => {
  // The fixture has C&W Q1 (verified=true) and MHS Q1 (verified=false,
  // verified_vacancy=true). Same quarter → mhs_databook wins.
  const fragments = await marketbeatSwflSource.fetch();
  const bonita = fragments.find(
    (f) => (f.normalized as { submarket: string }).submarket === "Bonita Springs",
  );
  assert.ok(bonita, "Bonita Springs fragment must be present");
  const n = bonita!.normalized as Record<string, unknown>;
  assert.equal(n["source_name"], "mhs_databook");
  assert.equal(n["quarter"], "2026-Q1");
  assert.equal(n["vacancy_rate"], 6.2);
  assert.equal(n["asking_rent_nnn"], 34.0);
  // absorption is DARK (verified_absorption=false) → nulled at normalization
  assert.equal(n["absorption_sqft"], null);
});

test("quarter field round-trips into the typed row (no string mangling)", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  const quarters = new Set(fragments.map((f) => (f.normalized as { quarter: string }).quarter));
  // Naples + Fort Myers are 2026-Q3; Cape Coral + Bonita Springs are 2026-Q1.
  assert.ok(quarters.has("2026-Q3"));
  assert.ok(quarters.has("2026-Q1"));
});

test("source_url falls back to the citation page URL when row.source_url is null", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  for (const f of fragments) {
    const n = f.normalized as Record<string, unknown>;
    assert.equal(typeof n["source_url"], "string");
    assert.ok((n["source_url"] as string).length > 0);
  }
});

test("fragment trust tier + source_id are constant across all fragments", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  for (const f of fragments) {
    assert.equal(f.source_id, "marketbeat_swfl");
    assert.equal(f.source_trust_tier, 2);
  }
});

test("fragment_ids are unique and derive from the 4-part row id", async () => {
  const { fragmentId } = await import("../lib/ids.mts");
  const fragments = await marketbeatSwflSource.fetch();
  const ids = fragments.map((f) => f.fragment_id);
  assert.equal(new Set(ids).size, ids.length, "fragment_ids must be unique");
  // The fixture supplies 4-part ids (source_name_sector_submarket_quarter) for
  // all rows; idKey resolves to row.id directly (the fallback is never reached
  // for fixture rows that supply id explicitly).
  for (const f of fragments) {
    const raw = f.raw as {
      id?: string;
      source_name: string;
      sector?: string;
      submarket: string;
      quarter: string;
    };
    const idKey =
      raw.id ?? `${raw.source_name}_${raw.sector ?? "retail"}_${raw.submarket}_${raw.quarter}`;
    const expected = fragmentId("marketbeat_swfl", idKey);
    assert.equal(
      f.fragment_id,
      expected,
      `fragment_id for ${raw.submarket}/${raw.quarter} must derive from 4-part key`,
    );
  }
});

test("citationMeta references marketbeat_swfl", () => {
  const meta = marketbeatSwflSource.citationMeta("2026-05-25", 86400 * 90);
  assert.ok(meta.source.includes("marketbeat_swfl"));
  assert.equal(typeof meta.verified, "string");
  assert.equal(typeof meta.expires, "string");
});
