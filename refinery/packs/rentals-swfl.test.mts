import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { ZoriZipRow } from "../sources/zori-source.mts";
import {
  buildSnapshot,
  classifyPolarity,
  rentalsSwfl,
} from "./rentals-swfl.mts";
import { env } from "../config/env.mts";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a 13-month series for a single ZIP that yields a target rent_yoy_pct
 * at the latest period. We anchor `t-12 = 1000` and set `t = 1000 * (1 + yoy/100)`.
 * Intermediate months are linearly interpolated — they don't affect the YoY
 * calculation but keep the series realistic.
 */
function buildZipSeries(
  zip_code: string,
  yoy_pct: number,
  metro = "Cape Coral-Fort Myers, FL",
): ZoriZipRow[] {
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
  const base = 1000;
  const tip = base * (1 + yoy_pct / 100);
  const step = (tip - base) / 12;
  return months.map((period_end, i) => ({
    zip_code,
    period_end,
    rent_index: base + step * i,
    metro,
    county_name: "Lee County",
    city: "Test City",
  }));
}

/**
 * Build a corpus of N ZIPs each at the same target YoY so the regional
 * median lands exactly on `target`.
 */
function bandFixture(yoy_pct: number, n = 5): ZoriZipRow[] {
  const rows: ZoriZipRow[] = [];
  for (let i = 0; i < n; i++) {
    const zip = String(34000 + i).padStart(5, "0");
    rows.push(...buildZipSeries(zip, yoy_pct));
  }
  return rows;
}

// ── classifyPolarity (pure) — five bands ─────────────────────────────────────

