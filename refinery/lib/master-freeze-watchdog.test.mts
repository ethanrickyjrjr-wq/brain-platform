// refinery/lib/master-freeze-watchdog.test.mts
import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  detectSilentMasterFreeze,
  type FreezeWatchdogInput,
} from "./master-freeze-watchdog.mts";

const DAY = 86_400_000;
const MASTER_TTL = 604_800; // 7 days, matches refinery/packs/master.mts

// A baseline silent-freeze: gate ran, run went green, master was due (8 days old
// vs 7-day TTL), and master.md did NOT advance. The watchdog reads ONLY ground
// truth (the file + the clock) — it does not consult the build's classification.
function frozenInput(
  over: Partial<FreezeWatchdogInput> = {},
): FreezeWatchdogInput {
  const before = new Date(Date.now() - 8 * DAY).toISOString();
  return {
    gateRan: true,
    exitCode: 0,
    masterRefinedAtBefore: before,
    masterRefinedAtAfter: before, // unchanged → frozen
    runStartedAtMs: Date.now(),
    ttlSeconds: MASTER_TTL,
    ...over,
  };
}

test("FIRES: due + green(0) + master.md did not advance", () => {
  assert.equal(detectSilentMasterFreeze(frozenInput()).frozen, true);
});

test("FIRES: same freeze surfacing as exit 2 (transient-labelled degrade — no status escape)", () => {
  // A deterministic master defect mislabelled transient lands as exit 2. The
  // watchdog no longer consults build status, so it fires purely on
  // due + green + not-advanced regardless of how the build classified it.
  assert.equal(
    detectSilentMasterFreeze(frozenInput({ exitCode: 2 })).frozen,
    true,
  );
});

test("FIRES: master.md vanished/unreadable after the run (fail closed)", () => {
  const r = detectSilentMasterFreeze(
    frozenInput({ masterRefinedAtAfter: null }),
  );
  assert.equal(r.frozen, true);
  assert.match(r.reason, /missing|unreadable/i);
});

test("FIRES: unparseable before refined_at — cannot verify → fail closed", () => {
  const r = detectSilentMasterFreeze(
    frozenInput({ masterRefinedAtBefore: "not-a-date" }),
  );
  assert.equal(r.frozen, true);
  assert.match(r.reason, /unparseable|fail/i);
});

test("FIRES: after refined_at present but unparseable — differs from before but cannot confirm advance → fail closed", () => {
  // The dangerous false-negative: a garbled-but-present `after` string differs
  // from `before`, so the naive `after !== before` advance test would call it
  // "published normally" and wave a real freeze through. It must fail closed.
  const r = detectSilentMasterFreeze(
    frozenInput({ masterRefinedAtAfter: "2026-13-99Tbroken" }),
  );
  assert.equal(r.frozen, true);
  assert.match(r.reason, /unparseable|after|fail/i);
});

test("quiet: legit skipped-fresh — master within TTL, did not advance", () => {
  const before = new Date(Date.now() - 1 * DAY).toISOString(); // 1 day < 7-day TTL
  assert.equal(
    detectSilentMasterFreeze({
      gateRan: true,
      exitCode: 0,
      masterRefinedAtBefore: before,
      masterRefinedAtAfter: before,
      runStartedAtMs: Date.now(),
      ttlSeconds: MASTER_TTL,
    }).frozen,
    false,
  );
});

test("quiet: legit publish — refined_at advanced (the common exit-2 upstream-degrade case)", () => {
  // An upstream degraded transiently (exit 2) but master itself published →
  // refined_at moved → not a freeze. This is the behavior that MUST stay quiet.
  assert.equal(
    detectSilentMasterFreeze(
      frozenInput({
        exitCode: 2,
        masterRefinedAtAfter: new Date().toISOString(),
      }),
    ).frozen,
    false,
  );
});

test("quiet: exit 1 is already loud (HELD / deterministic) — no double-fire", () => {
  assert.equal(
    detectSilentMasterFreeze(frozenInput({ exitCode: 1 })).frozen,
    false,
  );
});

test("quiet: gate did not run → nothing attempted, nothing to detect", () => {
  assert.equal(
    detectSilentMasterFreeze(frozenInput({ gateRan: false })).frozen,
    false,
  );
});

test("quiet: TTL boundary is strict — exactly at expiry counts as fresh (mirrors brainStatus)", () => {
  // brainStatus: stale = now > expiry. So now === expiry is FRESH → not due.
  const runStartedAtMs = Date.now();
  const before = new Date(runStartedAtMs - MASTER_TTL * 1000).toISOString();
  assert.equal(
    detectSilentMasterFreeze({
      gateRan: true,
      exitCode: 0,
      masterRefinedAtBefore: before,
      masterRefinedAtAfter: before,
      runStartedAtMs,
      ttlSeconds: MASTER_TTL,
    }).frozen,
    false,
  );
});

test("quiet: no prior master.md (cold start) → out of scope, no false alarm", () => {
  assert.equal(
    detectSilentMasterFreeze(
      frozenInput({ masterRefinedAtBefore: null, masterRefinedAtAfter: null }),
    ).frozen,
    false,
  );
});

test("reason is human-readable when it fires", () => {
  const r = detectSilentMasterFreeze(frozenInput());
  assert.ok(r.reason.length > 0);
  assert.match(r.reason, /frozen|advance|stale/i);
});
