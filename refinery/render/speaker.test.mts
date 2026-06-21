import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  deCorridor,
  parseBrainMarkdown,
  sanitizeProse,
  scrubCaveatTechnical,
  speak,
  stripSectionMarker,
  toDisplayBrain,
  type ParsedBrain,
} from "./speaker.mts";
import type { BrainOutput, BrainOutputMetric } from "../types/brain-output.mts";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");

function metric(
  partial: Partial<BrainOutputMetric> & Pick<BrainOutputMetric, "metric" | "value" | "label">,
): BrainOutputMetric {
  const variable_type: BrainOutputMetric["variable_type"] =
    partial.variable_type ?? (typeof partial.value === "string" ? "categorical" : "extensive");
  const units = variable_type === "categorical" ? undefined : (partial.units ?? "count");
  return {
    direction: "stable",
    variable_type,
    ...(units !== undefined ? { units } : {}),
    source: {
      url: "https://example.test/m/" + partial.metric,
      fetched_at: "2026-05-20T00:00:00Z",
      tier: 2,
      citation: "Example for " + partial.metric,
    },
    ...partial,
  };
}

function outputFixture(overrides: Partial<BrainOutput> = {}): BrainOutput {
  return {
    brain_id: "fixture",
    version: 1,
    refined_at: "2026-05-20T00:00:00Z",
    direction: "mixed",
    magnitude: 0.45,
    drivers: [{ brain_id: "cre-swfl", edge_type: "input" }],
    overrides: ["flood-barrier-mode-1"],
    conclusion:
      "Mixed read. Cre-swfl bullish vs env-swfl bearish; we bifurcate the corridor view to surface it. Sub-brain pointers: properties-lee-value siblings haven't shipped.",
    key_metrics: [
      metric({
        metric: "sofr_rate",
        value: 4.31,
        label: "SOFR rate",
        variable_type: "intensive",
        units: "percent",
        display_format: "percent",
      }),
      metric({
        metric: "fl_unemployment",
        value: 3.4,
        label: "Florida unemployment",
        variable_type: "intensive",
        units: "percent",
        display_format: "percent",
      }),
    ],
    caveats: ["Master synthesizer is T4 — composite of upstreams."],
    contradicts: [],
    confidence: 0.96,
    joint_integrity: 0.53,
    confidence_dispersion: 0.08,
    chain_depth: 3,
    trust_tier: 4,
    upstream_count: 12,
    relevance: {
      decay_curve: "weeks",
      half_life_hours: 720,
      computed_at: "2026-05-20T00:00:00Z",
    },
    exogenous_signals: [],
    ...overrides,
  };
}

function parsedFixture(overrides: Partial<BrainOutput> = {}): ParsedBrain {
  return {
    brain_id: "fixture",
    version: 1,
    freshness_token: "SWFL-7421-v1-20260520",
    scope: "SWFL Intelligence Lake — fixture",
    refined_at: "2026-05-20T00:00:00Z",
    output: outputFixture(overrides),
    raw_md: "<raw markdown not used in this test>",
  };
}

/** A percent metric helper for the chart tests. */
function pct(metricId: string, value: number, label: string): BrainOutputMetric {
  return metric({
    metric: metricId,
    value,
    label,
    variable_type: "intensive",
    units: "percent",
    display_format: "percent",
  });
}

describe("toDisplayBrain chart (Tier A — compute-on-read)", () => {
  test("a chartable brain (>=3 comparable metrics) gets a bar chart over labels", () => {
    const d = toDisplayBrain(
      parsedFixture({
        key_metrics: [
          pct("cap_rate_median", 6.7, "Cap rate"),
          pct("vacancy_pct", 4.2, "Vacancy"),
          pct("chargeoff_pct", 3.1, "Charge-off"),
        ],
      }),
    );
    assert.ok(d.chart, "expected a chart block");
    assert.equal(d.chart!.chart_type, "bar");
    assert.deepEqual(d.chart!.rows, [
      ["Cap rate", 6.7],
      ["Vacancy", 4.2],
      ["Charge-off", 3.1],
    ]);
    // Human labels ride the chart, never the metric slug.
    assert.ok(!JSON.stringify(d.chart).includes("cap_rate_median"));
  });

  test("a non-chartable brain has chart === null (default fixture has only 2 points)", () => {
    assert.equal(toDisplayBrain(parsedFixture()).chart, null);
  });

  test("the value_format hint survives the display scrub (drives the renderer's formatter)", () => {
    const d = toDisplayBrain(
      parsedFixture({
        key_metrics: [
          pct("a", 6.7, "Cap rate"),
          pct("b", 4.2, "Vacancy"),
          pct("c", 3.1, "Charge-off"),
        ],
      }),
    );
    assert.equal(d.chart!.value_format, "percent");
  });

  test("chart string cells are scrubbed through sanitizeProse (corridor -> area)", () => {
    const d = toDisplayBrain(
      parsedFixture({
        key_metrics: [
          pct("a", 1, "Alpha corridor"),
          pct("b", 2, "Beta corridor"),
          pct("c", 3, "Gamma corridor"),
        ],
      }),
    );
    assert.deepEqual(
      d.chart!.rows.map((r) => r[0]),
      ["Alpha area", "Beta area", "Gamma area"],
    );
  });
});

