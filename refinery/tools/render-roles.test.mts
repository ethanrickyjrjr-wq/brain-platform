import { test } from "bun:test";
import assert from "node:assert/strict";
import { buildCategoryLookup } from "./render-roles.mts";
import { resetVocabularyCacheSync } from "../vocab/loader.mts";

test("buildCategoryLookup: literal slug_index hit returns concept.category (real vocab)", () => {
  resetVocabularyCacheSync();
  const lookup = buildCategoryLookup();
  // `cap_rate_median` is a registered slug pointing at `cre_cap_rate_median`
  // (category: "real-estate"). Pre-existing behavior — must keep working.
  assert.equal(lookup("cap_rate_median"), "real-estate");
});

test("buildCategoryLookup: unknown slug returns null (no false categorization)", () => {
  const lookup = buildCategoryLookup();
  assert.equal(lookup("totally_made_up_slug_xyz"), null);
});

test("buildCategoryLookup: env-swfl per-ZIP slugs resolve to 'environmental' across all 3 modes (real vocab)", () => {
  // Without the pattern fallback in render-roles, these templated slugs land
  // as "uncategorized" in the role-view renderer. The constitution layer
  // already matches them via regex (real-estate.mts:flood-barrier-mode-1)
  // but the role-view partitioning was the second blind call site — this
  // test pins the fix.
  //
  // One ZIP from each barrier-island classification (refinery/lib/swfl-geo.mts):
  // 33931 Fort Myers Beach (Mode 1 / barrier, score 1.0)
  // 34134 Bonita Beach (Mode 2 / coastal-mainland, score 0.5)
  // 34112 East Naples (Mode 3 / inland, score 0.0)
  const lookup = buildCategoryLookup();
  for (const zip of ["33931", "34134", "34112"]) {
    assert.equal(
      lookup(`swfl_zip_${zip}_flood_aal_usd_per_insured_property`),
      "environmental",
      `ZIP ${zip} per-insured-property AAL → environmental`,
    );
    assert.equal(
      lookup(`swfl_zip_${zip}_barrier_island_score`),
      "environmental",
      `ZIP ${zip} barrier-island score → environmental`,
    );
    assert.equal(
      lookup(`swfl_zip_${zip}_flood_cap_rate_adj_bps`),
      "environmental",
      `ZIP ${zip} flood cap-rate adjustment → environmental`,
    );
    assert.equal(
      lookup(`swfl_zip_${zip}_insurance_pct_typical_noi`),
      "environmental",
      `ZIP ${zip} insurance-pct-typical-noi → environmental`,
    );
    assert.equal(
      lookup(`swfl_zip_${zip}_flood_aal_pct_swfl_rank`),
      "environmental",
      `ZIP ${zip} AAL percentile rank → environmental`,
    );
  }
});
