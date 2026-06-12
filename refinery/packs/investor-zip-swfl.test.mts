import { describe, it, expect } from "vitest";
import type { BrainOutput, BrainOutputDetailRow } from "../types/brain-output.mts";
import { buildSnapshot, investorZipSwfl } from "./investor-zip-swfl.mts";

// ── Synthetic upstream builders ──────────────────────────────────────────────
// buildSnapshot only reads detail_tables (value/rent) + key_metrics (flood), so
// we hand-build minimal BrainOutputs and cast through unknown.

function valueRow(
  zip: string,
  home_value_zhvi: number | null,
  city: string | null = null,
): BrainOutputDetailRow {
  return {
    key: zip,
    label: zip,
    cells: { home_value_zhvi, value_yoy_pct: 5, city, latest_period: "2026-04-30" },
  };
}

function rentRow(zip: string, rent_index_latest: number | null): BrainOutputDetailRow {
  return {
    key: zip,
    label: zip,
    cells: { rent_index_latest, rent_yoy_pct: 3, latest_period: "2026-04-30" },
  };
}

function valueOutput(rows: BrainOutputDetailRow[]): BrainOutput {
  return {
    detail_tables: [
      { id: "home_values_by_zip", title: "v", grain: "zip", columns: [], rows, source: {} },
    ],
    key_metrics: [],
  } as unknown as BrainOutput;
}

function rentOutput(rows: BrainOutputDetailRow[]): BrainOutput {
  return {
    detail_tables: [
      { id: "rentals_by_zip", title: "r", grain: "zip", columns: [], rows, source: {} },
    ],
    key_metrics: [],
  } as unknown as BrainOutput;
}

/** env-swfl exposes per-ZIP flood via key_metrics keyed by exact slug. */
function envOutput(
  flood: Record<string, { bps: number; pct: number; barrier: number; aal: number }>,
): BrainOutput {
  const key_metrics = Object.entries(flood).flatMap(([zip, f]) => [
    {
      metric: `swfl_zip_${zip}_flood_cap_rate_adj_bps`,
      value: f.bps,
      direction: "stable",
      label: "",
      variable_type: "intensive",
    },
    {
      metric: `swfl_zip_${zip}_flood_aal_pct_swfl_rank`,
      value: f.pct,
      direction: "stable",
      label: "",
      variable_type: "intensive",
    },
    {
      metric: `swfl_zip_${zip}_barrier_island_score`,
      value: f.barrier,
      direction: "stable",
      label: "",
      variable_type: "intensive",
    },
    {
      metric: `swfl_zip_${zip}_flood_aal_usd_per_insured_property`,
      value: f.aal,
      direction: "stable",
      label: "",
      variable_type: "extensive",
    },
  ]);
  return { detail_tables: [], key_metrics } as unknown as BrainOutput;
}

// In-scope SWFL ZIPs used below: 33931 (Lee/FMB), 34102 (Collier/Naples),
// 34135 (Lee/Bonita). Out-of-scope: 34216 (Manatee, North Port MSA spillover).

