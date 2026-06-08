/**
 * Lane 1B — runtime contract tests for the spec-validator's metric checks.
 *
 * These tests wrap minimal OUTPUT blocks in a full reference fence and run
 * them through `validateSpec()` to confirm the new required-field rules fire:
 *   - variable_type required + must be one of "extensive"|"intensive"|"categorical"
 *   - units required when variable_type !== "categorical"
 *   - source (full object) required on every metric
 *   - display_format (when present) must match the locked enum
 *
 * The citation_ref → CITATION TABLE cross-validation lives in the renderer
 * (`master-index.mts`), not the validator — that's tested via the live
 * fixture-mode refinery runs in CI. Validator only checks the field's TYPE.
 */

import { test } from "bun:test";
import assert from "node:assert/strict";
import { validateSpec } from "../../validate/spec-validator.mts";

const VALID_SOURCE = {
  url: "https://example.test/metric",
  fetched_at: "2026-05-18T00:00:00Z",
  tier: 1,
  citation: "example citation",
};

function wrap(output: object): string {
  const refined_at = "2026-05-18T00:00:00Z";
  // Token must match `freshnessToken(version, refined_at)` — see refinery/lib/freshness.mts.
  const token = "SWFL-7421-v1-20260518";
  return [
    `<!-- FRESHNESS: v1 | Token: ${token} -->`,
    "---",
    "brain_id: contract-test",
    "version: 1",
    "refined_at: 2026-05-18T00:00:00Z",
    `freshness_token: ${token}`,
    "ttl_seconds: 3600",
    "context_type: user_saved_reference",
    "scope: contract test",
    "---",
    "",
    "```reference",
    "CONTEXT TYPE: user_saved_reference",
    "SCOPE: contract test",
    "",
    "--- HOW THE USER LIKES TO WORK ---",
    "- placeholder",
    "",
    "--- CITATION TABLE ---",
    "id  | source       | verified   | expires",
    "s01 | example test | 2026-05-18 | 2026-06-17",
    "",
    "--- SAVED FACTS ---",
    "[]",
    "",
    "--- OUTPUT ---",
    JSON.stringify(
      {
        brain_id: "contract-test",
        version: 1,
        refined_at,
        direction: "neutral",
        magnitude: 0.5,
        drivers: [],
        overrides: [],
        conclusion: "contract test",
        caveats: [],
        contradicts: [],
        confidence: 0.8,
        joint_integrity: 1.0,
        confidence_dispersion: 0,
        chain_depth: 0,
        trust_tier: 1,
        upstream_count: 0,
        relevance: {
          decay_curve: "hours",
          half_life_hours: 24,
          computed_at: refined_at,
        },
        exogenous_signals: [],
        ...output,
      },
      null,
      2,
    ),
    "",
    "--- ACTIVE PROJECTS ---",
    "- placeholder",
    "",
    "--- RECENT NOTES ---",
    "- placeholder",
    "```",
  ].join("\n");
}

test("validator rejects a metric missing variable_type", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "x",
        value: 1,
        direction: "stable",
        label: "X",
        // variable_type missing
        units: "count",
        source: VALID_SOURCE,
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /variable_type/.test(e)),
    `expected variable_type error, got: ${result.errors.join("; ")}`,
  );
});

test("validator rejects a metric whose variable_type is outside the locked enum", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "x",
        value: 1,
        direction: "stable",
        label: "X",
        variable_type: "ordinal", // not in enum
        units: "count",
        source: VALID_SOURCE,
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /variable_type/.test(e)),
    `expected variable_type error, got: ${result.errors.join("; ")}`,
  );
});

test("validator rejects an extensive metric missing units", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "employees",
        value: 100,
        direction: "stable",
        label: "Employees",
        variable_type: "extensive",
        // units missing
        source: VALID_SOURCE,
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /units/.test(e)),
    `expected units error, got: ${result.errors.join("; ")}`,
  );
});

