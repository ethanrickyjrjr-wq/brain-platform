/**
 * chart-block-lint.test.mts — the as-of keystone (Phase 1) + structural anchor.
 *
 * `asOf` is the field every chart needs to travel honestly into a project file
 * (see docs/.../phase-1-keystone-asof). The lint validates PRESENCE + ISO SHAPE
 * only — `asOf` and `source.citation` are PROVENANCE and must NEVER be run
 * through facts-only / smoothing / prose content policing (FLAG-3). Two modes:
 *   - default (legacy `/r/` blocks): missing asOf is a WARNING, not an error, so
 *     the nightly render does not start failing on pre-keystone persisted blocks;
 *   - `requireAsOf` (deliverable-bound blocks): missing asOf is an ERROR.
 * A malformed asOf is an error in BOTH modes — present-but-garbage is a bug.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { lintChartBlock } from "./chart-block-lint.mts";

/** A structurally-valid block with a clean ISO asOf. */
function validBlock(extra: Record<string, unknown> = {}) {
  return {
    title: "Median sale price by ZIP",
    columns: ["ZIP", "Median sale price"],
    rows: [
      ["33901", 350000],
      ["33913", 919191],
      ["34102", 1200000],
    ],
    chart_type: "bar",
    asOf: "2026-06-01",
    ...extra,
  };
}

// --- structural anchor (this module had no dedicated test file) -------------

test("null block is OK with no errors or warnings", () => {
  assert.deepEqual(lintChartBlock(null), { ok: true, errors: [], warnings: [] });
});

test("a non-object block is a structural error", () => {
  const r = lintChartBlock("not-a-block");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /must be null or an object/i.test(e)));
});

test("a well-formed block with ISO asOf passes clean", () => {
  const r = lintChartBlock(validBlock());
  assert.deepEqual(r, { ok: true, errors: [], warnings: [] });
});

// --- asOf presence: legacy (default) vs deliverable-bound -------------------

test("legacy mode: missing asOf is a WARNING, not an error (ok stays true)", () => {
  const block = validBlock();
  delete (block as Record<string, unknown>).asOf;
  const r = lintChartBlock(block);
  assert.equal(r.ok, true, "legacy missing-asOf must not fail the build");
  assert.equal(r.errors.length, 0);
  assert.ok(
    r.warnings.some((w) => /asOf/i.test(w)),
    "missing asOf should surface as a warning",
  );
});

test("deliverable-bound: missing asOf is an ERROR", () => {
  const block = validBlock();
  delete (block as Record<string, unknown>).asOf;
  const r = lintChartBlock(block, null, { requireAsOf: true });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /asOf/i.test(e)));
});

test("deliverable-bound: present ISO asOf is OK", () => {
  const r = lintChartBlock(validBlock(), null, { requireAsOf: true });
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
});

// --- asOf shape: malformed is an error in BOTH modes -----------------------

test("malformed asOf ('Jun 2026' display string) is an error", () => {
  const r = lintChartBlock(validBlock({ asOf: "Jun 2026" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /asOf/i.test(e) && /ISO/i.test(e)));
});

test("asOf with ISO shape but an impossible calendar date is an error", () => {
  const r = lintChartBlock(validBlock({ asOf: "2026-13-40" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /asOf/i.test(e)));
});

test("malformed asOf is an error even in deliverable-bound mode", () => {
  const r = lintChartBlock(validBlock({ asOf: "2026/06/01" }), null, {
    requireAsOf: true,
  });
  assert.equal(r.ok, false);
});

// --- source is PROVENANCE: structure validated, content NEVER policed -------

test("source.citation with jargon ('NNN', 'corridor') is NOT flagged", () => {
  const r = lintChartBlock(
    validBlock({
      source: {
        citation: "NNN triple-net asking rents across the corridor — §3",
        url: "https://example.test/cre",
      },
    }),
  );
  assert.deepEqual(r, { ok: true, errors: [], warnings: [] });
});

test("source present but citation empty is a structural error", () => {
  const r = lintChartBlock(validBlock({ source: { citation: "" } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /citation/i.test(e)));
});

test("source.url, when present, must be a string", () => {
  const r = lintChartBlock(validBlock({ source: { citation: "ok", url: 42 } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /url/i.test(e)));
});

// --- provenance number check still composes with asOf ----------------------

test("fact-pack provenance check still runs alongside asOf validation", () => {
  // 999 is not in the fact pack -> provenance error; asOf is clean.
  const block = validBlock({
    rows: [
      ["33901", 350000],
      ["33913", 919191],
      ["34102", 999],
    ],
  });
  const r = lintChartBlock(block, new Set([350000, 919191, 1200000]));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /chart-provenance/i.test(e)));
});