describe("rentals-swfl classifyPolarity (locked polarity table)", () => {
  it("< 0%  -> bearish, no caveat", () => {
    const v = classifyPolarity(-3);
    expect(v.direction).toBe("bearish");
    expect(v.caveats).toEqual([]);
    expect(v.magnitude).toBeCloseTo(0.3, 5);
  });

  it("[0, 2) -> neutral + sub-inflation caveat", () => {
    const v = classifyPolarity(1.2);
    expect(v.direction).toBe("neutral");
    expect(v.caveats[0]).toMatch(/sub-inflation/i);
  });

  it("[2, 6] -> bullish, no caveat", () => {
    const v = classifyPolarity(4.2);
    expect(v.direction).toBe("bullish");
    expect(v.caveats).toEqual([]);
  });

  it("(6, 10] -> bullish + durability caveat", () => {
    const v = classifyPolarity(8.0);
    expect(v.direction).toBe("bullish");
    expect(v.caveats[0]).toMatch(/durability/i);
  });

  it("> 10% -> neutral + regime-shift caveat", () => {
    const v = classifyPolarity(12.5);
    expect(v.direction).toBe("neutral");
    expect(v.caveats[0]).toMatch(/2021-22|exceeds wage growth/i);
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

describe("rentals-swfl buildSnapshot", () => {
  it("computes regional median YoY across a synthetic fixture", () => {
    const rows = bandFixture(4, 5);
    const snap = buildSnapshot(rows);
    expect(snap).not.toBeNull();
    expect(snap!.zips_covered).toBe(5);
    expect(snap!.zips_with_yoy).toBe(5);
    expect(snap!.regional_median_yoy_pct).toBeCloseTo(4, 5);
    expect(snap!.regional_latest_period).toBe("2026-04-30");
  });

  it("returns null on empty input", () => {
    const snap = buildSnapshot([]);
    expect(snap).toBeNull();
  });

  it("handles ZIPs with no 12-month history (YoY null)", () => {
    const rows: ZoriZipRow[] = [
      {
        zip_code: "34999",
        period_end: "2026-04-30",
        rent_index: 2000,
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

describe("rentals-swfl outputProducer (fixture mode)", () => {
  const orig = env.source;
  beforeAll(() => {
    process.env.REFINERY_SOURCE = "fixture";
  });
  afterAll(() => {
    process.env.REFINERY_SOURCE = orig === "fixture" ? "fixture" : undefined!;
  });

  function runProducerForBand(yoy_pct: number) {
    // Drive corpusSummary directly to set the module-level snapshot.
    const fragments = bandFixture(yoy_pct, 5).map((row, i) => ({
      fragment_id: `test_${row.zip_code}_${row.period_end}_${i}`,
      source_id: "zori_swfl",
      source_trust_tier: 3 as const,
      fetched_at: "2026-05-23T12:00:00Z",
      // RawFragment.raw is typed Record<string, unknown>; ZoriZipRow lacks
      // an index signature so we widen through unknown.
      raw: row as unknown as Record<string, unknown>,
      normalized: row,
    }));
    rentalsSwfl.corpusSummary!(fragments);
    return rentalsSwfl.outputProducer!({} as never);
  }

  it("returns BrainOutputProducerResult with locked-enum direction", () => {
    const result = runProducerForBand(4);
    expect(["bullish", "bearish", "neutral", "mixed"]).toContain(
      result.direction,
    );
  });

  it("polarity band: bearish (-3% YoY)", () => {
    const result = runProducerForBand(-3);
    expect(result.direction).toBe("bearish");
    expect(result.caveats.every((c) => !/sub-inflation/i.test(c))).toBe(true);
  });

  it("polarity band: neutral-low (+1% YoY) emits sub-inflation caveat", () => {
    const result = runProducerForBand(1);
    expect(result.direction).toBe("neutral");
    expect(result.caveats.some((c) => /sub-inflation/i.test(c))).toBe(true);
  });

  it("polarity band: bullish (+4% YoY)", () => {
    const result = runProducerForBand(4);
    expect(result.direction).toBe("bullish");
    expect(
      result.caveats.every((c) => !/wage trend|sub-inflation|2021-22/i.test(c)),
    ).toBe(true);
  });

  it("polarity band: bullish-with-caveat (+8% YoY)", () => {
    const result = runProducerForBand(8);
    expect(result.direction).toBe("bullish");
    expect(result.caveats.some((c) => /durability|wage trend/i.test(c))).toBe(
      true,
    );
  });

  it("polarity band: neutral-high (+15% YoY) emits regime-shift caveat", () => {
    const result = runProducerForBand(15);
    expect(result.direction).toBe("neutral");
    expect(
      result.caveats.some((c) => /2021-22|exceeds wage growth/i.test(c)),
    ).toBe(true);
  });

  it("emits magnitude in [0, 1]", () => {
    const result = runProducerForBand(6);
    expect(result.magnitude).toBeGreaterThanOrEqual(0);
    expect(result.magnitude).toBeLessThanOrEqual(1);
  });

  it("emits the regional median + rent + coverage as required key_metrics", () => {
    const result = runProducerForBand(4);
    const ids = result.key_metrics.map((m) => m.metric);
    expect(ids).toContain("rental_rent_yoy_pct_regional_median");
    expect(ids).toContain("rental_rent_index_zori_regional_median");
    expect(ids).toContain("rentals_swfl_zips_covered");
    expect(ids).toContain("rental_rent_yoy_pct_top_heating_zips");
  });

  it("every key_metric carries a populated source block (url/tier/citation/fetched_at)", () => {
    const result = runProducerForBand(4);
    for (const m of result.key_metrics) {
      expect(m.source).toBeDefined();
      expect(m.source.url).toMatch(/zillowstatic\.com|fixture/i);
      expect(m.source.tier).toBe(3);
      expect(m.source.citation).toMatch(/ZORI|Zillow Observed Rent Index/i);
      expect(typeof m.source.fetched_at).toBe("string");
    }
  });

  it("emits per-ZIP rental_rent_yoy_pct_zip_* metrics (patterns hook coverage)", () => {
    const result = runProducerForBand(4);
    const perZip = result.key_metrics.filter((m) =>
      /^rental_rent_yoy_pct_zip_\d{5}$/.test(m.metric),
    );
    expect(perZip.length).toBeGreaterThan(0);
  });

  it("caveats count stays within the spec ceiling (<=4)", () => {
    const result = runProducerForBand(8);
    expect(result.caveats.length).toBeLessThanOrEqual(4);
  });

  it("does NOT set confidence (Stage 4 owns it)", () => {
    const result = runProducerForBand(4);
    expect((result as { confidence?: number }).confidence).toBeUndefined();
  });

  it("leaf brain: drivers is empty (no input_brains)", () => {
    const result = runProducerForBand(4);
    expect(result.drivers).toEqual([]);
  });
});

// ── PackDefinition contract ────────────────────────────────────────────────

describe("rentals-swfl PackDefinition", () => {
  it("declares the locked id, domain, and tier-3 source", () => {
    expect(rentalsSwfl.id).toBe("rentals-swfl");
    expect(rentalsSwfl.brain_id).toBe("rentals-swfl");
    expect(rentalsSwfl.domain).toBe("real-estate");
    expect(rentalsSwfl.input_brains).toEqual([]);
    expect(rentalsSwfl.sources.length).toBe(1);
    expect(rentalsSwfl.sources[0]!.trust_tier).toBe(3);
  });

  it("opts out of LLM triage and synthesis (pure deterministic)", () => {
    expect(rentalsSwfl.skipTriageAgent).toBe(true);
    expect(rentalsSwfl.skipSynthesisAgent).toBe(true);
  });
});
