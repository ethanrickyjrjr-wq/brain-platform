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
import { resolveGradeConfig } from "./loader.mts";

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
 * 1a lock — out-of-enum polarity is rejected at the runtime source, with the
 * raw token named in the reason (the audit trail). Before §1a the polarity gate
 * checked only `=== "none"`, so a present-but-out-of-enum value ("neutral",
 * "higher_is_bearish") passed as "declared" and could reach gradeable:true with
 * a garbage polarity. This pins the enum-membership gate.
 */
test("1a: out-of-enum polarity is rejected, raw token in reason (licenses_cbc_share_swfl)", () => {
  // licenses_cbc_share_swfl declares direction_polarity: "neutral" in the vocab
  // — present, but ∉ {higher_is_bullish, lower_is_bullish}.
  const cfg = resolveGradeConfig("licenses_cbc_share_swfl");

  assert.equal(cfg.gradeable, false, "out-of-enum polarity must be ungradeable");
  assert.equal(
    cfg.direction_polarity,
    "none",
    "invalid polarity normalizes to none in the resolved config",
  );
  // SOFT FLAG: provenance reads off the RAW token — the slug DID declare a
  // value, so source.polarity is "slug", not null (else the audit would falsely
  // imply the slug declared nothing).
  assert.equal(
    cfg.source.polarity,
    "slug",
    "raw token present → source.polarity is 'slug', not null",
  );
  // The raw token rides verbatim in the reason — the directional-audit trail.
  assert.ok(
    cfg.reason?.includes("invalid direction_polarity 'neutral'"),
    `reason must name the raw token verbatim, got: ${cfg.reason}`,
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
