import { test, beforeAll, describe } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";
import type { MarketHeatCoreRow } from "../sources/market-heat-core-source.mts";

process.env["REFINERY_SOURCE"] = "fixture";

const {
  marketHeatSwfl,
  CAP,
  MIN_SIGNALS,
  BULL_THRESHOLD,
  BEAR_THRESHOLD,
  normalizeSignal,
  computeZipTilt,
  regionDirection,
  tiltToDisplayScore,
  zipExhibitsFalsifier,
  regionMonthlyTrend,
} = await import("./market-heat-swfl.mts");
const { marketHeatCoreSource } = await import("../sources/market-heat-core-source.mts");
const { marketHeatHotnessSource } = await import("../sources/market-heat-hotness-source.mts");

let coreFragments: RawFragment[] = [];
let hotnessFragments: RawFragment[] = [];
let allFragments: RawFragment[] = [];

beforeAll(async () => {
  coreFragments = await marketHeatCoreSource.fetch();
  hotnessFragments = await marketHeatHotnessSource.fetch();
  allFragments = [...coreFragments, ...hotnessFragments];
});

// ── Pure vote polarity (the load-bearing IP) ──────────────────────────────────

describe("market-heat-swfl — vote polarity", () => {
  test("normalizeSignal: inventory FALLING (yy<0) is bullish (+)", () => {
    assert.ok(normalizeSignal(-0.15, -1)! > 0, "falling inventory must read bullish");
    assert.ok(normalizeSignal(0.15, -1)! < 0, "rising inventory must read bearish");
  });

  test("normalizeSignal: clamps a >CAP move to ±1", () => {
    assert.strictEqual(normalizeSignal(-0.9, -1), 1, "−90% inventory clamps to +1");
    assert.strictEqual(normalizeSignal(0.9, -1), -1);
  });

  test("INVERSION TRAP: rising pending_ratio is BULLISH", () => {
    // realtor's pending_ratio = pending ÷ active; rising = demand tightening.
    const up = computeZipTilt({ invYy: null, domYy: null, pendYy: 0.18 });
    const down = computeZipTilt({ invYy: null, domYy: null, pendYy: -0.18 });
    // single signal => suppressed (null) by MIN_SIGNALS, so pair it with a neutral inventory
    const upPair = computeZipTilt({ invYy: 0, domYy: null, pendYy: 0.18 });
    const downPair = computeZipTilt({ invYy: 0, domYy: null, pendYy: -0.18 });
    assert.strictEqual(up, null, "lone pending signal is suppressed");
    assert.strictEqual(down, null);
    assert.ok(upPair!.tilt > 0, "rising pending ratio must lift the tilt (bullish)");
    assert.ok(downPair!.tilt < 0, "falling pending ratio must lower the tilt (bearish)");
  });

  test("all three tightening → strongly bullish tilt", () => {
    const t = computeZipTilt({ invYy: -0.3, domYy: -0.3, pendYy: 0.3 });
    assert.strictEqual(t!.tilt, 1, "max tightening pins tilt at +1");
    assert.strictEqual(t!.present, 3);
  });

  test("all three loosening → strongly bearish tilt", () => {
    const t = computeZipTilt({ invYy: 0.3, domYy: 0.3, pendYy: -0.3 });
    assert.strictEqual(t!.tilt, -1);
  });

  test(`fewer than MIN_SIGNALS (${MIN_SIGNALS}) present → suppressed (null)`, () => {
    assert.strictEqual(computeZipTilt({ invYy: -0.1, domYy: null, pendYy: null }), null);
    assert.ok(computeZipTilt({ invYy: -0.1, domYy: -0.1, pendYy: null }) !== null);
  });

  test("CAP and thresholds are sane", () => {
    assert.ok(CAP > 0 && CAP < 1);
    assert.ok(BULL_THRESHOLD > 0 && BEAR_THRESHOLD < 0);
  });
});

describe("market-heat-swfl — region direction", () => {
  test("crosses thresholds correctly", () => {
    assert.strictEqual(regionDirection(0.5, 0.5, 0.5, 0.5), "bullish");
    assert.strictEqual(regionDirection(-0.5, -0.5, -0.5, -0.5), "bearish");
    assert.strictEqual(regionDirection(BULL_THRESHOLD, 0.2, 0.2, 0.2), "bullish");
    assert.strictEqual(regionDirection(BEAR_THRESHOLD, -0.2, -0.2, -0.2), "bearish");
  });

  test("flat band: disagreeing signs → mixed, agreeing → neutral", () => {
    assert.strictEqual(regionDirection(0.1, 0.5, -0.5, 0.0), "mixed");
    assert.strictEqual(regionDirection(0.1, 0.2, 0.2, 0.2), "neutral");
  });
});

