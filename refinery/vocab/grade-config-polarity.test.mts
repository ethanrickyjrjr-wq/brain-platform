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
