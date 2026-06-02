import { test } from "bun:test";
import assert from "node:assert/strict";
import { PACKS } from "../config/packs.mts";

// Snapshot test — locks exactly which edges are critical: true.
// Changing the critical set requires a deliberate update here AND a plan-phase
// approval (Phase 3+ in the Brain Resilience System plan).
test("critical edge set is locked", () => {
  const criticalIds = Object.values(PACKS)
    .flatMap((p) => p.input_brains ?? [])
    .filter((e) => e.critical)
    .map((e) => e.id)
    .sort();
  assert.deepEqual(criticalIds, [
    "cre-swfl",
    "env-swfl",
    "macro-florida",
    "macro-swfl",
    "macro-us",
  ]);
});