describe("market-heat-swfl — display rescale", () => {
  test("tilt → 0-100 (50 = balanced)", () => {
    assert.strictEqual(tiltToDisplayScore(0), 50);
    assert.strictEqual(tiltToDisplayScore(1), 100);
    assert.strictEqual(tiltToDisplayScore(-1), 0);
  });
});

describe("market-heat-swfl — falsifier watch", () => {
  test("pending falling 2 months while inventory rises → true", () => {
    const rows = [
      { pending_ratio: 0.16, active_listing_count: 180 },
      { pending_ratio: 0.13, active_listing_count: 190 },
      { pending_ratio: 0.1, active_listing_count: 200 },
    ] as never[];
    assert.strictEqual(zipExhibitsFalsifier(rows), true);
  });

  test("pending rising → false", () => {
    const rows = [
      { pending_ratio: 0.2, active_listing_count: 320 },
      { pending_ratio: 0.22, active_listing_count: 310 },
      { pending_ratio: 0.25, active_listing_count: 300 },
    ] as never[];
    assert.strictEqual(zipExhibitsFalsifier(rows), false);
  });

  test("fewer than 3 months → false", () => {
    assert.strictEqual(zipExhibitsFalsifier([{} as never]), false);
  });
});

// ── Sources + integration ─────────────────────────────────────────────────────

describe("market-heat-swfl sources", () => {
  test("core fixture returns rows", () => {
    assert.ok(coreFragments.length > 0, "core fixture is empty");
  });
  test("hotness fixture returns rows", () => {
    assert.ok(hotnessFragments.length > 0, "hotness fixture is empty");
  });
});

describe("market-heat-swfl outputProducer", () => {
  test("returns a valid direction", () => {
    marketHeatSwfl.corpusSummary!(allFragments);
    const r = marketHeatSwfl.outputProducer!({} as never);
    assert.ok(["bullish", "bearish", "neutral", "mixed"].includes(r.direction));
  });

  test("emits exactly 5 key_metrics", () => {
    marketHeatSwfl.corpusSummary!(allFragments);
    const r = marketHeatSwfl.outputProducer!({} as never);
    assert.strictEqual(r.key_metrics.length, 5);
  });

  test("percent metrics are on the 0-100 scale (×100), not raw fractions", () => {
    marketHeatSwfl.corpusSummary!(allFragments);
    const r = marketHeatSwfl.outputProducer!({} as never);
    // median active_yy across scored {−0.15, 0.30, −0.05} = −0.05 → −5.0%
    const inv = r.key_metrics.find((m) => m.metric === "market_heat_inventory_yy_swfl")!;
    assert.ok(Math.abs((inv.value as number) - -5.0) < 0.01, `expected ≈ −5, got ${inv.value}`);
  });

  test("detail table has a row per ZIP (scored + suppressed), with vote nulled on suppressed", () => {
    marketHeatSwfl.corpusSummary!(allFragments);
    const r = marketHeatSwfl.outputProducer!({} as never);
    const rows = r.detail_tables![0]!.rows;
    assert.strictEqual(rows.length, 5, "3 scored + 2 suppressed");
    const z33905 = rows.find((x) => x.key === "33905")!;
    assert.strictEqual(z33905.cells.market_heat_score, null);
    assert.strictEqual(z33905.cells.suppressed_reason, "insufficient_signals");
    const z33990 = rows.find((x) => x.key === "33990")!;
    assert.strictEqual(z33990.cells.suppressed_reason, "quality_flag");
  });

  test("tightening ZIP scores >50, loosening ZIP <50", () => {
    marketHeatSwfl.corpusSummary!(allFragments);
    const r = marketHeatSwfl.outputProducer!({} as never);
    const rows = r.detail_tables![0]!.rows;
    assert.ok((rows.find((x) => x.key === "33901")!.cells.market_heat_score as number) > 50);
    assert.ok((rows.find((x) => x.key === "34102")!.cells.market_heat_score as number) < 50);
  });

  test("conclusion carries the [INFERENCE] forward thesis + falsifier", () => {
    marketHeatSwfl.corpusSummary!(allFragments);
    const r = marketHeatSwfl.outputProducer!({} as never);
    assert.ok(r.conclusion.includes("[INFERENCE]"));
    assert.ok(/falsif/i.test(r.conclusion));
  });

  test("falsifier-watch caveat fires for 34102 (pending↓ while inventory↑)", () => {
    marketHeatSwfl.corpusSummary!(allFragments);
    const r = marketHeatSwfl.outputProducer!({} as never);
    assert.ok(r.caveats.some((c) => /Falsifier watch: 1 scored/i.test(c)));
  });

  test("list-side-only caveat is always present", () => {
    marketHeatSwfl.corpusSummary!(allFragments);
    const r = marketHeatSwfl.outputProducer!({} as never);
    assert.ok(r.caveats.some((c) => /no closed\/sold prices/i.test(c)));
  });
});

