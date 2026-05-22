import { test } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";
import type { BrainOutput, BrainOutputMetric } from "../types/brain-output.mts";
import type { BrainInputNormalized } from "../sources/brain-input-source.mts";

process.env["REFINERY_SOURCE"] = "fixture";

const { creSwfl } = await import("./cre-swfl.mts");

const NOW = "2026-05-22T00:00:00Z";

function pmMetric(slug: string, value: number | string): BrainOutputMetric {
  return {
    metric: slug,
    value,
    direction: "stable",
    label: slug,
    variable_type: "intensive",
    units: "ratio",
    source: {
      url: "test://permits-swfl",
      fetched_at: NOW,
      tier: 1,
      citation: "permits fixture",
    },
  };
}

function makePermitsOutput(
  saturationIndex: number,
  countyZ: number,
): BrainOutput {
  return {
    brain_id: "permits-swfl",
    version: 1,
    refined_at: NOW,
    direction: "neutral",
    magnitude: 0.5,
    drivers: [],
    overrides: [],
    conclusion: "test fixture — permits-swfl OUTPUT",
    key_metrics: [
      pmMetric("permits_lee_saturation_index", saturationIndex),
      pmMetric("permits_lee_county_weighted_avg_corridor_z", countyZ),
      pmMetric(
        "permits_lee_top_heating_commercial_alteration",
        "us-41-fort-myers,daniels-pkwy",
      ),
    ],
    caveats: [],
    contradicts: [],
    confidence: 0.7,
    joint_integrity: 1,
    confidence_dispersion: 0,
    chain_depth: 0,
    trust_tier: 1,
    upstream_count: 0,
    relevance: { decay_curve: "weeks", half_life_hours: 168, computed_at: NOW },
    exogenous_signals: [],
  };
}

function makePermitsFragment(output: BrainOutput): RawFragment {
  const norm: BrainInputNormalized = {
    kind: "brain-input",
    upstream_id: "permits-swfl",
    output,
  };
  return {
    fragment_id: "brain-input:permits-swfl:test",
    source_id: "brain-input:permits-swfl",
    source_trust_tier: 2,
    fetched_at: NOW,
    raw: {},
    normalized: norm as unknown as Record<string, unknown>,
  };
}

function minimalPackOutput() {
  return {
    pack: creSwfl,
    version: 1,
    refined_at: NOW,
    citations: [],
    facts: [],
    recentNote: "test",
  };
}

test("cre-swfl × permits-swfl: saturation >= 0.4 → conclusion mentions saturation + emits saturation signal metric", () => {
  const permitsOut = makePermitsOutput(0.5, 2.1);
  creSwfl.corpusSummary!([makePermitsFragment(permitsOut)]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  assert.ok(
    /saturation/i.test(result.conclusion),
    `expected 'saturation' in conclusion, got: ${result.conclusion}`,
  );
  const satMetric = result.key_metrics.find(
    (m) => m.metric === "permits_lee_saturation_signal",
  );
  assert.ok(satMetric, "expected permits_lee_saturation_signal in key_metrics");
  assert.equal(satMetric!.value, 0.5);
});

test("cre-swfl × permits-swfl: saturation < 0.4 → emits capital-flow z metric, no saturation metric", () => {
  const permitsOut = makePermitsOutput(0.2, 0.8);
  creSwfl.corpusSummary!([makePermitsFragment(permitsOut)]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  const satMetric = result.key_metrics.find(
    (m) => m.metric === "permits_lee_saturation_signal",
  );
  assert.ok(!satMetric, "expected no saturation signal for low saturation");
  const zMetric = result.key_metrics.find(
    (m) => m.metric === "permits_lee_capital_flow_z",
  );
  assert.ok(
    zMetric,
    "expected permits_lee_capital_flow_z for low saturation path",
  );
  assert.equal(zMetric!.value, 0.8);
});

test("cre-swfl × permits-swfl: no permits upstream → no permits metrics in output", () => {
  creSwfl.corpusSummary!([]);
  const result = creSwfl.outputProducer!(minimalPackOutput());
  const satMetric = result.key_metrics.find(
    (m) => m.metric === "permits_lee_saturation_signal",
  );
  const zMetric = result.key_metrics.find(
    (m) => m.metric === "permits_lee_capital_flow_z",
  );
  assert.ok(!satMetric, "expected no saturation signal when permits absent");
  assert.ok(!zMetric, "expected no z signal when permits absent");
});
