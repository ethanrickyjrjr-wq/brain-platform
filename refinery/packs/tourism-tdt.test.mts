import { test } from "bun:test";
import assert from "node:assert/strict";

process.env["REFINERY_SOURCE"] = "fixture";

const { buildSnapshot, voteTdtDirection, tourismTdt } =
  await import("./tourism-tdt.mts");
const { tourismTdtSource } = await import("../sources/tourism-tdt-source.mts");

// ── Helpers ───────────────────────────────────────────────────────────────────

import type { TourismTdtNormalized } from "../sources/tourism-tdt-source.mts";

function makeRow(
  county: string,
  period_yyyymm: string,
  gross_collections_usd: number | null,
  post_ian = false,
): TourismTdtNormalized {
  const fiscal_year = parseInt(period_yyyymm.slice(0, 4), 10);
  return {
    kind: "tdt-collection",
    county,
    period_yyyymm,
    period_raw: `${period_yyyymm}-01`,
    fiscal_year,
    gross_collections_usd,
    post_ian,
    source_url: "fixture://test",
  };
}

// ── Pack identity ─────────────────────────────────────────────────────────────

test("tourismTdt pack: id and domain are stable", () => {
  assert.equal(tourismTdt.id, "tourism-tdt");
  assert.equal(tourismTdt.brain_id, "tourism-tdt");
  assert.equal(tourismTdt.domain, "hospitality");
});

test("tourismTdt pack: deterministic flags set", () => {
  assert.equal(tourismTdt.skipTriageAgent, true);
  assert.equal(tourismTdt.skipSynthesisAgent, true);
});

test("tourismTdt pack: leaf node — no input_brains", () => {
  assert.deepEqual(tourismTdt.input_brains, []);
});

test("tourismTdt pack: single source wired (fl_dor_tdt)", () => {
  assert.equal(tourismTdt.sources.length, 1);
  assert.equal(tourismTdt.sources[0].source_id, "fl_dor_tdt");
  assert.equal(tourismTdt.sources[0].trust_tier, 1);
});

// ── buildSnapshot: SWFL combined rollup ──────────────────────────────────────

test("buildSnapshot: Lee + Collier combined_usd = sum per period", () => {
  const rows = [
    makeRow("Lee", "2025-04", 7_000_000),
    makeRow("Collier", "2025-04", 8_000_000),
    makeRow("Lee", "2025-05", 5_000_000),
    makeRow("Collier", "2025-05", 6_000_000),
  ];
  const snap = buildSnapshot(rows);
  assert.equal(snap.swflPeriods.length, 2);
  const apr = snap.swflPeriods.find((p) => p.period_yyyymm === "2025-04")!;
  assert.equal(apr.combined_usd, 15_000_000, "Apr combined should be $15M");
  const may = snap.swflPeriods.find((p) => p.period_yyyymm === "2025-05")!;
  assert.equal(may.combined_usd, 11_000_000, "May combined should be $11M");
  assert.equal(snap.latest?.period_yyyymm, "2025-05");
  assert.equal(snap.latest?.combined_usd, 11_000_000);
});

test("buildSnapshot: per-county isolation — leeLatestUsd and collierLatestUsd are independent", () => {
  const rows = [
    makeRow("Lee", "2025-03", 5_000_000),
    makeRow("Collier", "2025-03", 8_400_000),
  ];
  const snap = buildSnapshot(rows);
  assert.equal(snap.leeLatestUsd, 5_000_000);
  assert.equal(snap.collierLatestUsd, 8_400_000);
  assert.equal(snap.latest?.combined_usd, 13_400_000);
});

test("buildSnapshot: trailing 12mo = Lee trailing + Collier trailing when windows are the same", () => {
  // 14 months for both counties: trailing 12 should cover the same 12 periods
  const rows: TourismTdtNormalized[] = [];
  for (let m = 1; m <= 14; m++) {
    const mm = m.toString().padStart(2, "0");
    const period =
      m <= 12 ? `2024-${mm}` : `2025-${(m - 12).toString().padStart(2, "0")}`;
    rows.push(makeRow("Lee", period, 4_000_000));
    rows.push(makeRow("Collier", period, 6_000_000));
  }
  const snap = buildSnapshot(rows);
  // trailing12moUsd should be sum of last 12 combined periods
  assert.ok(snap.trailing12moUsd !== null);
  assert.ok(snap.leeTrailing12moUsd !== null);
  assert.ok(snap.collierTrailing12moUsd !== null);
  // Each combined period = $10M; trailing 12 = $120M
  assert.equal(snap.trailing12moUsd, 120_000_000);
  assert.equal(snap.leeTrailing12moUsd, 48_000_000);
  assert.equal(snap.collierTrailing12moUsd, 72_000_000);
  assert.equal(
    snap.leeTrailing12moUsd + snap.collierTrailing12moUsd,
    snap.trailing12moUsd,
  );
});

