import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderAllRoles, renderForRole } from "./role-renderer.mts";
import type { BrainOutput, BrainOutputMetric } from "../types/brain-output.mts";

function metric(
  partial: Partial<BrainOutputMetric> &
    Pick<BrainOutputMetric, "metric" | "value" | "label">,
): BrainOutputMetric {
  return {
    direction: "stable",
    source: {
      url: "https://example.test/m/" + partial.metric,
      fetched_at: "2026-05-17T00:00:00Z",
      tier: 2,
      citation: "Example Source for " + partial.metric,
    },
    ...partial,
  };
}

function fixture(overrides: Partial<BrainOutput> = {}): BrainOutput {
  return {
    brain_id: "test-brain",
    version: 1,
    refined_at: "2026-05-17T00:00:00Z",
    direction: "bearish",
    magnitude: 0.85,
    drivers: [
      { brain_id: "cre-swfl", edge_type: "input" },
      { brain_id: "env-swfl", edge_type: "veto" },
    ],
    overrides: ["flood-veto"],
    conclusion:
      "Concrete narrative produced by the synthesis producer. Numbers cited here are 43.24% SFHA and 5.75% V/VE Lee.",
    key_metrics: [
      metric({
        metric: "cre_vacancy_rate",
        value: 0.12,
        label: "CRE Vacancy Rate",
        source: {
          url: "https://census.example/vacancy",
          fetched_at: "2026-05-17T00:00:00Z",
          tier: 1,
          citation: "US Census ACS 5-year vacancy",
        },
      }),
      metric({
        metric: "env_lee_ve_zone_coverage_pct",
        value: 0.0575,
        label: "Lee County V/VE coverage",
      }),
      metric({
        metric: "franchise_overall_survival_rate",
        value: 91.9,
        label: "Franchise survival rate",
      }),
      metric({
        metric: "sector_credit_charge_off_rate",
        value: 0.034,
        label: "Sector credit charge-off",
      }),
    ],
    caveats: ['Override "flood-veto" forced bearish (priority 90)'],
    contradicts: ["cre-swfl (bullish) vs env-swfl (bearish)"],
    confidence: 0.97,
    joint_integrity: 0.85,
    confidence_dispersion: 0.05,
    chain_depth: 1,
    trust_tier: 2,
    upstream_count: 2,
    relevance: {
      decay_curve: "weeks",
      half_life_hours: 720,
      computed_at: "2026-05-17T00:00:00Z",
    },
    ...overrides,
  };
}

describe("role-renderer — invariants", () => {
  test("renders all four built-in roles", () => {
    const all = renderAllRoles(fixture());
    assert.deepStrictEqual(
      Object.keys(all).sort(),
      ["cpa", "cre-broker", "franchise-consultant", "operator"].sort(),
    );
    for (const md of Object.values(all)) {
      assert.ok(md.length > 100, "render is non-trivial");
    }
  });

  test("numbers are quoted verbatim across all roles (no rounding)", () => {
    const out = fixture();
    const all = renderAllRoles(out);
    for (const md of Object.values(all)) {
      assert.ok(md.includes("0.12"));
      assert.ok(md.includes("0.0575"));
      assert.ok(md.includes("91.9"));
      assert.ok(md.includes("0.034"));
      assert.ok(md.includes("0.85"));
    }
  });

  test("conclusion text rendered verbatim in every role", () => {
    const out = fixture();
    const all = renderAllRoles(out);
    for (const md of Object.values(all)) {
      assert.ok(md.includes(out.conclusion));
    }
  });

  test("caveats render ABOVE conclusion when non-empty", () => {
    const out = fixture();
    const md = renderForRole(out, { role: "operator" });
    const caveatIdx = md.indexOf("Caveats (read first)");
    const conclusionIdx = md.indexOf("## Conclusion");
    assert.ok(caveatIdx > -1, "caveats section present");
    assert.ok(conclusionIdx > -1, "conclusion section present");
    assert.ok(caveatIdx < conclusionIdx, "caveats appear before conclusion");
  });

  test("no caveats section when caveats[] is empty", () => {
    const out = fixture({ caveats: [] });
    const md = renderForRole(out, { role: "operator" });
    assert.ok(!md.includes("Caveats"));
  });

  test("veto drivers are marked specially", () => {
    const out = fixture();
    const md = renderForRole(out, { role: "operator" });
    assert.match(md, /`env-swfl`.*\*\*veto\*\*/);
    assert.match(md, /`cre-swfl`.*input/);
  });

  test("contradictions render when non-empty", () => {
    const out = fixture();
    const md = renderForRole(out, { role: "operator" });
    assert.ok(md.includes("Contradictions surfaced"));
    assert.ok(md.includes("cre-swfl (bullish) vs env-swfl (bearish)"));
  });

  test("no contradictions section when contradicts[] is empty", () => {
    const out = fixture({ contradicts: [] });
    const md = renderForRole(out, { role: "operator" });
    assert.ok(!md.includes("Contradictions surfaced"));
  });
});

