import { test } from "bun:test";
import assert from "node:assert/strict";

process.env["REFINERY_SOURCE"] = "fixture";

const { fdotSource, LATEST_FDOT_YEAR } = await import("./fdot-source.mts");

test("fixture mode returns at least one fragment", async () => {
  const fragments = await fdotSource.fetch();
  assert.ok(fragments.length > 0);
});

test("fragments split into county-year aggregates + at least one cohort YoY", async () => {
  const fragments = await fdotSource.fetch();
  const countyYears = fragments.filter(
    (f) => (f.normalized as { kind: string }).kind === "fdot-county-year",
  );
  const cohorts = fragments.filter(
    (f) => (f.normalized as { kind: string }).kind === "fdot-cohort-yoy",
  );
  assert.ok(
    countyYears.length > 0,
    "expected at least one county-year fragment",
  );
  assert.equal(cohorts.length, 1, "expected exactly one cohort-yoy fragment");
});

test("every county-year fragment has the required aggregate fields", async () => {
  const fragments = await fdotSource.fetch();
  for (const f of fragments) {
    const n = f.normalized as Record<string, unknown>;
    if (n["kind"] !== "fdot-county-year") continue;
    assert.equal(typeof n["county"], "string");
    assert.equal(typeof n["year"], "number");
    assert.equal(typeof n["weighted_avg_aadt"], "number");
    assert.equal(typeof n["sum_shape_length"], "number");
    assert.equal(typeof n["median_tfctr"], "number");
    assert.equal(typeof n["segment_count"], "number");
    assert.ok((n["weighted_avg_aadt"] as number) > 0);
    assert.ok((n["sum_shape_length"] as number) > 0);
  }
});

test("cohort YoY fragment matches the latest two years for Lee + Collier", async () => {
  const fragments = await fdotSource.fetch();
  const cohort = fragments.find(
    (f) => (f.normalized as { kind: string }).kind === "fdot-cohort-yoy",
  );
  assert.ok(cohort, "expected a cohort fragment");
  const n = cohort!.normalized as Record<string, unknown>;
  assert.equal(n["curr_year"], LATEST_FDOT_YEAR);
  assert.equal(n["prev_year"], LATEST_FDOT_YEAR - 1);
  assert.deepEqual(n["counties"], ["LEE", "COLLIER"]);
  assert.ok((n["cohort_size"] as number) > 0);
  assert.equal(typeof n["yoy_pct"], "number");
});

test("fragment_ids are unique", async () => {
  const fragments = await fdotSource.fetch();
  const ids = fragments.map((f) => f.fragment_id);
  assert.equal(new Set(ids).size, ids.length);
});

test("fixture is non-degenerate: covers both Lee + Collier + Charlotte in latest year", async () => {
  const fragments = await fdotSource.fetch();
  const latest = fragments
    .filter(
      (f) =>
        (f.normalized as { kind: string; year: number }).kind ===
          "fdot-county-year" &&
        (f.normalized as { year: number }).year === LATEST_FDOT_YEAR,
    )
    .map((f) => (f.normalized as { county: string }).county);
  assert.ok(latest.includes("LEE"));
  assert.ok(latest.includes("COLLIER"));
  assert.ok(latest.includes("CHARLOTTE"));
});

test("citationMeta returns a fdot_aadt_fl-cited source", () => {
  const meta = fdotSource.citationMeta("2026-05-17", 86400);
  assert.ok(meta.source.includes("fdot_aadt_fl"));
  assert.ok(meta.source.includes("FDOT AADT"));
  assert.equal(typeof meta.verified, "string");
  assert.equal(typeof meta.expires, "string");
});

// Live-path safety: when Supabase returns 0 rows (typically because the dlt
// pipeline hasn't been run or the GRANT wasn't applied), the connector must
// THROW rather than silently emit zero fragments — silent zero produces a
// rendered brain with a "no segments available" caveat that looks intentional.
test("assertSegmentsNonEmpty throws with actionable message on 0 rows", async () => {
  const { assertSegmentsNonEmpty } = await import("./fdot-source.mts");
  assert.throws(
    () => assertSegmentsNonEmpty([]),
    (err: Error) => {
      assert.match(err.message, /returned 0 rows/);
      assert.match(err.message, /python -m ingest\.pipelines\.fdot\.pipeline/);
      assert.match(err.message, /fdot_aadt_fl_grant\.sql/);
      assert.match(err.message, /service_role/);
      return true;
    },
  );
});

test("assertSegmentsNonEmpty is a no-op on non-empty input", async () => {
  const { assertSegmentsNonEmpty } = await import("./fdot-source.mts");
  // Construct a minimal SegmentRow-shaped object.
  const oneRow = [
    {
      yearx: 2025,
      county: "LEE",
      roadway: "12001000",
      desc_frm: "x",
      desc_to: "y",
      aadt: 100,
      aadtflg: "T",
      tfctr: 0.05,
      shape_length: 1000,
    },
  ];
  assert.doesNotThrow(() => assertSegmentsNonEmpty(oneRow as never));
});