// ── buildSnapshot: 0-value guard ─────────────────────────────────────────────

test("buildSnapshot: 0-value guard — priorYear is null when combined prior = $0", () => {
  // Current: Lee $0 + Collier $1M = $1M combined
  // Prior year same month: Lee $0 + Collier $0 = $0 combined
  const rows = [
    makeRow("Lee", "2024-04", 0),
    makeRow("Collier", "2024-04", 0),
    makeRow("Lee", "2025-04", 0),
    makeRow("Collier", "2025-04", 1_000_000),
  ];
  const snap = buildSnapshot(rows);
  assert.equal(snap.latest?.period_yyyymm, "2025-04");
  assert.equal(snap.latest?.combined_usd, 1_000_000);
  // priorYear (2024-04) has combined_usd = 0, so it must be excluded
  assert.equal(snap.priorYear, null, "0-value prior must be excluded");
});

test("buildSnapshot: 0-value guard — priorYear is found when combined prior > 0", () => {
  const rows = [
    makeRow("Lee", "2024-04", 7_000_000),
    makeRow("Collier", "2024-04", 8_000_000),
    makeRow("Lee", "2025-04", 7_500_000),
    makeRow("Collier", "2025-04", 8_500_000),
  ];
  const snap = buildSnapshot(rows);
  assert.equal(snap.priorYear?.period_yyyymm, "2024-04");
  assert.equal(snap.priorYear?.combined_usd, 15_000_000);
});

test("buildSnapshot: preIanBaseline excludes $0 months", () => {
  // 12 pre-Ian months with one $0 month — baseline should not be computable
  // because we need 12 non-zero pre-Ian months
  const rows: TourismTdtNormalized[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = m.toString().padStart(2, "0");
    // Use pre-Ian period (2021-xx, post_ian=false)
    const usd = m === 6 ? 0 : 5_000_000; // one $0 month
    rows.push(makeRow("Lee", `2021-${mm}`, usd, false));
  }
  const snap = buildSnapshot(rows);
  // Only 11 non-zero pre-Ian months — baseline not computable
  assert.equal(
    snap.preIanBaseline12moUsd,
    null,
    "baseline requires 12 non-zero pre-Ian months",
  );
});

// ── voteTdtDirection ──────────────────────────────────────────────────────────

test("voteTdtDirection: null when no latest", () => {
  const snap = buildSnapshot([]);
  const vote = voteTdtDirection(snap);
  assert.equal(vote.direction, "neutral");
  assert.equal(vote.magnitude, 0);
  assert.equal(vote.yoyPct, null);
  assert.equal(vote.recoveryRatio, null);
});

test("voteTdtDirection: yoyPct is null when priorYear is null (0-value guard)", () => {
  const rows = [
    makeRow("Lee", "2024-04", 0),
    makeRow("Collier", "2024-04", 0),
    makeRow("Lee", "2025-04", 5_000_000),
    makeRow("Collier", "2025-04", 5_000_000),
  ];
  const snap = buildSnapshot(rows);
  const vote = voteTdtDirection(snap);
  assert.equal(vote.yoyPct, null, "YoY must be null when prior is $0");
});

test("voteTdtDirection: bullish when YoY > +5% and recovery >= 0.9", () => {
  // Build 24 pre-Ian months + 12 post-Ian months; make current YoY +10%
  const rows: TourismTdtNormalized[] = [];
  // 24 pre-Ian periods (Lee only, enough for a 12-month baseline window)
  for (let m = 0; m < 24; m++) {
    const year = 2020 + Math.floor(m / 12);
    const month = (m % 12) + 1;
    const mm = month.toString().padStart(2, "0");
    rows.push(makeRow("Lee", `${year}-${mm}`, 10_000_000, false));
  }
  // priorYear same month: $10M; current: $11M → +10% YoY
  rows.push(makeRow("Lee", "2022-01", 10_000_000, false));
  rows.push(makeRow("Lee", "2023-01", 11_000_000, true));
  const snap = buildSnapshot(rows);
  const vote = voteTdtDirection(snap);
  assert.equal(vote.direction, "bullish");
  assert.ok(vote.yoyPct !== null && vote.yoyPct > 5);
});

// ── Fixture round-trip ────────────────────────────────────────────────────────