// ── Hotness inertness: permuting hotness must NOT move direction/magnitude ─────

describe("market-heat-swfl — hotness is a relative descriptor, never the vote", () => {
  test("mutating every hotness value leaves direction + magnitude unchanged", () => {
    marketHeatSwfl.corpusSummary!(allFragments);
    const base = marketHeatSwfl.outputProducer!({} as never);

    const mutated = allFragments.map((f) => {
      if (f.source_id !== "realtor_market_heat_hotness_swfl") return f;
      const n = f.normalized as Record<string, unknown>;
      return {
        ...f,
        normalized: {
          ...n,
          hotness_score: 999,
          supply_score: 999,
          demand_score: 999,
          hotness_rank: 1,
          median_dom_vs_us: 9,
        },
      };
    });
    marketHeatSwfl.corpusSummary!(mutated as RawFragment[]);
    const after = marketHeatSwfl.outputProducer!({} as never);

    assert.strictEqual(after.direction, base.direction, "hotness must not move direction");
    assert.strictEqual(after.magnitude, base.magnitude, "hotness must not move magnitude");
  });
});

describe("market-heat-swfl — empty tolerance", () => {
  test("zero fragments → neutral, no throw", () => {
    marketHeatSwfl.corpusSummary!([]);
    const r = marketHeatSwfl.outputProducer!({} as never);
    assert.strictEqual(r.direction, "neutral");
    assert.strictEqual(r.magnitude, 0);
    assert.strictEqual(r.key_metrics.length, 0);
  });
});

describe("regionMonthlyTrend", () => {
  // helper: build a coreByZip fixture from [zip, month, active, dom, pending] tuples
  function build(tuples: Array<[string, string, number | null, number | null, number | null]>) {
    const m = new Map<string, Map<string, MarketHeatCoreRow>>();
    for (const [zip, month, active, dom, pending] of tuples) {
      if (!m.has(zip)) m.set(zip, new Map());
      m.get(zip)!.set(month, {
        zip_code: zip,
        month,
        active_listing_count: active,
        median_days_on_market: dom,
        pending_ratio: pending,
      } as MarketHeatCoreRow);
    }
    return m;
  }

  test("returns one ascending row per month, region median across ZIPs", () => {
    const core = build([
      ["33901", "2026-01", 100, 40, 0.5],
      ["33902", "2026-01", 200, 60, 0.7],
      ["33901", "2026-02", 110, 30, 0.6],
      ["33902", "2026-02", 210, 50, 0.8],
    ]);
    const out = regionMonthlyTrend(core);
    assert.deepStrictEqual(
      out.map((p) => p.month),
      ["2026-01", "2026-02"],
    );
    assert.strictEqual(out[0]!.active, 150); // median(100,200)
    assert.strictEqual(out[0]!.dom, 50); // median(40,60)
    assert.strictEqual(out[1]!.pending, 0.7); // median(0.6,0.8)
  });

  test("null-safe: a null ZIP value is dropped from that month's median, not zeroed", () => {
    const core = build([
      ["33901", "2026-01", null, 40, 0.5],
      ["33902", "2026-01", 200, 60, 0.7],
    ]);
    const out = regionMonthlyTrend(core);
    assert.strictEqual(out[0]!.active, 200); // only the non-null value
  });

  test("all-null metric for a month emits null (never fabricated)", () => {
    const core = build([["33901", "2026-01", null, null, null]]);
    assert.strictEqual(regionMonthlyTrend(core)[0]!.active, null);
  });

  test("caps to the last N months", () => {
    const tuples = Array.from({ length: 40 }, (_, i) => {
      const mm = String((i % 12) + 1).padStart(2, "0");
      const yy = 2020 + Math.floor(i / 12);
      return ["33901", `${yy}-${mm}`, i, i, i / 100] as [string, string, number, number, number];
    });
    assert.strictEqual(regionMonthlyTrend(build(tuples), 36).length, 36);
  });

  test("empty input returns []", () => {
    assert.deepStrictEqual(regionMonthlyTrend(new Map()), []);
  });
});
