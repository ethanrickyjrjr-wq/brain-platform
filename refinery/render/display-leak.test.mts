/**
 * display-leak — the build-failing guard.
 *
 * Both customer surfaces (the web report page `app/r/[slug]/page.tsx` and the
 * chat speaker path) get their strings from `toDisplayBrain` / `speak`. This
 * test shoves a deliberately-dirty brain — every internal token we never want a
 * customer to see — through both and asserts NONE survive. If a future change
 * re-leaks `master`, a brain-id, a tier code, a metric slug, a citation marker,
 * a DB/file identifier, or `§`, CI goes red here BEFORE it ships. That is the
 * mechanism that makes "nothing is master" structural instead of a promise.
 */
import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseBrainMarkdown, speak, toDisplayBrain, type ParsedBrain } from "./speaker.mts";
import type { BrainOutputMetric } from "../types/brain-output.mts";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");

/** A minimal customer-facing brain carrying only the metrics/caveats under test. */
function brainWith(parts: { metrics?: BrainOutputMetric[]; caveats?: string[] }): ParsedBrain {
  return {
    brain_id: "fixture",
    version: 1,
    freshness_token: "SWFL-7421-v1-20260621",
    scope: "SWFL — fixture",
    refined_at: "2026-06-21T00:00:00Z",
    output: {
      brain_id: "fixture",
      version: 1,
      refined_at: "2026-06-21T00:00:00Z",
      direction: "mixed",
      magnitude: 0.4,
      drivers: [],
      overrides: [],
      conclusion: "Fixture conclusion.",
      key_metrics: parts.metrics ?? [],
      caveats: parts.caveats ?? [],
      contradicts: [],
      confidence: 0.9,
      joint_integrity: 0.9,
      confidence_dispersion: 0,
      chain_depth: 0,
      trust_tier: 2,
      upstream_count: 0,
      relevance: {
        decay_curve: "weeks",
        half_life_hours: 720,
        computed_at: "2026-06-21T00:00:00Z",
      },
      exogenous_signals: [],
    },
    raw_md: "<raw markdown not used in this test>",
  };
}

const src = (metric: string): BrainOutputMetric["source"] => ({
  url: "https://example.test/m/" + metric,
  fetched_at: "2026-06-20T00:00:00Z",
  tier: 2,
  citation: "Example source for " + metric,
});

/** Every leak vector, in one fixture. */
const DIRTY: ParsedBrain = {
  brain_id: "master",
  version: 67,
  freshness_token: "SWFL-7421-v67-20260602",
  scope: "SWFL Intelligence Lake — master synthesis over env-swfl and cre-swfl",
  refined_at: "2026-06-02T00:00:00Z",
  output: {
    brain_id: "master",
    version: 67,
    refined_at: "2026-06-02T00:00:00Z",
    direction: "mixed",
    magnitude: 0.45,
    drivers: [
      { brain_id: "env-swfl", edge_type: "modifier" },
      { brain_id: "cre-swfl", edge_type: "input" },
    ],
    overrides: ["flood-barrier-mode-1"],
    conclusion:
      "Mixed read. env-swfl bearish vs cre-swfl bullish [internal-3]; tourism rising [web-12]. §",
    key_metrics: [
      {
        metric: "cap_rate_median",
        value: 6.7,
        direction: "rising",
        label: "Cap rate (median)",
        variable_type: "intensive",
        units: "percent",
        display_format: "percent",
        source: {
          url: "https://example.test/cap",
          fetched_at: "2026-05-21T00:00:00Z",
          tier: 3,
          citation: "FEMA NFHL Flood Hazard Zones, DFIRM_ID 12021C via data_lake.corridor_profiles",
        },
      },
    ],
    caveats: [
      "Master synthesizer is T4 — composite of upstreams.",
      "Re-source via refinery/sources/faf5-source.mts before trusting.",
      "data_lake.bls_laus sample was cached at build (post-commit 297ad23).",
    ],
    contradicts: ["env-swfl (bearish) vs cre-swfl (bullish)"],
    confidence: 0.96,
    joint_integrity: 0.53,
    confidence_dispersion: 0.08,
    chain_depth: 3,
    trust_tier: 4,
    upstream_count: 12,
    relevance: {
      decay_curve: "weeks",
      half_life_hours: 720,
      computed_at: "2026-06-02T00:00:00Z",
    },
    exogenous_signals: [],
    // Bulk per-row detail (e.g. housing-by-ZIP). It rides ONLY in the structured
    // dossier; it must never render into tier-1/2 chat prose or the web display
    // projection. Sentinel values below assert that guarantee.
    detail_tables: [
      {
        id: "secret_by_zip",
        title: "Per-ZIP detail — must never reach tier-1/2 prose",
        grain: "zip",
        columns: [
          {
            id: "median_sale_price",
            label: "Median sale price",
            display_format: "currency",
            units: "USD",
          },
          { id: "internal_code", label: "internal" },
        ],
        // 3 rows so the comparable column clears computeMetricChart's >=3 floor
        // and actually charts — exercising the NEW display surface the type-lift
        // opened. The internal_code column must stay out of that chart.
        rows: [
          {
            key: "33913",
            label: "33913",
            cells: {
              median_sale_price: 919191,
              internal_code: "data_lake.secret_zip",
            },
          },
          {
            key: "33901",
            label: "33901",
            cells: {
              median_sale_price: 350000,
              internal_code: "data_lake.secret_zip",
            },
          },
          {
            key: "34102",
            label: "34102",
            cells: {
              median_sale_price: 1200000,
              internal_code: "data_lake.secret_zip",
            },
          },
        ],
        source: {
          url: "https://example.test/zip",
          fetched_at: "2026-05-21T00:00:00Z",
          tier: 3,
          citation: "Redfin per-ZIP detail",
        },
      },
    ],
  },
  raw_md: "<raw markdown not used in this test>",
};

