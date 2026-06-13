// refinery/lib/view-row-floor.test.mts
import { test } from "bun:test";
import assert from "node:assert/strict";
import { assertViewRowFloor } from "./view-row-floor.mts";
import { isTransientError } from "./resilient-build.mts";

// GATE B partial-view floor — the latest-per-ZIP brain-input views (zhvi_zip_latest
// 109 ZIPs, zori_zip_latest 94 ZIPs — confirmed live 2026-06-13) hold ~one row per ZIP.
// Production floors: ZHVI 90, ZORI 79 (see each *-zip-latest-source.mts). A sub-floor count
// in live mode = a partial / half-refreshed view (grant works, raw partition shrank),
// which must abort the build LOUDLY rather than let a partial-coverage regional median
// build GREEN. (check: zhvi_zori_gate_b_minrows)

test("assertViewRowFloor throws when the row count is below the floor", () => {
  assert.throws(() => assertViewRowFloor("zhvi_zip_latest", 5, 90));
});

test("assertViewRowFloor passes at exactly the floor (boundary)", () => {
  assert.doesNotThrow(() => assertViewRowFloor("zhvi_zip_latest", 90, 90));
});

test("assertViewRowFloor passes above the floor", () => {
  assert.doesNotThrow(() => assertViewRowFloor("zori_zip_latest", 109, 90));
});

test("the thrown error is DETERMINISTIC (loud → exit 1), never classified transient", () => {
  // This is the GATE B-critical assertion: resilient-build.buildOne classifies a
  // source.fetch() throw, and only a NON-transient message escalates to exit 1
  // (loud + notify). A partial view must NEVER look like a self-healing blip.
  let caught: unknown;
  try {
    assertViewRowFloor("zori_zip_latest", 12, 90);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, "must throw an Error");
  assert.equal(
    isTransientError(caught),
    false,
    "partial-view floor breach must be deterministic, not transient",
  );
});

test("the thrown message names the view, the actual count, and the floor", () => {
  let msg = "";
  try {
    assertViewRowFloor("zhvi_zip_latest", 12, 90);
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  assert.match(msg, /zhvi_zip_latest/);
  assert.match(msg, /12/); // the actual count
  assert.match(msg, /90/); // the floor
});