describe("formatValue percent — points vs share (Naples/Estero 0.4% bug)", () => {
  // A percentage-point value renders verbatim — a legitimately small rate
  // like 0.4% must NOT be multiplied to "40.00%". Regression for the
  // Naples/Estero vacancy bug, where both submarkets sat at 0.4% and the old
  // |v| ≤ 1 → ×100 heuristic rendered both as "40.00%".
  function displayValueOf(m: BrainOutputMetric): string {
    const d = toDisplayBrain(parsedFixture({ key_metrics: [m] }));
    return d.metrics[0]!.value;
  }

  test("sub-1% percentage-point value renders as-is, not ×100", () => {
    assert.equal(
      displayValueOf(
        metric({
          metric: "vacancy_rate_marketbeat_naples",
          value: 0.4,
          label: "MarketBeat Naples vacancy rate",
          variable_type: "intensive",
          units: "percent",
          display_format: "percent",
        }),
      ),
      "0.40%",
    );
  });

  test("a 0–1 share (units: share) is still scaled to a percent", () => {
    assert.equal(
      displayValueOf(
        metric({
          metric: "permits_lee_saturation_index",
          value: 0.4,
          label: "Lee County permit saturation",
          variable_type: "intensive",
          units: "share",
          display_format: "percent",
        }),
      ),
      "40.00%",
    );
  });

  test("ordinary percentage-point values are unchanged", () => {
    assert.equal(
      displayValueOf(
        metric({
          metric: "cap_rate_median",
          value: 6.7,
          label: "Cap rate",
          variable_type: "intensive",
          units: "percent",
          display_format: "percent",
        }),
      ),
      "6.70%",
    );
  });
});

describe("scrubCaveatTechnical (PR3-B)", () => {
  test("spares domain acronyms, plain numbers, and dates", () => {
    for (const safe of [
      "SOFR fell below 3.6%",
      "NFIP claims are policyholder-only",
      "FEMA NFHL is queried live",
      "NAICS 48 charge-off 57.1%",
      "AAL $850 per insured property",
      "Year scope is 2024",
      "token SWFL-7421-v62-20260530",
      "WGS84 / EPSG:4326 square degrees",
      // all-letter hex word + a pure-digit year — neither is a commit hash
      "the wall was defaced in 2004",
    ]) {
      assert.equal(scrubCaveatTechnical(safe), safe);
    }
  });

  test("redacts internal identifiers, file paths, and commit hashes", () => {
    assert.equal(
      scrubCaveatTechnical("the DFIRM_ID is authoritative"),
      "the [config] is authoritative",
    );
    assert.match(scrubCaveatTechnical("set REFINERY_SOURCE=live"), /\[config\]=live/);
    assert.match(scrubCaveatTechnical("ignore chargeoff_pct here"), /\[config\]/);
    assert.match(
      scrubCaveatTechnical("absent from MARKETBEAT_SUBMARKET_MAP this run"),
      /\[config\]/,
    );
    assert.match(
      scrubCaveatTechnical("bump it in refinery/sources/faf5-source.mts when"),
      /\[internal\]/,
    );
    assert.match(
      scrubCaveatTechnical("documented in docs/env-swfl-spike-findings.md and"),
      /\[internal\]/,
    );
    assert.match(scrubCaveatTechnical("Path B (post-commit 297ad23)"), /\[ref\]/);
  });

  test("redacts schema-qualified DB identifiers as one unit", () => {
    // The exact leak this rule shipped for: a raw table name in a caveat.
    const leak = "the full set is in data_lake.city_pulse_corridors.";
    assert.match(scrubCaveatTechnical(leak), /\[internal\]\./);
    assert.doesNotMatch(scrubCaveatTechnical(leak), /data_lake|city_pulse_corridors/);
    // The no-underscore table-name case the [config] rule alone would miss —
    // "permits" has no internal underscore, so only the schema-qualified rule
    // catches it.
    assert.doesNotMatch(scrubCaveatTechnical("see public.permits for the rows"), /\bpermits\b/);
  });
});