describe("role-renderer — role-specific behavior", () => {
  test("cre-broker leads with cre_/env_ metrics, defers franchise_/sector_", () => {
    const md = renderForRole(fixture(), { role: "cre-broker" });
    const leadIdx = md.indexOf("Most relevant to your role");
    const additionalIdx = md.indexOf("Additional context");
    assert.ok(leadIdx > -1);
    assert.ok(additionalIdx > leadIdx);
    const leadSection = md.slice(leadIdx, additionalIdx);
    assert.ok(leadSection.includes("CRE Vacancy Rate"));
    assert.ok(leadSection.includes("Lee County V/VE coverage"));
    const restSection = md.slice(additionalIdx);
    assert.ok(restSection.includes("Franchise survival rate"));
    assert.ok(restSection.includes("Sector credit charge-off"));
  });

  test("franchise-consultant leads with franchise_/sector_", () => {
    const md = renderForRole(fixture(), { role: "franchise-consultant" });
    const leadIdx = md.indexOf("Most relevant to your role");
    const additionalIdx = md.indexOf("Additional context");
    assert.ok(leadIdx > -1);
    assert.ok(additionalIdx > leadIdx);
    const leadSection = md.slice(leadIdx, additionalIdx);
    assert.ok(leadSection.includes("Franchise survival rate"));
    assert.ok(leadSection.includes("Sector credit charge-off"));
  });

  test("cpa view tabulates ALL metrics sorted by trust tier ASC", () => {
    const md = renderForRole(fixture(), { role: "cpa" });
    assert.ok(md.includes("Audit Trail"));
    assert.ok(md.includes("| Tier | Metric | Value |"));
    const t1Idx = md.indexOf("| T1 |");
    const t2Idx = md.indexOf("| T2 |");
    assert.ok(t1Idx > -1);
    assert.ok(t2Idx > t1Idx);
    assert.ok(md.includes("CRE Vacancy Rate"));
    assert.ok(md.includes("Lee County V/VE coverage"));
    assert.ok(md.includes("Franchise survival rate"));
    assert.ok(md.includes("Sector credit charge-off"));
  });

  test("operator view renders metrics flat in DAG order (no role lens)", () => {
    const md = renderForRole(fixture(), { role: "operator" });
    assert.ok(!md.includes("Most relevant to your role"));
    assert.ok(!md.includes("Additional context"));
    assert.ok(md.includes("CRE Vacancy Rate"));
    assert.ok(md.includes("Franchise survival rate"));
  });

  test("custom focus_metric_prefixes overrides role defaults", () => {
    const md = renderForRole(fixture(), {
      role: "cre-broker",
      focus_metric_prefixes: ["franchise_"],
    });
    const leadIdx = md.indexOf("Most relevant to your role");
    const additionalIdx = md.indexOf("Additional context");
    const leadSection = md.slice(leadIdx, additionalIdx);
    assert.ok(leadSection.includes("Franchise survival rate"));
    assert.ok(!leadSection.includes("CRE Vacancy Rate"));
  });
});

