import { describe, expect, test } from "bun:test";
import {
  bucketize,
  dedupeToBestPerKeyword,
  type DemandRow,
  MIN_AVG_MONTHLY_SEARCHES,
  renderDigest,
  risingFromMonthly,
  slugify,
  suggestedCheckLine,
} from "./search-demand.mts";

function row(partial: Partial<DemandRow> & { keyword: string }): DemandRow {
  return {
    source: "dataforseo",
    location: "metro:cape-coral-fort-myers",
    captured_month: "2026-05-01",
    avg_monthly_searches: 100,
    competition: "MEDIUM",
    cpc: 2.0,
    monthly_searches: null,
    is_bucketed: false,
    ...partial,
  };
}

const SHIPPED = new Set([
  "env-swfl",
  "housing-swfl",
  "permits-swfl",
  "cre-swfl",
]);
const CFG = {
  floor: MIN_AVG_MONTHLY_SEARCHES,
  totalFloor: 1000,
  shippedBrains: SHIPPED,
};

describe("bucketize", () => {
  const rows: DemandRow[] = [
    row({ keyword: "cape coral flood insurance", avg_monthly_searches: 320 }), // → env-swfl (shipped) → Sharpen
    row({ keyword: "cape coral golf communities", avg_monthly_searches: 90 }), // SWFL place, no topic → Build
    row({ keyword: "sanibel office space", avg_monthly_searches: 20 }), // below floor → Thin
    row({ keyword: "best pizza near me", avg_monthly_searches: 500 }), // not SWFL → unmapped
    row({
      keyword: "fort myers new construction",
      avg_monthly_searches: 140,
      monthly_searches: [
        { year: 2026, month: 2, search_volume: 80 },
        { year: 2026, month: 3, search_volume: 80 },
        { year: 2026, month: 4, search_volume: 80 },
        { year: 2026, month: 5, search_volume: 120 }, // +50% vs prior-3 mean → Rising
      ],
    }),
  ];
  const b = bucketize(rows, CFG);

  test("Build holds SWFL demand with no shipped brain", () => {
    expect(b.build.map((i) => i.keyword)).toContain(
      "cape coral golf communities",
    );
    expect(b.build.map((i) => i.keyword)).not.toContain(
      "cape coral flood insurance",
    );
  });
  test("Sharpen holds demand on a shipped brain", () => {
    const sharp = b.sharpen.find(
      (i) => i.keyword === "cape coral flood insurance",
    );
    expect(sharp).toBeDefined();
    expect(sharp!.brains).toContain("env-swfl");
  });
  test("Thin holds below-floor terms, no action", () => {
    expect(b.thin.map((i) => i.keyword)).toContain("sanibel office space");
  });
  test("non-SWFL terms are counted unmapped, not bucketed", () => {
    expect(b.unmappedCount).toBe(1);
    const all = [...b.build, ...b.sharpen, ...b.thin].map((i) => i.keyword);
    expect(all).not.toContain("best pizza near me");
  });
  test("Rising surfaces the coarse uptrend", () => {
    expect(b.rising.map((i) => i.keyword)).toContain(
      "fort myers new construction",
    );
    expect(b.rising[0].rising!.pct).toBe(50);
  });
  test("thin-signal banner trips when total mapped volume < floor", () => {
    // 320 + 90 + 140 = 550 < 1000
    expect(b.totalMappedVolume).toBe(550);
    expect(b.banner).toBe(true);
  });
});

describe("dedupeToBestPerKeyword", () => {
  test("keeps the freshest month, then the highest-volume location", () => {
    const rows = [
      row({
        keyword: "x",
        captured_month: "2026-04-01",
        avg_monthly_searches: 300,
      }),
      row({
        keyword: "x",
        captured_month: "2026-05-01",
        avg_monthly_searches: 320,
        location: "state:fl",
      }),
      row({
        keyword: "x",
        captured_month: "2026-05-01",
        avg_monthly_searches: 280,
        location: "metro:naples-marco-island",
      }),
    ];
    const out = dedupeToBestPerKeyword(rows);
    expect(out).toHaveLength(1);
    expect(out[0].avg_monthly_searches).toBe(320);
    expect(out[0].location).toBe("state:fl");
  });
});

describe("risingFromMonthly", () => {
  test("needs 4+ months and a 25%+ jump over both-above-floor windows", () => {
    expect(risingFromMonthly(null, 50)).toBeNull();
    expect(
      risingFromMonthly(
        [
          { year: 2026, month: 2, search_volume: 80 },
          { year: 2026, month: 3, search_volume: 80 },
          { year: 2026, month: 4, search_volume: 80 },
          { year: 2026, month: 5, search_volume: 85 }, // only +6% → not rising
        ],
        50,
      ),
    ).toBeNull();
  });
});

describe("render + suggestions", () => {
  test("digest carries the provenance label and a suggested (not executed) check line", () => {
    const b = bucketize(
      [row({ keyword: "naples gated communities", avg_monthly_searches: 110 })],
      CFG,
    );
    const md = renderDigest(b, {
      floor: MIN_AVG_MONTHLY_SEARCHES,
      date: "2026-06-03",
    });
    expect(md).toContain("demand proxy — NOT our site's engagement");
    expect(md).toContain("node scripts/check.mjs open roadmap");
  });
  test("slugify + suggested key are safe", () => {
    expect(slugify("Cape Coral Flood Insurance!")).toBe(
      "cape-coral-flood-insurance",
    );
    const line = suggestedCheckLine({
      keyword: "naples gated communities",
      volume: 110,
      location: "state:fl",
      competition: "LOW",
      is_bucketed: false,
      source: "dataforseo",
      brains: [],
      topic: null,
      rising: null,
    });
    expect(line).toContain("demand_naples_gated_communities");
  });
});