describe("sanitizeProse path preservation (PR3-A)", () => {
  test("leaves a compound doc path containing a pack id intact", () => {
    const out = sanitizeProse("see docs/env-swfl-spike-findings.md for detail");
    assert.match(out, /docs\/env-swfl-spike-findings\.md/);
    // the env-swfl pack id must NOT be expanded to its label inside the path
    assert.doesNotMatch(out, /environmental read-spike/);
  });

  test("still scrubs a bare sentence-final pack id", () => {
    const out = sanitizeProse("the read came from env-swfl.");
    assert.doesNotMatch(out, /\benv-swfl\b/);
  });
});

describe("speak tier-2 caveats — cap + fixture backstop (PR3-C / PR2-B)", () => {
  test("caps at 8 caveats with a non-silent tail", () => {
    const caveats = Array.from(
      { length: 11 },
      (_, i) => `Caveat number ${i + 1} stands on its own.`,
    );
    const reply = speak(parsedFixture({ caveats }), { tier: 2 });
    const bullets = reply.split("\n").filter((l) => l.startsWith("- "));
    assert.equal(bullets.length, 9); // 8 shown + 1 tail
    assert.match(reply, /…and 3 more in the full audit\./);
  });

  test("strips a fixture sentinel and prepends one honest line", () => {
    const caveats = [
      "Fixture mode: only Lee County is populated. Switch to REFINERY_SOURCE=live.",
      "FRED can revise recent observations.",
    ];
    const reply = speak(parsedFixture({ caveats }), { tier: 2 });
    assert.doesNotMatch(reply, /Fixture mode:/i);
    assert.match(reply, /cached sample data at build time/);
  });
});

describe("parseBrainMarkdown", () => {
  test("parses the real master.md fixture", async () => {
    const md = await readFile(path.join(PROJECT_ROOT, "brains", "master.md"), "utf-8");
    const brain = parseBrainMarkdown(md);
    assert.equal(brain.brain_id, "master");
    assert.ok(brain.version >= 1);
    assert.match(brain.freshness_token, /^SWFL-\d+-v\d+-\d{8}$/);
    assert.equal(brain.output.brain_id, "master");
    assert.ok(brain.output.key_metrics.length > 0);
    assert.ok(brain.output.conclusion.length > 0);
  });

  test("throws on missing OUTPUT section", () => {
    const md =
      "---\nbrain_id: x\nversion: 1\nfreshness_token: SWFL-1-v1-20260520\nrefined_at: 2026-05-20T00:00:00Z\nscope: test\n---\n\nno output here\n";
    assert.throws(() => parseBrainMarkdown(md), /OUTPUT/);
  });

  test("throws on missing frontmatter key", () => {
    const md = "---\nbrain_id: x\n---\n\n--- OUTPUT ---\n{}\n--- END ---\n";
    assert.throws(() => parseBrainMarkdown(md), /frontmatter missing/);
  });
});

describe("stripSectionMarker", () => {
  test("removes every § occurrence", () => {
    const out = stripSectionMarker("### §Receipts\n### §Hard Edges\n");
    assert.ok(!out.includes("§"));
  });

  test("is a no-op when § is absent", () => {
    assert.equal(stripSectionMarker("clean text"), "clean text");
  });
});

describe("sanitizeProse", () => {
  test("strips § and banned phrases", () => {
    const out = sanitizeProse(
      "We bifurcate §Receipts and the siblings haven't shipped. Sub-brain pointers: see below.",
    );
    assert.ok(!out.includes("§"));
    assert.ok(!/bifurcate/i.test(out));
    assert.ok(!/siblings/i.test(out));
    assert.ok(!/sub-brain pointers/i.test(out));
  });

  test("swaps known pack ids for human labels", () => {
    const out = sanitizeProse("Per env-swfl and properties-lee-value, the master read is mixed.");
    assert.ok(!/\benv-swfl\b/.test(out));
    assert.ok(!/\bproperties-lee-value\b/.test(out));
    assert.ok(out.includes("SWFL flood"));
    assert.ok(out.includes("Lee County parcel velocity"));
  });

  test("preserves '{id} brain' phrasing for citation context", () => {
    // Citation table rows say "env-swfl brain — https://...". Don't mangle.
    const out = sanitizeProse("env-swfl brain — https://example.com");
    assert.ok(out.includes("env-swfl brain"));
  });

  test("swaps corridor → area in user-facing prose", () => {
    const out = sanitizeProse("Median across 12 of 25 corridors; one corridor leads.");
    assert.ok(!/corridor/i.test(out));
    assert.ok(out.includes("12 of 25 areas"));
    assert.ok(out.includes("one area leads"));
  });
});

