import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseBrainMarkdown,
  sanitizeProse,
  speak,
  stripSectionMarker,
  type ParsedBrain,
} from "./speaker.mts";
import type { BrainOutput, BrainOutputMetric } from "../types/brain-output.mts";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");

function metric(
  partial: Partial<BrainOutputMetric> &
    Pick<BrainOutputMetric, "metric" | "value" | "label">,
): BrainOutputMetric {
  const variable_type: BrainOutputMetric["variable_type"] =
    partial.variable_type ??
    (typeof partial.value === "string" ? "categorical" : "extensive");
  const units =
    variable_type === "categorical" ? undefined : (partial.units ?? "count");
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

describe("parseBrainMarkdown", () => {
  test("parses the real master.md fixture", async () => {
    const md = await readFile(
      path.join(PROJECT_ROOT, "brains", "master.md"),
      "utf-8",
    );
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
    const out = sanitizeProse(
      "Per env-swfl and properties-lee-value, the master read is mixed.",
    );
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
    assert.match(
      out,
      /Full breakdown → https:\/\/brain-platform-amber\.vercel\.app\/r\/fixture/,
    );
    assert.match(out, /SWFL-7421-v1-20260520/);
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