test("validator rejects an intensive metric missing units", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "rate",
        value: 0.05,
        direction: "stable",
        label: "Rate",
        variable_type: "intensive",
        // units missing
        source: VALID_SOURCE,
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /units/.test(e)),
    `expected units error, got: ${result.errors.join("; ")}`,
  );
});

test("validator allows a categorical metric without units", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "shock_state",
        value: "anomaly",
        direction: "stable",
        label: "Shock state",
        variable_type: "categorical",
        // units intentionally omitted — categorical doesn't require them
        source: VALID_SOURCE,
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, true, `expected pass, got errors: ${result.errors.join("; ")}`);
});

test("validator rejects a metric with missing source (now required)", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "x",
        value: 1,
        direction: "stable",
        label: "X",
        variable_type: "extensive",
        units: "count",
        // source missing
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /source/.test(e)),
    `expected source error, got: ${result.errors.join("; ")}`,
  );
});

test("validator rejects a metric with an invalid display_format value", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "x",
        value: 1,
        direction: "stable",
        label: "X",
        variable_type: "extensive",
        units: "count",
        display_format: "scientific", // not in enum
        source: VALID_SOURCE,
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /display_format/.test(e)),
    `expected display_format error, got: ${result.errors.join("; ")}`,
  );
});

test("validator allows display_format omitted", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "x",
        value: 1,
        direction: "stable",
        label: "X",
        variable_type: "extensive",
        units: "count",
        // display_format intentionally omitted
        source: VALID_SOURCE,
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, true, `expected pass, got errors: ${result.errors.join("; ")}`);
});

test("validator accepts a full, valid metric with all new fields populated", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "yoy_change_pct",
        value: 4.2,
        direction: "rising",
        label: "YoY change",
        variable_type: "intensive",
        units: "percent",
        display_format: "percent",
        source: { ...VALID_SOURCE, citation_ref: "s01" },
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, true, `expected pass, got errors: ${result.errors.join("; ")}`);
});

test("validator rejects a metric whose source.citation_ref is not a string", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "x",
        value: 1,
        direction: "stable",
        label: "X",
        variable_type: "extensive",
        units: "count",
        source: { ...VALID_SOURCE, citation_ref: 5 },
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /citation_ref/.test(e)),
    `expected citation_ref error, got: ${result.errors.join("; ")}`,
  );
});

// --- Highlighter Reach: precomputed suggestions carrier (type-lift) ---

test("validator allows a metric with no suggestions (pre-lift / opt-out)", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "x",
        value: 1,
        direction: "stable",
        label: "X",
        variable_type: "extensive",
        units: "count",
        source: VALID_SOURCE,
        // suggestions intentionally omitted
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, true, `expected pass, got errors: ${result.errors.join("; ")}`);
});

test("validator accepts a metric with a valid suggestions array", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "x",
        value: 1,
        direction: "stable",
        label: "X",
        variable_type: "extensive",
        units: "count",
        source: VALID_SOURCE,
        suggestions: ["What's driving X?", "How does X compare to other areas?"],
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, true, `expected pass, got errors: ${result.errors.join("; ")}`);
});

test("validator rejects suggestions that is not an array", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "x",
        value: 1,
        direction: "stable",
        label: "X",
        variable_type: "extensive",
        units: "count",
        source: VALID_SOURCE,
        suggestions: "What's driving X?",
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /suggestions/.test(e)),
    `expected suggestions error, got: ${result.errors.join("; ")}`,
  );
});

test("validator rejects an empty-string suggestion (would render a dead chip)", () => {
  const md = wrap({
    key_metrics: [
      {
        metric: "x",
        value: 1,
        direction: "stable",
        label: "X",
        variable_type: "extensive",
        units: "count",
        source: VALID_SOURCE,
        suggestions: ["What's driving X?", "   "],
      },
    ],
  });
  const result = validateSpec(md);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /suggestions\[1\]/.test(e)),
    `expected suggestions[1] error, got: ${result.errors.join("; ")}`,
  );
});