describe("deCorridor", () => {
  test("swaps singular and plural", () => {
    assert.equal(deCorridor("one corridor"), "one area");
    assert.equal(deCorridor("five corridors"), "five areas");
  });

  test("preserves leading capitalization", () => {
    assert.equal(deCorridor("Corridor signals split."), "Area signals split.");
    assert.equal(deCorridor("Corridors by type."), "Areas by type.");
  });

  test("leaves the corridor_type field token intact (no word boundary)", () => {
    assert.equal(deCorridor("the corridor_type field"), "the corridor_type field");
  });
});

describe("speak — tier 1", () => {
  test("emits headline + conclusion + freshness + report link", () => {
    const out = speak(parsedFixture(), {
      tier: 1,
      origin: "https://brain-platform-amber.vercel.app",
    });
    assert.match(out, /Mixed read/);
    assert.match(out, /magnitude 45%/);
    assert.match(out, /confidence 96%/);
    assert.match(out, /Full breakdown → https:\/\/brain-platform-amber\.vercel\.app\/r\/fixture/);
    // Freshness shows the CLEANED as-of date (MM/DD/YYYY), never the raw token (#9).
    assert.match(out, /_Freshness:_ as of 05\/20\/2026/);
    assert.ok(!out.includes("SWFL-7421-v1-20260520"));
    assert.ok(!out.includes("bifurcate"));
    assert.ok(!out.includes("§"));
    assert.ok(!out.includes("siblings haven't shipped"));
  });

  test("omits link when origin is unset", () => {
    const out = speak(parsedFixture(), { tier: 1 });
    assert.ok(!out.includes("Full breakdown"));
  });
});

describe("speak — tier 2", () => {
  test("includes metrics table + caveats + report link", () => {
    const out = speak(parsedFixture(), {
      tier: 2,
      origin: "https://brain-platform-amber.vercel.app/",
    });
    assert.match(out, /\| Metric \| Value \| Direction \|/);
    assert.match(out, /SOFR rate/);
    assert.match(out, /\*\*Caveats\*\*/);
    assert.match(out, /Full audit → https:\/\/.*\/r\/fixture/);
    assert.ok(!out.includes("bifurcate"));
    assert.ok(!out.includes("§"));
  });

  test("formats percent values with display_format", () => {
    const out = speak(parsedFixture(), { tier: 2 });
    // sofr 4.31 with display_format=percent and |v|>1 → "4.31%" not "431.00%"
    assert.match(out, /4\.31%/);
  });

  test("caps metrics table at 6 rows", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      metric({
        metric: `m_${i}`,
        value: i,
        label: `Series ${i}`,
      }),
    );
    const brain = parsedFixture({ key_metrics: many });
    const out = speak(brain, { tier: 2 });
    const dataRows = out.split("\n").filter((l) => l.startsWith("| Series "));
    assert.equal(dataRows.length, 6);
  });
});

describe("speak — tier 3", () => {
  test("passes through raw markdown with only § stripped", () => {
    const brain = parsedFixture();
    brain.raw_md =
      "<!-- header -->\n### §Receipts\nThe env-swfl brain reads bearish.\nUse properties-lee-value as upstream.\n";
    const out = speak(brain, { tier: 3 });
    assert.ok(!out.includes("§"));
    // Pack ids preserved in tier 3 — the audit IS the receipt.
    assert.ok(out.includes("env-swfl"));
    assert.ok(out.includes("properties-lee-value"));
  });
});