describe("investor-zip-swfl buildSnapshot — the join contract", () => {
  it("full card: value + rent + flood -> gross yield AND flood-adjusted cap rate computed", () => {
    const snap = buildSnapshot(
      valueOutput([valueRow("33931", 680000, "Fort Myers Beach")]),
      rentOutput([rentRow("33931", 3200)]),
      envOutput({ "33931": { bps: 60, pct: 99, barrier: 1, aal: 30074 } }),
    );
    expect(snap.cards_covered).toBe(1);
    const c = snap.cards[0]!;
    // gross yield = 3200*12/680000*100 = 5.6470...
    expect(c.gross_rent_yield_pct).toBeCloseTo(5.647, 2);
    // flood-adjusted = 5.647 - 60/100 = 5.047
    expect(c.flood_adj_cap_rate_pct).toBeCloseTo(5.047, 2);
    expect(c.flood_cap_rate_adj_bps).toBe(60);
    expect(c.nfip_pct_rank).toBe(99);
    expect(c.barrier_island_score).toBe(1);
    expect(c.flood_aal_usd).toBe(30074);
    expect(snap.cards_with_flood_overlay).toBe(1);
  });

  it("value + rent, NO flood -> yield computed, flood fields null, card still emitted (LEFT join)", () => {
    const snap = buildSnapshot(
      valueOutput([valueRow("34135", 600000)]),
      rentOutput([rentRow("34135", 2400)]),
      envOutput({}), // env surfaces no ZIP
    );
    expect(snap.cards_covered).toBe(1);
    const c = snap.cards[0]!;
    expect(c.gross_rent_yield_pct).toBeCloseTo(4.8, 5);
    expect(c.flood_cap_rate_adj_bps).toBeNull();
    expect(c.flood_adj_cap_rate_pct).toBeNull();
    expect(snap.cards_with_flood_overlay).toBe(0);
  });

  it("value only, NO rent -> yield null (no divide-by-zero), card still emitted", () => {
    const snap = buildSnapshot(
      valueOutput([valueRow("34102", 1300000)]),
      rentOutput([]),
      envOutput({}),
    );
    expect(snap.cards_covered).toBe(1);
    const c = snap.cards[0]!;
    expect(c.home_value_zhvi).toBe(1300000);
    expect(c.rent_index_latest).toBeNull();
    expect(c.gross_rent_yield_pct).toBeNull();
    expect(c.flood_adj_cap_rate_pct).toBeNull();
  });

  it("rent only, NO value -> yield null, card emitted", () => {
    const snap = buildSnapshot(
      valueOutput([]),
      rentOutput([rentRow("34135", 2400)]),
      envOutput({}),
    );
    expect(snap.cards_covered).toBe(1);
    expect(snap.cards[0]!.gross_rent_yield_pct).toBeNull();
  });

  it("value = 0 -> yield null (guards divide-by-zero, no Infinity/NaN)", () => {
    const snap = buildSnapshot(
      valueOutput([valueRow("34135", 0)]),
      rentOutput([rentRow("34135", 2400)]),
      envOutput({}),
    );
    const c = snap.cards[0]!;
    expect(c.gross_rent_yield_pct).toBeNull();
    expect(Number.isFinite(c.gross_rent_yield_pct as never)).toBe(false);
  });

  it("out-of-scope ZIP (34216 Manatee) is dropped at the canonical scope gate", () => {
    const snap = buildSnapshot(
      valueOutput([valueRow("34216", 700000), valueRow("33931", 680000)]),
      rentOutput([rentRow("34216", 3000), rentRow("33931", 3200)]),
      envOutput({}),
    );
    expect(snap.cards.map((c) => c.zip)).toEqual(["33931"]); // 34216 dropped
  });

  it("exact-key flood join: another ZIP's flood slug does NOT leak into this card", () => {
    const snap = buildSnapshot(
      valueOutput([valueRow("34135", 600000)]),
      rentOutput([rentRow("34135", 2400)]),
      // env surfaces 33931, NOT 34135
      envOutput({ "33931": { bps: 60, pct: 99, barrier: 1, aal: 30074 } }),
    );
    const c = snap.cards.find((x) => x.zip === "34135")!;
    expect(c.flood_cap_rate_adj_bps).toBeNull(); // no leak from 33931
  });

  it("env-only ZIP (flood but no value/rent) is NOT carded (anchored on value+rent)", () => {
    const snap = buildSnapshot(
      valueOutput([valueRow("33931", 680000)]),
      rentOutput([rentRow("33931", 3200)]),
      envOutput({
        "33931": { bps: 60, pct: 99, barrier: 1, aal: 30074 },
        "34102": { bps: 27.5, pct: 80, barrier: 0.5, aal: 12000 }, // no value/rent
      }),
    );
    expect(snap.cards.map((c) => c.zip)).toEqual(["33931"]);
  });

  it("no upstream data -> zero cards, no throw", () => {
    const snap = buildSnapshot(null, null, null);
    expect(snap.cards_covered).toBe(0);
    expect(snap.regional_median_gross_yield_pct).toBeNull();
  });

  it("regional medians computed over the right populations", () => {
    const snap = buildSnapshot(
      valueOutput([valueRow("33931", 680000), valueRow("34135", 600000)]),
      rentOutput([rentRow("33931", 3400), rentRow("34135", 2400)]),
      envOutput({ "33931": { bps: 60, pct: 99, barrier: 1, aal: 30074 } }),
    );
    expect(snap.cards_covered).toBe(2);
    expect(snap.cards_with_flood_overlay).toBe(1); // only 33931 has flood
    // both have yields; flood-adj median is over the single flood card
    expect(snap.regional_median_gross_yield_pct).not.toBeNull();
    expect(snap.regional_median_flood_adj_cap_rate_pct).not.toBeNull();
  });
});