/** Patterns that must NEVER appear in any customer-facing surface. */
const FORBIDDEN: Array<[string, RegExp]> = [
  ["the word 'master'", /\bmaster\b/i],
  ["a bare pack-id slug", /\b(?:env-swfl|cre-swfl|properties-lee-value)\b/],
  ["a tier code (T1–T4)", /\bT[1-4]\b/],
  ["a metric slug", /\bcap_rate_median\b/],
  ["a citation marker", /\[(?:internal|web)-\d+\]/i],
  ["the section marker §", /§/],
  ["a DB schema identifier", /\b(?:data_lake|public|information_schema)\.\w/],
  ["a source-tree path", /\brefinery\//],
  ["an override id", /\bflood-barrier-mode-1\b/],
  ["an engine field name", /\b(?:trust_tier|chain_depth|upstream_count|joint_integrity)\b/],
];

function assertClean(label: string, text: string) {
  for (const [why, pat] of FORBIDDEN) {
    assert.ok(!pat.test(text), `${label} leaked ${why} (matched ${pat}):\n${text}`);
  }
}

describe("display-leak guard", () => {
  test("toDisplayBrain emits no internal token", () => {
    const d = toDisplayBrain(DIRTY);
    // Title is branded, never the raw id.
    assert.equal(d.title, "Southwest Florida — Market Read");
    assertClean("toDisplayBrain", JSON.stringify(d));
    // Real content still survives the scrub.
    assert.match(JSON.stringify(d), /Cap rate/);
    assert.ok(d.summaryCaveats.length >= 1, "caveats should survive, scrubbed");
  });

  test("speak() tier-1 emits no internal token", () => {
    assertClean("speak tier 1", speak(DIRTY, { tier: 1 }));
  });

  test("speak() tier-2 emits no internal token", () => {
    assertClean("speak tier 2", speak(DIRTY, { tier: 2 }));
  });

  test("detail_tables: comparable column rides ONLY the sanctioned chart; prose stays clean; internal cell never leaks", () => {
    // Prose surfaces (tier 1/2) carry NO detail value and NO internal cell.
    for (const [label, text] of [
      ["tier 1", speak(DIRTY, { tier: 1 })],
      ["tier 2", speak(DIRTY, { tier: 2 })],
    ] as const) {
      assert.ok(
        !text.includes("919191"),
        `${label} leaked a detail-table row value into prose (per-ZIP data belongs in the dossier, not prose):\n${text}`,
      );
      assert.ok(
        !/data_lake\.secret_zip/.test(text),
        `${label} leaked a detail-table internal cell:\n${text}`,
      );
    }

    // The display projection MAY surface the comparable numeric column — but
    // ONLY inside the chart, and NEVER the non-charted internal cell.
    const d = toDisplayBrain(DIRTY);
    assert.ok(d.chart, "expected the comparable detail column to produce a chart");
    assert.ok(
      JSON.stringify(d.chart).includes("919191"),
      "the chart should carry the comparable column's audited value",
    );
    const rest = structuredClone(d);
    delete (rest as { chart?: unknown }).chart;
    assert.ok(
      !JSON.stringify(rest).includes("919191"),
      "a detail value leaked OUTSIDE the chart in the display projection",
    );
    assert.ok(
      !/data_lake\.secret_zip/.test(JSON.stringify(d)),
      "the non-charted internal detail cell leaked into the display projection",
    );
  });

  test("methodHref is gated on the registry: registered slug -> public URL, unregistered -> undefined", () => {
    // DIRTY's metric slug (cap_rate_median) is intentionally UNregistered — it
    // is the canary proving an internal slug never becomes a /r/method URL.
    const plain = toDisplayBrain(DIRTY);
    assert.equal(plain.metrics[0].methodHref, undefined);

    // A registered slug yields exactly its public /r/method URL.
    const reg = structuredClone(DIRTY);
    reg.output.key_metrics[0].metric = "latest_monthly_collections_usd";
    const d = toDisplayBrain(reg);
    assert.equal(d.metrics[0].methodHref, "/r/method/latest_monthly_collections_usd");
  });
});

/**
 * Number/caveat hygiene — the two surfaces that shipped raw engine output to
 * customers (a 16-digit float in a metric value; an "Override "x" fired
 * (priority N)" diagnostic in the "Worth knowing" box). The chokepoint
 * (`toDisplayBrain`) is the one place this is enforced, so these guard it AND
 * scan every real brain so a nightly rebuild can never re-leak.
 */
describe("display hygiene: bounded numbers + scrubbed caveats", () => {
  test("a runaway-precision numeric value is bounded, never dumped as a 16-digit float", () => {
    const d = toDisplayBrain(
      brainWith({
        metrics: [
          {
            metric: "rsw_passengers_yoy",
            value: 2.3837188145672608,
            direction: "rising",
            label: "RSW Total Passengers — Trailing-12-Mo YoY",
            variable_type: "intensive",
            units: "ratio",
            source: src("rsw_passengers_yoy"),
          },
        ],
      }),
    );
    assert.equal(d.metrics[0].value, "2.38");
    assert.ok(
      !/\d\.\d{4,}/.test(JSON.stringify(d)),
      "a raw float leaked into the display projection",
    );
  });

  test("the same leak arriving as a numeric STRING is bounded too", () => {
    const d = toDisplayBrain(
      brainWith({
        metrics: [
          {
            metric: "rsw_passengers_yoy",
            value: "2.3837188145672608",
            direction: "rising",
            label: "RSW Total Passengers — Trailing-12-Mo YoY",
            variable_type: "intensive",
            units: "ratio",
            source: src("rsw_passengers_yoy"),
          },
        ],
      }),
    );
    assert.equal(d.metrics[0].value, "2.38");
  });

  test("a genuine categorical label is NOT mangled by the float guard", () => {
    const d = toDisplayBrain(
      brainWith({
        metrics: [
          {
            metric: "dominant_land_use",
            value: "Mixed-use",
            direction: "stable",
            label: "Dominant land use",
            variable_type: "categorical",
            source: src("dominant_land_use"),
          },
        ],
      }),
    );
    assert.equal(d.metrics[0].value, "Mixed-use");
  });

  test("override-fire diagnostics never reach the customer 'Worth knowing' box; real caveats survive", () => {
    const d = toDisplayBrain(
      brainWith({
        caveats: [
          'Override "storm-history-modifier" fired (priority 70)',
          'Override "flood-veto" forced bearish (priority 90)',
          "Cap rate is a median across 16 submarkets.",
        ],
      }),
    );
    const all = [...d.summaryCaveats, ...d.detailCaveats];
    assert.ok(
      all.every((c) => !/priority\s+\d+/i.test(c)),
      `override machinery leaked:\n${all.join("\n")}`,
    );
    assert.ok(all.every((c) => !/^Override\s+["“]/i.test(c.trim())));
    assert.ok(
      all.some((c) => /Cap rate is a median/.test(c)),
      "a real, customer-safe caveat should survive the scrub",
    );
  });

  test("WALL: every real brain's display projection carries no raw float and no override machinery", () => {
    const dir = path.join(PROJECT_ROOT, "brains");
    const files = readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
    assert.ok(files.length > 0, "expected real brain files to scan");
    for (const f of files) {
      let d;
      try {
        d = toDisplayBrain(parseBrainMarkdown(readFileSync(path.join(dir, f), "utf-8")));
      } catch {
        continue; // unparseable brains are a different guard's concern
      }
      for (const m of d.metrics) {
        assert.ok(
          !/\d\.\d{4,}/.test(m.value),
          `${f}: metric "${m.label}" leaked a raw float to the customer: ${m.value}`,
        );
      }
      for (const c of [...d.summaryCaveats, ...d.detailCaveats]) {
        assert.ok(!/priority\s+\d+/i.test(c), `${f}: caveat leaked override machinery: ${c}`);
        assert.ok(
          !/^Override\s+["“]/i.test(c.trim()),
          `${f}: caveat leaked override machinery: ${c}`,
        );
      }
    }
  });
});
