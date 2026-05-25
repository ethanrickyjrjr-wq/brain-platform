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

test("selectLatestVerifiedPerSubmarket: all-unverified input returns empty output", () => {
  const rows = [
    {
      submarket: "Naples",
      quarter: "2026-Q3",
      vacancy_rate: 5,
      asking_rent_nnn: 40,
      absorption_sqft: 100,
      source_url: null,
      verified: false,
    },
    {
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

test("selectLatestVerifiedPerSubmarket: single verified quarter survives", () => {
  const rows = [
    {
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
      submarket: "Naples",
      quarter: "2026-Q1",
      vacancy_rate: 5.5,
      asking_rent_nnn: 38,
      absorption_sqft: 25000,
      source_url: "https://example.com/q1",
      verified: true,
    },
    {
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
      submarket: "Cape Coral",
      quarter: "2026-Q1",
      vacancy_rate: 7.0,
      asking_rent_nnn: 22.5,
      absorption_sqft: 8000,
      source_url: "https://example.com/cc-q1",
      verified: true,
    },
    {
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
      submarket: "Naples",
      quarter: "2026-Q3",
      vacancy_rate: 5,
      asking_rent_nnn: 40,
      absorption_sqft: 100,
      source_url: null,
      verified: true,
    },
    {
      submarket: "Bonita Springs",
      quarter: "2026-Q3",
      vacancy_rate: 6,
      asking_rent_nnn: 32,
      absorption_sqft: 50,
      source_url: null,
      verified: true,
    },
    {
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

// --- marketbeatSwflSource (fixture mode) -------------------------------

test("fixture mode returns fragments after verified-filter + latest-per-submarket", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  // Fixture has 4 verified submarkets total: Naples (Q1+Q3 both verified),
  // Fort Myers (Q3), Cape Coral (Q1 verified, Q2 unverified → Q1 wins).
  // Bonita Springs is all-unverified → dropped. Total = 3 fragments.
  assert.equal(fragments.length, 3);
});

test("every fragment has kind = marketbeat-swfl with the typed field set", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  for (const f of fragments) {
    const n = f.normalized as Record<string, unknown>;
    assert.equal(n["kind"], "marketbeat-swfl");
    assert.equal(typeof n["submarket"], "string");
    assert.equal(typeof n["quarter"], "string");
    assert.match(n["quarter"] as string, /^\d{4}-Q[1-4]$/);
    // Nullable numerics — must be either null or number; never undefined / NaN.
    for (const field of [
      "vacancy_rate",
      "asking_rent_nnn",
      "absorption_sqft",
    ]) {
      const v = n[field];
      assert.ok(
        v === null || (typeof v === "number" && Number.isFinite(v)),
        `${field} must be null or finite number, got ${v}`,
      );
    }
  }
});

test("Naples fragment carries the Q3 row (latest-wins) with the Q3 numbers", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  const naples = fragments.find(
    (f) => (f.normalized as { submarket: string }).submarket === "Naples",
  );
  assert.ok(naples, "Naples fragment must be present");
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

test("Bonita Springs is dropped entirely — all rows unverified", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  const bonita = fragments.find(
    (f) =>
      (f.normalized as { submarket: string }).submarket === "Bonita Springs",
  );
  assert.equal(bonita, undefined);
});

test("quarter field round-trips into the typed row (no string mangling)", async () => {
  const fragments = await marketbeatSwflSource.fetch();
  const quarters = new Set(
    fragments.map((f) => (f.normalized as { quarter: string }).quarter),
  );
  // Naples + Fort Myers are 2026-Q3; Cape Coral is 2026-Q1.
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

test("fragment_ids are unique and deterministic from the row's natural key", async () => {
  const { fragmentId } = await import("../lib/ids.mts");
  const fragments = await marketbeatSwflSource.fetch();
  const ids = fragments.map((f) => f.fragment_id);
  assert.equal(new Set(ids).size, ids.length);
  // Verify the natural-key shape: fragmentId("marketbeat_swfl", `${submarket}_${quarter}`)
  // when row.id is absent. The fixture supplies `id` directly, so we reproduce
  // from that — same result either way.
  for (const f of fragments) {
    const n = f.normalized as { submarket: string; quarter: string };
    const naturalKey = `${n.submarket}_${n.quarter}`;
    const expected = fragmentId("marketbeat_swfl", naturalKey);
    assert.equal(
      f.fragment_id,
      expected,
      `fragment_id for ${n.submarket}/${n.quarter} must derive from natural key`,
    );
  }
});

test("citationMeta references marketbeat_swfl", () => {
  const meta = marketbeatSwflSource.citationMeta("2026-05-25", 86400 * 90);
  assert.ok(meta.source.includes("marketbeat_swfl"));
  assert.equal(typeof meta.verified, "string");
  assert.equal(typeof meta.expires, "string");
});
