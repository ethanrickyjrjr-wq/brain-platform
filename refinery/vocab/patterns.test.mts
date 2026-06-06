import { test } from "bun:test";
import assert from "node:assert/strict";
import { compilePatterns, matchSlugPattern } from "./patterns.mts";
import type { Vocabulary, VocabConcept } from "../stages/2.5-normalize.mts";

function makeConcept(
  id: string,
  raw_slug_patterns: string[],
  extras: Partial<VocabConcept> = {},
): VocabConcept {
  return {
    id,
    prefLabel: id,
    raw_slugs: [],
    category: "env",
    status: "active",
    raw_slug_patterns,
    ...extras,
  };
}

function makeVocab(concepts: VocabConcept[]): Vocabulary {
  return {
    meta: {
      schema_version: "test",
      created_at: "2026-05-20",
      description: "test fixture",
    },
    concepts: Object.fromEntries(concepts.map((c) => [c.id, c])),
    ordered_collections: {},
    slug_index: {},
  };
}

test("matchSlugPattern: exact match against a swfl_zip_*_<metric> pattern returns the parent concept id", () => {
  const vocab = makeVocab([
    makeConcept("flood_aal_usd_per_insured_property", [
      "swfl_zip_*_flood_aal_usd_per_insured_property",
    ]),
  ]);
  const compiled = compilePatterns(vocab);
  assert.equal(
    matchSlugPattern(
      "swfl_zip_33931_flood_aal_usd_per_insured_property",
      compiled,
    ),
    "flood_aal_usd_per_insured_property",
  );
});

test("matchSlugPattern: returns null for a slug that does not match any pattern", () => {
  const vocab = makeVocab([
    makeConcept("flood_aal_usd_per_insured_property", [
      "swfl_zip_*_flood_aal_usd_per_insured_property",
    ]),
  ]);
  const compiled = compilePatterns(vocab);
  assert.equal(matchSlugPattern("cre_cap_rate_median", compiled), null);
});

test("matchSlugPattern: regex metacharacters in a pattern are escaped, not interpreted", () => {
  // A pattern containing a literal "." must match the literal ".", not "any char".
  // Same for "[" — must not start a character class.
  const vocab = makeVocab([
    makeConcept("dotted_concept", ["literal.dotted_*"]),
    makeConcept("bracket_concept", ["literal[bracket]_*"]),
  ]);
  const compiled = compilePatterns(vocab);
  // The literal dotted pattern matches only the literal "." sequence.
  assert.equal(
    matchSlugPattern("literal.dotted_value", compiled),
    "dotted_concept",
  );
  // "any_char_dotted_value" would have matched if "." were treated as regex
  // wildcard. Assert it does NOT match.
  assert.equal(matchSlugPattern("literalXdotted_value", compiled), null);
  // Bracket pattern matches only the literal bracket sequence.
  assert.equal(
    matchSlugPattern("literal[bracket]_value", compiled),
    "bracket_concept",
  );
});

test("matchSlugPattern: glob * matches a single underscore-bounded segment, not across segments", () => {
  // swfl_zip_<ZIP>_<metric> — the * stands in for the ZIP slot only.
  // A slug with an EXTRA underscored segment must NOT match the same pattern,
  // otherwise the pattern would over-eagerly absorb downstream metric variants.
  const vocab = makeVocab([
    makeConcept("flood_aal_usd_per_insured_property", [
      "swfl_zip_*_flood_aal_usd_per_insured_property",
    ]),
  ]);
  const compiled = compilePatterns(vocab);
  assert.equal(
    matchSlugPattern(
      "swfl_zip_33931_extra_segment_flood_aal_usd_per_insured_property",
      compiled,
    ),
    null,
  );
});

test("matchSlugPattern: glob ** matches a multi-word (multi-segment) tail", () => {
  // marketbeat per-place metrics: the place tail is 1+ underscore-bounded
  // segments (naples / bonita_springs / collier_county). A single `*` would
  // miss the multi-word ones; `**` covers them all under one pattern.
  const vocab = makeVocab([
    makeConcept("mb_vacancy", ["vacancy_rate_marketbeat_**"]),
  ]);
  const compiled = compilePatterns(vocab);
  assert.equal(
    matchSlugPattern("vacancy_rate_marketbeat_naples", compiled),
    "mb_vacancy",
  );
  assert.equal(
    matchSlugPattern("vacancy_rate_marketbeat_bonita_springs", compiled),
    "mb_vacancy",
  );
  assert.equal(
    matchSlugPattern("vacancy_rate_marketbeat_collier_county", compiled),
    "mb_vacancy",
  );
  // a different metric family must NOT match this pattern
  assert.equal(
    matchSlugPattern("asking_rent_nnn_marketbeat_naples", compiled),
    null,
  );
});

test("matchSlugPattern: single * still does NOT cross segments after ** support added", () => {
  // Regression guard: adding `**` must not loosen `*`.
  const vocab = makeVocab([makeConcept("single", ["swfl_zip_*_thing"])]);
  const compiled = compilePatterns(vocab);
  assert.equal(matchSlugPattern("swfl_zip_33931_thing", compiled), "single");
  assert.equal(matchSlugPattern("swfl_zip_33931_extra_thing", compiled), null);
});

test("matchSlugPattern: concepts without raw_slug_patterns are not compiled (no false matches)", () => {
  const vocab = makeVocab([
    makeConcept("with_pattern", ["swfl_zip_*_thing"]),
    makeConcept("without_pattern", [], { raw_slug_patterns: undefined }),
  ]);
  const compiled = compilePatterns(vocab);
  // The second concept declared no patterns, so it should not appear in the
  // compiled set at all. Verify the compiled list size matches the pattern-
  // bearing concept count.
  assert.equal(compiled.length, 1);
  assert.equal(compiled[0].conceptId, "with_pattern");
});

test("compilePatterns: returns an empty list when no concept declares raw_slug_patterns", () => {
  const vocab = makeVocab([makeConcept("no_pattern_concept", [])]);
  assert.equal(compilePatterns(vocab).length, 0);
});

test("compilePatterns: caches per vocab object (WeakMap key stability)", () => {
  // Same vocab object → same compiled array reference. Hot-path assertion for
  // the long-running CLI. Tests that reset the loader cache create a NEW vocab
  // object every time, so the WeakMap is cold under those conditions — see
  // the inline comment in patterns.mts.
  const vocab = makeVocab([
    makeConcept("flood_aal_usd_per_insured_property", [
      "swfl_zip_*_flood_aal_usd_per_insured_property",
    ]),
  ]);
  const a = compilePatterns(vocab);
  const b = compilePatterns(vocab);
  assert.equal(a, b);
});