// ── Plausibility band (vacation/seasonal index-disparity guard) ─────────────

describe("investor-zip-swfl gross-yield plausibility band (2-12%)", () => {
  it("yield ABOVE 12% (FMB-like) is suppressed: yield + flood-adj cap nulled, raw facts kept", () => {
    const snap = buildSnapshot(
      valueOutput([valueRow("33931", 495479, "Fort Myers Beach")]),
      rentOutput([rentRow("33931", 14703)]), // 14703*12/495479*100 = 35.6%
      envOutput({ "33931": { bps: 60, pct: 99.13, barrier: 1, aal: 30074 } }),
    );
    const c = snap.cards[0]!;
    expect(c.gross_rent_yield_pct).toBeNull();
    expect(c.flood_adj_cap_rate_pct).toBeNull();
    expect(c.yield_flag).toMatch(/unassessable|disparity/i);
    // raw value/rent/flood facts are RETAINED (operator: keep the honest numbers)
    expect(c.home_value_zhvi).toBe(495479);
    expect(c.rent_index_latest).toBe(14703);
    expect(c.flood_cap_rate_adj_bps).toBe(60);
    expect(c.nfip_pct_rank).toBe(99.13);
    expect(snap.cards_with_flood_overlay).toBe(0); // suppressed, not counted
  });

  it("yield INSIDE the band (Naples 7.3%) is kept and flood-adjusted cap computed", () => {
    const snap = buildSnapshot(
      valueOutput([valueRow("34102", 1300000)]),
      rentOutput([rentRow("34102", 7907)]), // 7.3%
      envOutput({ "34102": { bps: 27.5, pct: 80, barrier: 0.5, aal: 12000 } }),
    );
    const c = snap.cards[0]!;
    expect(c.gross_rent_yield_pct).toBeCloseTo(7.3, 1);
    expect(c.yield_flag).toBeNull();
    expect(c.flood_adj_cap_rate_pct).toBeCloseTo(7.3 - 0.275, 1);
    expect(snap.cards_with_flood_overlay).toBe(1);
  });

  it("yield BELOW 2% is suppressed", () => {
    const snap = buildSnapshot(
      valueOutput([valueRow("34102", 5000000)]),
      rentOutput([rentRow("34102", 5000)]), // 1.2%
      envOutput({}),
    );
    const c = snap.cards[0]!;
    expect(c.gross_rent_yield_pct).toBeNull();
    expect(c.yield_flag).not.toBeNull();
  });

  it("exactly at the 12% boundary is kept (inclusive band)", () => {
    const snap = buildSnapshot(
      valueOutput([valueRow("34102", 1000000)]),
      rentOutput([rentRow("34102", 10000)]), // 10000*12/1000000*100 = 12.0%
      envOutput({}),
    );
    expect(snap.cards[0]!.gross_rent_yield_pct).toBeCloseTo(12, 5);
    expect(snap.cards[0]!.yield_flag).toBeNull();
  });
});

// ── PackDefinition contract ────────────────────────────────────────────────

describe("investor-zip-swfl PackDefinition", () => {
  it("declares the three upstreams and opts out of LLM agents", () => {
    expect(investorZipSwfl.id).toBe("investor-zip-swfl");
    expect(investorZipSwfl.input_brains.map((b) => b.id).sort()).toEqual([
      "env-swfl",
      "home-values-swfl",
      "rentals-swfl",
    ]);
    expect(investorZipSwfl.sources.length).toBe(3);
    expect(investorZipSwfl.skipTriageAgent).toBe(true);
    expect(investorZipSwfl.skipSynthesisAgent).toBe(true);
  });
});
