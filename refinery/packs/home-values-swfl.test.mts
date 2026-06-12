import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { ZhviZipRow } from "../sources/zhvi-source.mts";
import type { ZhviZipLatestRow } from "../sources/zhvi-zip-latest-source.mts";
import { buildSnapshot, classifyPolarity, homeValuesSwfl } from "./home-values-swfl.mts";
import { env } from "../config/env.mts";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a 13-month series for a single ZIP that yields a target value_yoy_pct
 * at the latest period. We anchor `t-12 = base` and set `t = base * (1 + yoy/100)`.
 */
function buildZipSeries(
  zip_code: string,
  yoy_pct: number,
  metro = "Cape Coral-Fort Myers, FL",
): ZhviZipRow[] {
  const months = [
    "2025-04-30",
    "2025-05-31",
    "2025-06-30",
    "2025-07-31",
    "2025-08-31",
    "2025-09-30",
    "2025-10-31",
    "2025-11-30",
    "2025-12-31",
    "2026-01-31",
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
  ];
  const base = 500000;
  const tip = base * (1 + yoy_pct / 100);
  const step = (tip - base) / 12;
  return months.map((period_end, i) => ({
    zip_code,
    period_end,
    home_value: base + step * i,
    metro,
    county_name: "Lee County",
    city: "Test City",
  }));
}

function bandFixture(yoy_pct: number, n = 5): ZhviZipRow[] {
  const rows: ZhviZipRow[] = [];
  for (let i = 0; i < n; i++) {
    const zip = String(34000 + i).padStart(5, "0");
    rows.push(...buildZipSeries(zip, yoy_pct));
  }
  return rows;
}

// ── classifyPolarity (pure) — five bands ─────────────────────────────────────

describe("home-values-swfl classifyPolarity (locked polarity table)", () => {
  it("< 0%  -> bearish, no caveat", () => {
    const v = classifyPolarity(-3);
    expect(v.direction).toBe("bearish");
    expect(v.caveats).toEqual([]);
    expect(v.magnitude).toBeCloseTo(0.2, 5);
  });

  it("[0, 3) -> neutral + sub-inflation caveat", () => {
    const v = classifyPolarity(2.0);
    expect(v.direction).toBe("neutral");
    expect(v.caveats[0]).toMatch(/sub-inflation/i);
  });

  it("[3, 10] -> bullish, no caveat", () => {
    const v = classifyPolarity(6.0);
    expect(v.direction).toBe("bullish");
    expect(v.caveats).toEqual([]);
  });

  it("(10, 15] -> bullish + durability caveat", () => {
    const v = classifyPolarity(12.0);
    expect(v.direction).toBe("bullish");
    expect(v.caveats[0]).toMatch(/durability/i);
  });

  it("> 15% -> neutral + regime-shift caveat", () => {
    const v = classifyPolarity(18.0);
    expect(v.direction).toBe("neutral");
    expect(v.caveats[0]).toMatch(/2021-22|above wage growth/i);
  });

  it("null YoY -> neutral + insufficient-data caveat, mag 0", () => {
    const v = classifyPolarity(null);
    expect(v.direction).toBe("neutral");
    expect(v.magnitude).toBe(0);
    expect(v.caveats.length).toBeGreaterThan(0);
  });

  it("magnitude is clamped at 1 for extreme YoY", () => {
    const v = classifyPolarity(50);
    expect(v.magnitude).toBe(1);
  });
});

// ── buildSnapshot ───────────────────────────────────────────────────────────

describe("home-values-swfl buildSnapshot", () => {
  it("computes regional median YoY across a synthetic fixture", () => {
    const rows = bandFixture(6, 5);
    const snap = buildSnapshot(rows);
    expect(snap).not.toBeNull();
    expect(snap!.zips_covered).toBe(5);
    expect(snap!.zips_with_yoy).toBe(5);
    expect(snap!.regional_median_yoy_pct).toBeCloseTo(6, 5);
    expect(snap!.regional_latest_period).toBe("2026-04-30");
  });

  it("returns null on empty input", () => {
    const snap = buildSnapshot([]);
    expect(snap).toBeNull();
  });

  it("handles ZIPs with no 12-month history (YoY null)", () => {
    const rows: ZhviZipRow[] = [
      {
        zip_code: "34999",
        period_end: "2026-04-30",
        home_value: 700000,
        metro: "Cape Coral-Fort Myers, FL",
        county_name: "Lee County",
        city: "Short Series",
      },
    ];
    const snap = buildSnapshot(rows);
    expect(snap).not.toBeNull();
    expect(snap!.zips_with_yoy).toBe(0);
    expect(snap!.regional_median_yoy_pct).toBeNull();
  });
});

// ── outputProducer — end-to-end through corpusSummary handoff ───────────────

/** Build N view-shaped rows (one per ZIP) with a pre-computed YoY. */
function bandViewFixture(yoy_pct: number, n = 5): ZhviZipLatestRow[] {
  return Array.from({ length: n }, (_, i) => ({
    zip_code: String(34000 + i).padStart(5, "0"),
    metro: "Cape Coral-Fort Myers, FL",
    county_name: "Lee County",
    city: "Test City",
    latest_period: "2026-04-30",
    home_value_latest: 500000,
    value_yoy_pct: yoy_pct,
    value_mom_pct: 0.5,
  }));
}

