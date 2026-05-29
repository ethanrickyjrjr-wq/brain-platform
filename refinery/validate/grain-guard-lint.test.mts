import { test } from "bun:test";
import assert from "node:assert/strict";
import { lintGrainGuard } from "./grain-guard-lint.mts";
import type { GrainBoundary } from "../types/brain-output.mts";

function gb(over: Partial<GrainBoundary> = {}): {
  grain_boundary: GrainBoundary;
} {
  return {
    grain_boundary: {
      not_available: over.not_available ?? [
        "Outcomes for a specific named business or street address.",
        "ZIP-level housing detail is not weighted in this read right now.",
      ],
      finest_grain: over.finest_grain ?? "county-month",
    },
  };
}

test("lintGrainGuard: absent grain_boundary is a no-op pass", () => {
  const r = lintGrainGuard({ grain_boundary: undefined });
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test("lintGrainGuard: well-formed boundary passes", () => {
  const r = lintGrainGuard(gb());
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test("lintGrainGuard: malformed finest_grain fails the format check", () => {
  for (const bad of [
    "countyMonth",
    "County-Month",
    "county_month",
    "county",
    "county-month-day",
  ]) {
    const r = lintGrainGuard(gb({ finest_grain: bad }));
    assert.equal(r.ok, false, `expected "${bad}" to fail`);
    assert.ok(r.violations.some((v) => v.field === "finest_grain"));
  }
});

test("lintGrainGuard: inference-shaped not_available entry is rejected", () => {
  const r = lintGrainGuard(
    gb({
      not_available: [
        "ZIP prices will likely rise next quarter.", // a prediction, not a gap
      ],
    }),
  );
  assert.equal(r.ok, false);
  const v = r.violations.find((v) => v.field === "not_available");
  assert.ok(v);
  assert.match(v!.reason, /inference-shaped/);
});

test("lintGrainGuard: honest scope-gap phrasing is not flagged", () => {
  // None of these are predictions — they state absence, which is allowed.
  const r = lintGrainGuard(
    gb({
      not_available: [
        "We do not hold per-parcel valuations outside Lee County.",
        "Sub-monthly timing is not available for most series.",
        "Corridor-level absorption is not weighted in this read right now.",
      ],
    }),
  );
  assert.equal(r.ok, true);
});