test("tourismTdt pack: fixture round-trip produces 9 key metrics", async () => {
  const allFragments = await tourismTdtSource.fetch();
  // Fixture is 96 rows (48 Lee + 48 Collier)
  assert.ok(allFragments.length >= 90, "expected ~96 fixture fragments");

  tourismTdt.corpusSummary!(allFragments);
  const result = tourismTdt.outputProducer!({
    pack: tourismTdt,
    version: 1,
    refined_at: new Date().toISOString(),
    citations: [],
    facts: [],
    recentNote: "",
  } as unknown as Parameters<NonNullable<typeof tourismTdt.outputProducer>>[0]);

  const metricNames = result.key_metrics.map((m) => m.metric);

  // 5 SWFL combined (backward-compat slugs)
  assert.ok(
    metricNames.includes("latest_monthly_collections_usd"),
    "missing SWFL combined latest",
  );
  assert.ok(metricNames.includes("yoy_delta_pct"), "missing SWFL combined YoY");
  assert.ok(
    metricNames.includes("trailing_12mo_collections_usd"),
    "missing SWFL combined trailing-12mo",
  );
  assert.ok(
    metricNames.includes("post_ian_recovery_ratio"),
    "missing post-Ian recovery",
  );
  assert.ok(
    metricNames.includes("seasonal_position_vs_history"),
    "missing seasonal position",
  );

  // 4 per-county additive
  assert.ok(
    metricNames.includes("lee_latest_monthly_collections_usd"),
    "missing Lee latest",
  );
  assert.ok(
    metricNames.includes("lee_trailing_12mo_collections_usd"),
    "missing Lee trailing-12mo",
  );
  assert.ok(
    metricNames.includes("collier_latest_monthly_collections_usd"),
    "missing Collier latest",
  );
  assert.ok(
    metricNames.includes("collier_trailing_12mo_collections_usd"),
    "missing Collier trailing-12mo",
  );

  assert.equal(result.key_metrics.length, 9, "expected exactly 9 metrics");
});

test("tourismTdt pack: fixture per-county values are positive and different", async () => {
  const allFragments = await tourismTdtSource.fetch();
  tourismTdt.corpusSummary!(allFragments);
  const result = tourismTdt.outputProducer!({
    pack: tourismTdt,
    version: 1,
    refined_at: new Date().toISOString(),
    citations: [],
    facts: [],
    recentNote: "",
  } as unknown as Parameters<NonNullable<typeof tourismTdt.outputProducer>>[0]);

  const leeLatest = result.key_metrics.find(
    (m) => m.metric === "lee_latest_monthly_collections_usd",
  )!;
  const collierLatest = result.key_metrics.find(
    (m) => m.metric === "collier_latest_monthly_collections_usd",
  )!;
  const swflLatest = result.key_metrics.find(
    (m) => m.metric === "latest_monthly_collections_usd",
  )!;

  assert.ok(
    (leeLatest.value as number) > 0,
    "Lee latest should be positive in fixture",
  );
  assert.ok(
    (collierLatest.value as number) > 0,
    "Collier latest should be positive in fixture",
  );
  // SWFL combined >= each county
  assert.ok(
    (swflLatest.value as number) >= (leeLatest.value as number),
    "SWFL >= Lee",
  );
  assert.ok(
    (swflLatest.value as number) >= (collierLatest.value as number),
    "SWFL >= Collier",
  );
  // Lee + Collier = SWFL (combined rollup integrity)
  assert.ok(
    Math.abs(
      (leeLatest.value as number) +
        (collierLatest.value as number) -
        (swflLatest.value as number),
    ) < 1,
    "Lee + Collier must equal SWFL combined",
  );
});

test("tourismTdt pack: fixture round-trip — fixture caveat present", async () => {
  const allFragments = await tourismTdtSource.fetch();
  tourismTdt.corpusSummary!(allFragments);
  const result = tourismTdt.outputProducer!({
    pack: tourismTdt,
    version: 1,
    refined_at: new Date().toISOString(),
    citations: [],
    facts: [],
    recentNote: "",
  } as unknown as Parameters<NonNullable<typeof tourismTdt.outputProducer>>[0]);

  assert.ok(
    result.caveats.some((c) => /synthetic fixture/i.test(c)),
    "fixture caveat must surface in OUTPUT",
  );
  assert.deepEqual(result.drivers, []);
  assert.deepEqual(result.contradicts, []);
});

test("tourismTdt pack: empty-snapshot → neutral fallback", () => {
  // Invoke corpusSummary with zero valid fragments to reset closure state.
  tourismTdt.corpusSummary!([]);
  const result = tourismTdt.outputProducer!({
    pack: tourismTdt,
    version: 1,
    refined_at: new Date().toISOString(),
    citations: [],
    facts: [],
    recentNote: "",
  } as unknown as Parameters<NonNullable<typeof tourismTdt.outputProducer>>[0]);
  assert.equal(result.direction, "neutral");
  assert.equal(result.magnitude, 0);
  assert.equal(result.key_metrics.length, 0);
});