describe("home-values-swfl outputProducer (fixture mode)", () => {
  const orig = env.source;
  beforeAll(() => {
    process.env.REFINERY_SOURCE = "fixture";
  });
  afterAll(() => {
    process.env.REFINERY_SOURCE = orig === "fixture" ? "fixture" : undefined!;
  });

  function runProducerForBand(yoy_pct: number) {
    const fragments = bandViewFixture(yoy_pct, 5).map((row) => ({
      fragment_id: `test_${row.zip_code}`,
      source_id: "zhvi_zip_latest",
      source_trust_tier: 3 as const,
      fetched_at: "2026-05-23T12:00:00Z",
      raw: { zip_code: row.zip_code, latest_period: row.latest_period } as Record<string, unknown>,
      normalized: row,
    }));
    homeValuesSwfl.corpusSummary!(fragments);
    return homeValuesSwfl.outputProducer!({} as never);
  }

  it("returns BrainOutputProducerResult with locked-enum direction", () => {
    const result = runProducerForBand(6);
    expect(["bullish", "bearish", "neutral", "mixed"]).toContain(result.direction);
  });

  it("polarity band: bearish (-3% YoY)", () => {
    const result = runProducerForBand(-3);
    expect(result.direction).toBe("bearish");
    expect(result.caveats.every((c) => !/sub-inflation/i.test(c))).toBe(true);
  });

  it("polarity band: neutral-low (+2% YoY) emits sub-inflation caveat", () => {
    const result = runProducerForBand(2);
    expect(result.direction).toBe("neutral");
    expect(result.caveats.some((c) => /sub-inflation/i.test(c))).toBe(true);
  });

  it("polarity band: bullish (+6% YoY)", () => {
    const result = runProducerForBand(6);
    expect(result.direction).toBe("bullish");
    expect(result.caveats.every((c) => !/durability|sub-inflation|2021-22/i.test(c))).toBe(true);
  });

  it("polarity band: bullish-with-caveat (+12% YoY)", () => {
    const result = runProducerForBand(12);
    expect(result.direction).toBe("bullish");
    expect(result.caveats.some((c) => /durability/i.test(c))).toBe(true);
  });

  it("polarity band: neutral-high (+18% YoY) emits regime-shift caveat", () => {
    const result = runProducerForBand(18);
    expect(result.direction).toBe("neutral");
    expect(result.caveats.some((c) => /2021-22|above wage growth/i.test(c))).toBe(true);
  });

  it("emits magnitude in [0, 1]", () => {
    const result = runProducerForBand(6);
    expect(result.magnitude).toBeGreaterThanOrEqual(0);
    expect(result.magnitude).toBeLessThanOrEqual(1);
  });

  it("emits the regional median + value + coverage as required key_metrics", () => {
    const result = runProducerForBand(6);
    const ids = result.key_metrics.map((m) => m.metric);
    expect(ids).toContain("home_value_yoy_pct_regional_median");
    expect(ids).toContain("home_value_zhvi_regional_median");
    expect(ids).toContain("home_values_zips_covered");
    expect(ids).toContain("home_value_yoy_pct_top_appreciating_zips");
  });

  it("every key_metric carries a populated source block (url/tier/citation/fetched_at)", () => {
    const result = runProducerForBand(6);
    for (const m of result.key_metrics) {
      expect(m.source).toBeDefined();
      expect(m.source.url).toMatch(/zillowstatic\.com|fixture/i);
      expect(m.source.tier).toBe(3);
      expect(m.source.citation).toMatch(/ZHVI|Zillow Home Value Index/i);
      expect(typeof m.source.fetched_at).toBe("string");
    }
  });

  it("emits per-ZIP home_value_yoy_pct_zip_* metrics (patterns hook coverage)", () => {
    const result = runProducerForBand(6);
    const perZip = result.key_metrics.filter((m) =>
      /^home_value_yoy_pct_zip_\d{5}$/.test(m.metric),
    );
    expect(perZip.length).toBeGreaterThan(0);
  });

  it("emits a home_values_by_zip detail_table keyed by zip", () => {
    const result = runProducerForBand(6);
    const dt = result.detail_tables?.find((t) => t.id === "home_values_by_zip");
    expect(dt).toBeDefined();
    expect(dt!.grain).toBe("zip");
    expect(dt!.rows.length).toBe(5);
    expect(dt!.rows[0]!.cells).toHaveProperty("home_value_zhvi");
  });

  it("caveats count stays within the spec ceiling (<=4)", () => {
    const result = runProducerForBand(12);
    expect(result.caveats.length).toBeLessThanOrEqual(4);
  });

  it("does NOT set confidence (Stage 4 owns it)", () => {
    const result = runProducerForBand(6);
    expect((result as { confidence?: number }).confidence).toBeUndefined();
  });

  it("leaf brain: drivers is empty (no input_brains)", () => {
    const result = runProducerForBand(6);
    expect(result.drivers).toEqual([]);
  });
});

// ── PackDefinition contract ────────────────────────────────────────────────

describe("home-values-swfl PackDefinition", () => {
  it("declares the locked id, domain, and tier-3 source", () => {
    expect(homeValuesSwfl.id).toBe("home-values-swfl");
    expect(homeValuesSwfl.brain_id).toBe("home-values-swfl");
    expect(homeValuesSwfl.domain).toBe("real-estate");
    expect(homeValuesSwfl.input_brains).toEqual([]);
    expect(homeValuesSwfl.sources.length).toBe(1);
    expect(homeValuesSwfl.sources[0]!.trust_tier).toBe(3);
  });

  it("opts out of LLM triage and synthesis (pure deterministic)", () => {
    expect(homeValuesSwfl.skipTriageAgent).toBe(true);
    expect(homeValuesSwfl.skipSynthesisAgent).toBe(true);
  });
});
