import { test } from "bun:test";
import assert from "node:assert/strict";

import { env } from "./env.mts";

/**
 * Regression guard for the 2026-05-20 Group C bisect (anchor SHA `367d627`).
 *
 * Pre-refactor, `env.source` was snapshotted at module-load via a top-level
 * `readEnv()` call. Any module that transitively imported `env.mts` before a
 * test set `REFINERY_SOURCE` locked `env.source = "live"` for the rest of the
 * process — manifest as a ~50-test cascade + 210× wall-clock regression when
 * a `constitution → packs/env-swfl.mts` import was added.
 *
 * The fix converts `env.source` to a getter that re-reads
 * `process.env.REFINERY_SOURCE` on every access. These tests assert that
 * post-import mutation of the env var is observable through `env.source`.
 */

test("env.source: re-reads REFINERY_SOURCE after module load (fixture)", () => {
  const prior = process.env.REFINERY_SOURCE;
  try {
    process.env.REFINERY_SOURCE = "fixture";
    assert.equal(env.source, "fixture");
  } finally {
    if (prior === undefined) delete process.env.REFINERY_SOURCE;
    else process.env.REFINERY_SOURCE = prior;
  }
});

test("env.source: re-reads REFINERY_SOURCE after module load (live)", () => {
  const prior = process.env.REFINERY_SOURCE;
  try {
    process.env.REFINERY_SOURCE = "live";
    assert.equal(env.source, "live");
  } finally {
    if (prior === undefined) delete process.env.REFINERY_SOURCE;
    else process.env.REFINERY_SOURCE = prior;
  }
});

test("env.source: defaults to 'live' when REFINERY_SOURCE is unset", () => {
  const prior = process.env.REFINERY_SOURCE;
  try {
    delete process.env.REFINERY_SOURCE;
    assert.equal(env.source, "live");
  } finally {
    if (prior !== undefined) process.env.REFINERY_SOURCE = prior;
  }
});

test("env.source: any non-'fixture' value resolves to 'live'", () => {
  const prior = process.env.REFINERY_SOURCE;
  try {
    process.env.REFINERY_SOURCE = "garbage";
    assert.equal(env.source, "live");
  } finally {
    if (prior === undefined) delete process.env.REFINERY_SOURCE;
    else process.env.REFINERY_SOURCE = prior;
  }
});
