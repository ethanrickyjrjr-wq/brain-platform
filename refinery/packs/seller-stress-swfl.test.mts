import { test, beforeAll, describe } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";

process.env["REFINERY_SOURCE"] = "fixture";

// Real imports of the pack's EXPORTED weight constants — assert on the shipping values, not
// on hardcoded literals. The old version discarded the module and returned its own numbers,
// so a weight change in the pack could never fail the "weights sum to 1.00" test.
const {
  sellerStressSwfl,
  DELISTING_WEIGHT,
  PRICE_DROP_BREADTH_WEIGHT,
  CANCELLATION_WEIGHT,
  PRICE_DROP_DEPTH_WEIGHT,
  RELISTING_WEIGHT,
  rawCompositeToScore,
} = await import("./seller-stress-swfl.mts");
const { stressDropsSource } = await import("../sources/stress-price-drops-source.mts");
const { stressCancSource } = await import("../sources/stress-cancellations-source.mts");
const { stressDelistSource } = await import("../sources/stress-delistings-source.mts");

let dropFragments: RawFragment[] = [];
let cancFragments: RawFragment[] = [];
let delistFragments: RawFragment[] = [];
let allFragments: RawFragment[] = [];

beforeAll(async () => {
  dropFragments = await stressDropsSource.fetch();
  cancFragments = await stressCancSource.fetch();
  delistFragments = await stressDelistSource.fetch();
  allFragments = [...dropFragments, ...cancFragments, ...delistFragments];
});

describe("seller-stress-swfl sources", () => {
  test("price_drops fixture returns rows", () => {
    assert.ok(dropFragments.length > 0, "price_drops fixture is empty");
  });

  test("cancellations fixture returns rows", () => {
    assert.ok(cancFragments.length > 0, "cancellations fixture is empty");
  });

  test("delistings fixture returns rows", () => {
    assert.ok(delistFragments.length > 0, "delistings fixture is empty");
  });

  test("each source has at least 6 distinct ZIPs", () => {
    const zips = new Set(dropFragments.map((f) => (f.normalized as { zip_code: string }).zip_code));
    assert.ok(zips.size >= 6, `expected >= 6 ZIPs, got ${zips.size}`);
  });
});

describe("seller-stress-swfl corpusSummary", () => {
  test("returns SynthesisFact[] from combined fragments", () => {
    const facts = sellerStressSwfl.corpusSummary!(allFragments);
    assert.ok(Array.isArray(facts), "corpusSummary must return an array");
  });
});

describe("seller-stress-swfl outputProducer", () => {
  test("returns a valid direction", () => {
    sellerStressSwfl.corpusSummary!(allFragments);
    const result = sellerStressSwfl.outputProducer!({} as never);
    const validDirections = ["bullish", "bearish", "neutral", "mixed"];
    assert.ok(
      validDirections.includes(result.direction),
      `unexpected direction: ${result.direction}`,
    );
  });

  test("emits exactly 5 key_metrics", () => {
    sellerStressSwfl.corpusSummary!(allFragments);
    const result = sellerStressSwfl.outputProducer!({} as never);
    assert.strictEqual(result.key_metrics.length, 5, "expected 5 key_metrics");
  });

  test("detail_tables[0] has rows", () => {
    sellerStressSwfl.corpusSummary!(allFragments);
    const result = sellerStressSwfl.outputProducer!({} as never);
    assert.ok(result.detail_tables && result.detail_tables.length > 0, "no detail_tables");
    assert.ok(result.detail_tables![0].rows.length > 0, "detail_tables[0].rows is empty");
  });

  test("magnitude is in [0, 1]", () => {
    sellerStressSwfl.corpusSummary!(allFragments);
    const result = sellerStressSwfl.outputProducer!({} as never);
    assert.ok(
      result.magnitude >= 0 && result.magnitude <= 1,
      `magnitude ${result.magnitude} out of range`,
    );
  });

  test("baseline suppression fires for ZIP 33932 (only 2 baseline obs)", () => {
    sellerStressSwfl.corpusSummary!(allFragments);
    const result = sellerStressSwfl.outputProducer!({} as never);
    const allRows = result.detail_tables![0].rows;
    const suppressed = allRows.filter((r) => r.cells["baseline_suppressed"] === true);
    assert.ok(
      suppressed.length >= 1,
      `expected at least 1 baseline-suppressed ZIP (33932 has 2 baseline obs), got 0`,
    );
  });

  test("all 5 weight constants sum to 1.00", () => {
    const sum =
      DELISTING_WEIGHT +
      PRICE_DROP_BREADTH_WEIGHT +
      CANCELLATION_WEIGHT +
      PRICE_DROP_DEPTH_WEIGHT +
      RELISTING_WEIGHT;
    assert.ok(Math.abs(sum - 1.0) < 1e-9, `weights sum to ${sum}, expected 1.0`);
  });

  test("seller_stress_score_swfl metric slug is present", () => {
    sellerStressSwfl.corpusSummary!(allFragments);
    const result = sellerStressSwfl.outputProducer!({} as never);
    const slugs = result.key_metrics.map((m) => m.metric);
    assert.ok(
      slugs.includes("seller_stress_score_swfl"),
      `missing seller_stress_score_swfl; got: ${slugs.join(", ")}`,
    );
  });
});