describe("role-renderer — SKOS-aware category routing", () => {
  test("cre-broker promotes a slug to lead via category lookup even when prefix would miss", () => {
    const out = fixture({
      key_metrics: [
        metric({ metric: "cap_rate_median", value: 6.25, label: "Cap rate" }),
        metric({ metric: "sofr_rate", value: 3.56, label: "SOFR" }),
        metric({
          metric: "swfl_sfha_pct_area_weighted",
          value: 0.4324,
          label: "SFHA coverage",
        }),
        metric({
          metric: "overall_survival_rate",
          value: 91.9,
          label: "Survival rate",
        }),
      ],
    });
    const skos: Record<string, string> = {
      cap_rate_median: "real-estate",
      sofr_rate: "macro",
      swfl_sfha_pct_area_weighted: "environmental",
      overall_survival_rate: "credit-risk",
    };
    const md = renderForRole(out, {
      role: "cre-broker",
      category_lookup: (s) => skos[s] ?? null,
    });
    const leadIdx = md.indexOf("Most relevant to your role");
    const additionalIdx = md.indexOf("Additional context");
    assert.ok(leadIdx > -1);
    assert.ok(additionalIdx > leadIdx);
    const leadSection = md.slice(leadIdx, additionalIdx);
    assert.ok(leadSection.includes("Cap rate"));
    assert.ok(leadSection.includes("SOFR"));
    assert.ok(leadSection.includes("SFHA coverage"));
    const restSection = md.slice(additionalIdx);
    assert.ok(restSection.includes("Survival rate"));
  });

  test("franchise-consultant promotes credit-risk slugs via category lookup", () => {
    const out = fixture({
      key_metrics: [
        metric({
          metric: "overall_survival_rate",
          value: 91.9,
          label: "Survival",
        }),
        metric({
          metric: "best_naics_survival",
          value: 100,
          label: "Best NAICS",
        }),
        metric({ metric: "cap_rate_median", value: 6.25, label: "Cap rate" }),
      ],
    });
    const skos: Record<string, string> = {
      overall_survival_rate: "credit-risk",
      best_naics_survival: "credit-risk",
      cap_rate_median: "real-estate",
    };
    const md = renderForRole(out, {
      role: "franchise-consultant",
      category_lookup: (s) => skos[s] ?? null,
    });
    const leadIdx = md.indexOf("Most relevant to your role");
    const additionalIdx = md.indexOf("Additional context");
    const leadSection = md.slice(leadIdx, additionalIdx);
    assert.ok(leadSection.includes("Survival"));
    assert.ok(leadSection.includes("Best NAICS"));
    const restSection = md.slice(additionalIdx);
    assert.ok(restSection.includes("Cap rate"));
  });

  test("unmapped slug falls back to prefix matching", () => {
    const out = fixture({
      key_metrics: [
        metric({ metric: "cre_vacancy_rate", value: 0.12, label: "Vacancy" }),
        metric({ metric: "weird_unmapped_slug", value: 1, label: "Weird" }),
      ],
    });
    const md = renderForRole(out, {
      role: "cre-broker",
      category_lookup: () => null,
    });
    const leadIdx = md.indexOf("Most relevant to your role");
    const additionalIdx = md.indexOf("Additional context");
    const leadSection = md.slice(leadIdx, additionalIdx);
    assert.ok(leadSection.includes("Vacancy"));
    const restSection = md.slice(additionalIdx);
    assert.ok(restSection.includes("Weird"));
  });
});

describe("role-renderer — receipts and provenance", () => {
  test("inline cites source URL + citation when provenance is present", () => {
    const md = renderForRole(fixture(), { role: "operator" });
    assert.ok(md.includes("https://census.example/vacancy"));
    assert.ok(md.includes("US Census ACS 5-year vacancy"));
    assert.ok(md.includes("T1"));
  });

  test("noted as missing when source absent", () => {
    const out = fixture({
      key_metrics: [
        {
          metric: "legacy_metric",
          value: 42,
          direction: "stable",
          label: "Legacy",
        },
      ],
    });
    const md = renderForRole(out, { role: "operator" });
    assert.ok(md.includes("no provenance — pre-P2 metric"));
  });

  test("freshness footer surfaces version + half-life + decay", () => {
    const md = renderForRole(fixture(), { role: "operator" });
    assert.ok(md.includes("`test-brain` v1"));
    assert.ok(md.includes("relevance half-life 720h"));
    assert.ok(md.includes("decay `weeks`"));
  });

  test("confidence block surfaces deterministic confidence + trust tier", () => {
    const md = renderForRole(fixture(), { role: "operator" });
    assert.ok(md.includes("0.97"));
    assert.ok(md.includes("Worst trust tier in chain: T2"));
    assert.ok(
      md.includes("Upstream brains that passed the relevance floor: 2"),
    );
  });
});

describe("role-renderer — value formatting", () => {
  test("0-1 percentage-like values get percentage rendering alongside raw", () => {
    const out = fixture({
      key_metrics: [
        metric({ metric: "cre_vacancy_rate", value: 0.12, label: "Vacancy" }),
      ],
    });
    const md = renderForRole(out, { role: "operator" });
    assert.ok(md.includes("0.12"));
    assert.ok(md.includes("12.00%"));
  });

  test("non-percentage values rendered verbatim without percent affix", () => {
    const out = fixture({
      key_metrics: [
        metric({ metric: "raw_count", value: 173, label: "Resolved loans" }),
      ],
    });
    const md = renderForRole(out, { role: "operator" });
    assert.ok(md.includes("173"));
    assert.ok(!md.includes("173%"));
  });

  test("values >= 1 with rate-like slug are NOT misformatted as fractional percent", () => {
    const out = fixture({
      key_metrics: [
        metric({
          metric: "overall_survival_rate",
          value: 91.9,
          label: "Survival rate",
        }),
      ],
    });
    const md = renderForRole(out, { role: "operator" });
    assert.ok(md.includes("91.9"));
    assert.doesNotMatch(md, /9190(\.|,)/);
  });
});

describe("role-renderer — empty / edge cases", () => {
  test("primary brain with no drivers renders gracefully", () => {
    const md = renderForRole(fixture({ drivers: [] }), { role: "operator" });
    assert.ok(md.includes("primary brain"));
  });

  test("brain with empty key_metrics renders without crashing", () => {
    const md = renderForRole(fixture({ key_metrics: [], drivers: [] }), {
      role: "cpa",
    });
    assert.ok(md.includes("No key metrics emitted"));
  });
});
