import { test } from "node:test";
import assert from "node:assert/strict";
import { SMOOTHING_TOKENS } from "./smoothing-tokens.mts";

test("SMOOTHING_TOKENS exposes exactly two groups", () => {
  const keys = Object.keys(SMOOTHING_TOKENS).sort();
  assert.deepEqual(keys, ["numeric_softening", "prose_confidence_translation"]);
});

test("numeric_softening group is non-empty", () => {
  assert.ok(SMOOTHING_TOKENS.numeric_softening.length > 0);
});

test("prose_confidence_translation group is non-empty", () => {
  assert.ok(SMOOTHING_TOKENS.prose_confidence_translation.length > 0);
});

test("numeric_softening contains the locked v2 tokens", () => {
  // Per Lane 1D spec in cosmic-rolling-brook.md (post-v2 cleanup).
  // Spatial smoothing tokens were intentionally dropped (Wave 2A killed).
  const expected = [
    "approximately",
    "roughly",
    "ballpark",
    "on the order of",
    "smoothed",
    "interpolated",
    "extrapolated",
    "estimated from",
    "rounded to",
    "in the range of",
  ];
  for (const token of expected) {
    assert.ok(
      (SMOOTHING_TOKENS.numeric_softening as readonly string[]).includes(token),
      `expected numeric_softening to include "${token}"`,
    );
  }
});

test("prose_confidence_translation contains the locked v2 tokens", () => {
  const expected = [
    "fairly confident",
    "high confidence",
    "moderate confidence",
    "low confidence",
    "we're confident",
    "the model suggests",
    "with reasonable certainty",
  ];
  for (const token of expected) {
    assert.ok(
      (
        SMOOTHING_TOKENS.prose_confidence_translation as readonly string[]
      ).includes(token),
      `expected prose_confidence_translation to include "${token}"`,
    );
  }
});

test("no spatial group exists (Wave 2A polygons killed in v2)", () => {
  assert.equal(
    (SMOOTHING_TOKENS as Record<string, unknown>).spatial_apportionment,
    undefined,
  );
});

test("every token is a non-empty trimmed string", () => {
  const groups = Object.values(SMOOTHING_TOKENS) as readonly string[][];
  for (const group of groups) {
    for (const token of group) {
      assert.equal(typeof token, "string");
      assert.ok(token.length > 0, "token must be non-empty");
      assert.equal(token, token.trim(), "token must be trimmed");
    }
  }
});

test("tokens are unique within each group", () => {
  for (const [groupName, tokens] of Object.entries(SMOOTHING_TOKENS)) {
    const set = new Set(tokens as readonly string[]);
    assert.equal(
      set.size,
      (tokens as readonly string[]).length,
      `duplicate token(s) in group "${groupName}"`,
    );
  }
});