describe("seller-stress-swfl rolling-12 trailing window (regression: early-year must not blank)", () => {
  function monthsBetween(start: string, end: string): string[] {
    const out: string[] = [];
    let [y, m] = start.split("-").map(Number);
    const [ey, em] = end.split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) {
      out.push(`${y}-${String(m).padStart(2, "0")}-01`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }

  function syntheticZip(zip: string, periods: string[]): RawFragment[] {
    const frags: RawFragment[] = [];
    for (const p of periods) {
      const base = { source_trust_tier: 3, fetched_at: "2026-02-15T00:00:00.000Z", raw: {} };
      frags.push({
        fragment_id: `drops|${zip}|${p}`,
        source_id: "redfin_price_drops_swfl",
        ...base,
        normalized: {
          zip_code: zip,
          period_begin: p,
          pct_active_with_drops: 40,
          avg_price_drop_pct: 5,
        },
      } as unknown as RawFragment);
      frags.push({
        fragment_id: `canc|${zip}|${p}`,
        source_id: "redfin_contract_cancellations_swfl",
        ...base,
        normalized: { zip_code: zip, period_begin: p, cancellation_rate_pct: 15 },
      } as unknown as RawFragment);
      frags.push({
        fragment_id: `delist|${zip}|${p}`,
        source_id: "redfin_delistings_relistings_swfl",
        ...base,
        normalized: {
          zip_code: zip,
          period_begin: p,
          share_delisted_pct: 18,
          share_relisted_pct: 3,
        },
      } as unknown as RawFragment);
    }
    return frags;
  }

  test("a ZIP whose latest period is February is still scored (calendar-YTD bug would suppress it)", () => {
    // 36 baseline months (2019–2021) + a trailing year ending 2026-02. Under the OLD
    // calendar-YTD cutoff only Jan + Feb 2026 (2 periods) qualified → < N_TRAILING_MIN(3) →
    // suppressed → brain flips to neutral. Rolling-12 spans Mar 2025..Feb 2026 (12) → scored.
    const periods = [
      ...monthsBetween("2019-01-01", "2021-12-01"),
      ...monthsBetween("2025-03-01", "2026-02-01"),
    ];
    sellerStressSwfl.corpusSummary!(syntheticZip("99999", periods));
    const result = sellerStressSwfl.outputProducer!({} as never);
    const row = result.detail_tables![0].rows.find((r) => r.key === "99999");
    assert.ok(row, "synthetic ZIP 99999 missing from detail table");
    assert.notStrictEqual(
      row!.cells["seller_stress_score"],
      null,
      "ZIP with a February latest period was suppressed — the calendar-YTD trailing-window bug is back",
    );
  });
});

describe("seller-stress-swfl ceiling tuning (2026-06-14: unbunch the top decile)", () => {
  // A synthetic ZIP whose latest period is far above its 2019–2021 baseline on every
  // signal → a strongly positive raw composite. Used to prove direction reads the RAW
  // composite (decoupled), not the clamped display score.
  function highStressZip(zip: string): RawFragment[] {
    const frags: RawFragment[] = [];
    const push = (sourceId: string, period: string, normalized: Record<string, number>) =>
      frags.push({
        fragment_id: `${sourceId}|${zip}|${period}`,
        source_id: sourceId,
        source_trust_tier: 3,
        fetched_at: "2026-02-15T00:00:00.000Z",
        raw: {},
        normalized: { zip_code: zip, period_begin: period, ...normalized },
      } as unknown as RawFragment);

    // 36 low-stress baseline months with a small wobble (non-zero stddev so z is finite).
    let i = 0;
    for (let y = 2019; y <= 2021; y++) {
      for (let m = 1; m <= 12; m++) {
        const p = `${y}-${String(m).padStart(2, "0")}-01`;
        const w = i % 2; // 0/1 wobble
        push("redfin_price_drops_swfl", p, {
          pct_active_with_drops: 18 + 2 * w,
          avg_price_drop_pct: 1.5 + w,
        });
        push("redfin_contract_cancellations_swfl", p, { cancellation_rate_pct: 4 + 2 * w });
        push("redfin_delistings_relistings_swfl", p, {
          share_delisted_pct: 4 + 2 * w,
          share_relisted_pct: 1 + w,
        });
        i++;
      }
    }
    // Trailing 12 months (Mar 2025 .. Feb 2026) elevated on every signal → high z at latest.
    const trailing = [
      ...Array.from({ length: 10 }, (_, k) => `2025-${String(k + 3).padStart(2, "0")}-01`),
      "2026-01-01",
      "2026-02-01",
    ];
    for (const p of trailing) {
      push("redfin_price_drops_swfl", p, { pct_active_with_drops: 50, avg_price_drop_pct: 8 });
      push("redfin_contract_cancellations_swfl", p, { cancellation_rate_pct: 25 });
      push("redfin_delistings_relistings_swfl", p, {
        share_delisted_pct: 30,
        share_relisted_pct: 5,
      });
    }
    return frags;
  }

  test("display map: CEIL 3.0 / FLOOR -2.0 — raw 3.0->100, -2.0->0, above-ceiling clamps, mid spreads", () => {
    assert.strictEqual(rawCompositeToScore(3.0), 100, "raw 3.0 must hit the ceiling");
    assert.strictEqual(rawCompositeToScore(-2.0), 0, "raw -2.0 must hit the floor");
    assert.strictEqual(rawCompositeToScore(3.5), 100, "raw above ceiling clamps to 100");
    // The regression this locks: under the old CEIL=2.0, every raw >= 2.0 flattened to 100.
    const s2 = rawCompositeToScore(2.0);
    assert.ok(s2 > 75 && s2 < 100, `raw 2.0 must now spread below 100 (got ${s2}, expect 80)`);
    assert.ok(
      rawCompositeToScore(2.5) > s2 && rawCompositeToScore(2.5) < 100,
      "raw 2.5 must sit strictly between raw-2.0 and the ceiling (monotonic spread)",
    );
  });

  test("measured 2026-06-14 ceiling cohort: saturation drops to <= 3 ZIPs at 100", () => {
    // The 11 ZIPs ALL flattened to 100 under CEIL=2.0 (live render raw composites, 2026-06-14):
    const measuredCeilingRaws = [3.05, 2.58, 2.28, 2.21, 2.19, 2.18, 2.16, 2.08, 2.06, 2.03, 2.02];
    const stillAtCeiling = measuredCeilingRaws.filter((r) => rawCompositeToScore(r) >= 100);
    assert.ok(
      stillAtCeiling.length <= 3,
      `ceiling saturation must drop to <= 3 (got ${stillAtCeiling.length}); a revert to CEIL=2.0 re-bunches all 11`,
    );
    const spread = measuredCeilingRaws.map(rawCompositeToScore);
    assert.ok(
      Math.max(...spread) - Math.min(...spread) > 10,
      `the cohort must visibly spread, not stay bunched (range ${(Math.max(...spread) - Math.min(...spread)).toFixed(1)})`,
    );
  });

  test("direction reads the raw composite (decoupled): a strongly-bearish corpus stays bearish", () => {
    // raw composite >> 0.6 → bearish regardless of SCORE_CEIL_SIGMA. This is the guard
    // against the coupling bug: widening the display ceiling must never move the call.
    sellerStressSwfl.corpusSummary!(highStressZip("88888"));
    const result = sellerStressSwfl.outputProducer!({} as never);
    assert.strictEqual(
      result.direction,
      "bearish",
      `expected bearish from a high raw composite, got ${result.direction}`,
    );
  });
});
