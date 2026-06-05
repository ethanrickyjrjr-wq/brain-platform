/**
 * R4 lock — per-slug polarity, never inherited.
 *
 * `resolveGradeConfig` (refinery/vocab/loader.mts) resolves `direction_polarity`
 * from the concept's own `grade` block ONLY — never from a category/value_type
 * default (unlike window_days and epsilon, which DO inherit). A slug with no
 * declared polarity is ungradeable. This is a correctness constraint, not a
 * style choice: within one category, survival-rate (higher = bullish) and
 * charge-off (higher = bearish) have OPPOSITE polarity, so any category default
 * would silently grade one of them backward — the cre-swfl polarity-flip class.
 *
 * This test pins that invariant so a future refactor (e.g. adding a
 * CATEGORY_POLARITY map next to CATEGORY_WINDOW_DAYS) cannot regress it without
 * turning this test red. It also forward-guards any multi-metric vote built on
 * top of resolveGradeConfig: every voting metric must carry its own polarity.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { loadVocabulary } from "../stages/2.5-normalize.mts";
import {
  classifyPolarity,
  polarityFailureReason,
  resolveGradeConfig,
} from "./loader.mts";

test("R4: every gradeable slug declares its own polarity — none inherited", async () => {
  const vocab = await loadVocabulary();
  const offenders: string[] = [];

  for (const conceptId of Object.keys(vocab.concepts)) {
    const cfg = resolveGradeConfig(conceptId);
    if (!cfg.gradeable) continue; // ungradeable slugs can't grade anything backward
    // A gradeable slug MUST have resolved polarity from the slug itself.
    // source.polarity === "slug" is the only honest provenance; "none" polarity
    // can never be gradeable, so either of these failing means a default crept in.
    if (cfg.source.polarity !== "slug" || cfg.direction_polarity === "none") {
      offenders.push(
        `${conceptId} (polaritySource=${cfg.source.polarity}, polarity=${cfg.direction_polarity})`,
      );
    }
  }

  assert.equal(
    offenders.length,
    0,
    `gradeable slugs with inherited/absent polarity (a category default has crept in):\n  ${offenders.join("\n  ")}`,
  );
});

/**
 * 1a lock — out-of-enum polarity produces a reason that names the raw token
 * verbatim (the directional-audit trail, sweep-spec.md §4). Before §1a the
 * polarity gate checked only `=== "none"`, so a present-but-out-of-enum value
 * ("neutral", "higher_is_bearish") passed as "declared" and could reach
 * gradeable:true with a garbage polarity. This pins the enum-membership gate.
 *
 * Tested against the PURE `polarityFailureReason` helper rather than a live
 * invalid slug: the COND 1/2 directional audit cleaned every out-of-enum token
 * out of the corpus (zero invalid-polarity slugs is a completion criterion), so
 * pinning on a live slug would force keeping a deliberately-broken token. The
 * helper carries the contract independent of corpus contents.
 */
test("1a: out-of-enum polarity reason names the raw token verbatim (pure)", () => {
  assert.equal(
    polarityFailureReason("neutral"),
    "invalid direction_polarity 'neutral' (not in enum)",
  );
  assert.equal(
    polarityFailureReason("higher_is_bearish"),
    "invalid direction_polarity 'higher_is_bearish' (not in enum)",
  );
  // absent / "none" → the declared-but-non-directional reason, no token named.
  assert.equal(
    polarityFailureReason(null),
    "no direction_polarity declared (slug-only, never inherited)",
  );
  assert.equal(
    polarityFailureReason(undefined),
    "no direction_polarity declared (slug-only, never inherited)",
  );
  assert.equal(
    polarityFailureReason("none"),
    "no direction_polarity declared (slug-only, never inherited)",
  );
});

/**
 * Corpus regression: licenses_cbc_share_swfl is now a CLEAN declared-`none`
 * (the COND 2 ruling — genuinely non-directional, consumer licenses-swfl.mts
 * declares "No universal bullish/bearish polarity"). Ungradeable, but for the
 * honest "declared none" reason — not the out-of-enum reason. Flips red if the
 * "neutral" token is ever reintroduced.
 */
test("COND 2: licenses_cbc_share_swfl resolves as a clean declared-none", () => {
  const cfg = resolveGradeConfig("licenses_cbc_share_swfl");
  assert.equal(
    cfg.gradeable,
    false,
    "non-directional ratio must be ungradeable",
  );
  assert.equal(cfg.direction_polarity, "none");
  assert.equal(
    cfg.reason,
    "no direction_polarity declared (slug-only, never inherited)",
    `expected the declared-none reason, got: ${cfg.reason}`,
  );
});

/**
 * 1a full-vocab enum-scan — no out-of-enum polarity reaches gradeable:true
 * anywhere in the corpus. The R4 test above guards gradeable→declared-own;
 * this guards the dual: declared-but-out-of-enum→ungradeable, across all slugs.
 */
test("1a: no out-of-enum polarity reaches gradeable:true (full-vocab scan)", async () => {
  const vocab = await loadVocabulary();
  const VALID = new Set(["higher_is_bullish", "lower_is_bullish"]);
  const leaks: string[] = [];

  for (const conceptId of Object.keys(vocab.concepts)) {
    const cfg = resolveGradeConfig(conceptId);
    if (!cfg.gradeable) continue;
    // A gradeable slug's resolved polarity MUST be one of the two valid tokens.
    // "none" can never be gradeable; an out-of-enum token must have normalized
    // to "none" and been gated out — if it didn't, it leaked.
    if (!VALID.has(cfg.direction_polarity)) {
      leaks.push(`${conceptId} (direction_polarity=${cfg.direction_polarity})`);
    }
  }

  assert.equal(
    leaks.length,
    0,
    `gradeable slugs with non-valid polarity reached gradeable:true:\n  ${leaks.join("\n  ")}`,
  );
});

// ---------------------------------------------------------------------------
// classifyPolarity three-state lattice
// ---------------------------------------------------------------------------

test("classifyPolarity: three-state lattice over the raw token", () => {
  assert.equal(classifyPolarity("higher_is_bullish"), "valid_directional");
  assert.equal(classifyPolarity("lower_is_bullish"), "valid_directional");
  assert.equal(classifyPolarity("none"), "none");
  assert.equal(classifyPolarity(null), "none");
  assert.equal(classifyPolarity(undefined), "none");
  assert.equal(classifyPolarity("neutral"), "invalid");
  assert.equal(classifyPolarity("higher_is_bearish"), "invalid");
});