describe("speak — tier 2 grain_boundary.routes", () => {
  const FLOOD_OFFER = "Flood risk is tracked per ZIP — want it for a specific ZIP or address?";

  test("routes render under 'You can also ask:', never under 'What this can't tell you'", () => {
    const md = speak(
      parsedFixture({
        grain_boundary: {
          not_available: ["County-level only for most series this run."],
          finest_grain: "county-month",
          routes: [FLOOD_OFFER],
        },
      }),
      { tier: 2 },
    );
    assert.match(md, /You can also ask:/);
    assert.ok(md.includes(FLOOD_OFFER), "offer text should be rendered");

    // The offer must live in the offer block, NOT inside the denial block —
    // rendering an offer under "What this can't tell you" is the contradiction
    // this whole field exists to avoid.
    const blocks = md.split("\n\n");
    const denialBlock = blocks.find((b) => b.includes("What this can't tell you"));
    assert.ok(
      !denialBlock || !denialBlock.includes(FLOOD_OFFER),
      "offer must not appear under the can't-tell-you header",
    );
    const askBlock = blocks.find((b) => b.includes("You can also ask"));
    assert.ok(askBlock && askBlock.includes(FLOOD_OFFER), "offer must appear under the ask header");
  });

  test("no routes → no 'You can also ask:' block", () => {
    const md = speak(
      parsedFixture({
        grain_boundary: {
          not_available: ["County-level only."],
          finest_grain: "county-month",
        },
      }),
      { tier: 2 },
    );
    assert.ok(!md.includes("You can also ask:"));
  });

  test("grain_boundary.routes survive the OUTPUT JSON round-trip (block is JSON.stringify→JSON.parse)", () => {
    const out = outputFixture({
      grain_boundary: {
        not_available: ["County-level only for most series."],
        finest_grain: "county-month",
        routes: [FLOOD_OFFER],
      },
    });
    const frontmatter = [
      "brain_id: master",
      "version: 1",
      "freshness_token: SWFL-7421-v1-20260520",
      "scope: SWFL Intelligence Lake — fixture",
      "refined_at: 2026-05-20T00:00:00Z",
    ].join("\n");
    const md = `---\n${frontmatter}\n---\n\n--- OUTPUT ---\n${JSON.stringify(out, null, 2)}\n--- END ---\n`;
    const parsed = parseBrainMarkdown(md);
    assert.deepEqual(parsed.output.grain_boundary?.routes, [FLOOD_OFFER]);
  });

  // Verification guard 9 (Brain Resilience Phase 1): degraded_inputs survives
  // the JSON.stringify → OUTPUT block → JSON.parse round-trip intact.
  test("parseBrainMarkdown round-trips degraded_inputs", () => {
    const out = outputFixture({
      degraded_inputs: [{ label: "Flood & Environment", date: "2024-01-15" }],
    });
    const frontmatter = [
      "brain_id: master",
      "version: 1",
      "freshness_token: SWFL-7421-v1-20260520",
      "scope: SWFL Intelligence Lake — fixture",
      "refined_at: 2026-05-20T00:00:00Z",
    ].join("\n");
    const md = `---\n${frontmatter}\n---\n\n--- OUTPUT ---\n${JSON.stringify(out, null, 2)}\n--- END ---\n`;
    const parsed = parseBrainMarkdown(md);
    assert.deepEqual(parsed.output.degraded_inputs, [
      { label: "Flood & Environment", date: "2024-01-15" },
    ]);
  });
});

describe("degraded_inputs token rendering", () => {
  test("renderTier2: degraded_inputs → (Label · Date) tokens appear after conclusion", () => {
    const brain = parsedFixture({
      degraded_inputs: [
        { label: "Flood & Environment", date: "2024-01-15" },
        { label: "US Macro", date: "2026-06-01" },
      ],
    });
    const md = speak(brain, { tier: 2 });
    assert.match(md, /\(Flood & Environment · Jan 15, 2024\)/);
    assert.match(md, /\(US Macro · Jun 1, 2026\)/);
  });

  test("renderTier2: no degraded_inputs → no token block", () => {
    const brain = parsedFixture({ degraded_inputs: undefined });
    const md = speak(brain, { tier: 2 });
    assert.ok(!md.includes("·"), "should contain no · tokens");
  });

  test("renderTier2: empty degraded_inputs array → no token block", () => {
    const brain = parsedFixture({ degraded_inputs: [] });
    const md = speak(brain, { tier: 2 });
    assert.ok(!md.includes("·"), "empty array should produce no tokens");
  });

  test("renderTier1: degraded_inputs token rendered inline", () => {
    const brain = parsedFixture({
      degraded_inputs: [{ label: "Flood & Environment", date: "2024-01-15" }],
    });
    const md = speak(brain, { tier: 1 });
    assert.match(md, /\(Flood & Environment · Jan 15, 2024\)/);
  });

  test("safe guard: label 'a regional input' renders as-is (bootstrapping window)", () => {
    const brain = parsedFixture({
      degraded_inputs: [{ label: "a regional input", date: "2026-06-01" }],
    });
    const md = speak(brain, { tier: 2 });
    assert.match(md, /a regional input/);
  });
});
