import { test, beforeEach } from "bun:test";
import assert from "node:assert/strict";
import { checkRateLimit, clientIpFromHeaders, __resetRateLimitState } from "./rate-limit.ts";

// Defaults: LIMIT=60, WINDOW_MS=60000 (env-overridable; not set in tests).
const LIMIT = 60;
const WINDOW_MS = 60_000;

beforeEach(() => {
  __resetRateLimitState();
});

test("allows requests up to the limit, then blocks the overflow", () => {
  const ip = "1.2.3.4";
  const now = 1_000_000;
  for (let i = 1; i <= LIMIT; i++) {
    const r = checkRateLimit(ip, now);
    assert.equal(r.limited, false, `request ${i} should pass`);
  }
  // The (LIMIT+1)th request in the same window is over the ceiling.
  const over = checkRateLimit(ip, now);
  assert.equal(over.limited, true, "overflow request must be limited");
  assert.equal(over.remaining, 0);
});

test("a normal single read is never limited", () => {
  const r = checkRateLimit("9.9.9.9", 5_000);
  assert.equal(r.limited, false);
  assert.equal(r.remaining, LIMIT - 1);
});

test("window reset clears the count for that IP", () => {
  const ip = "5.6.7.8";
  const start = 2_000_000;
  for (let i = 0; i < LIMIT; i++) checkRateLimit(ip, start);
  assert.equal(checkRateLimit(ip, start).limited, true);
  // After the window elapses, the IP gets a fresh budget.
  const after = start + WINDOW_MS + 1;
  const r = checkRateLimit(ip, after);
  assert.equal(r.limited, false);
  assert.equal(r.remaining, LIMIT - 1);
});

test("limits are tracked per-IP independently", () => {
  const now = 3_000_000;
  for (let i = 0; i < LIMIT; i++) checkRateLimit("10.0.0.1", now);
  assert.equal(checkRateLimit("10.0.0.1", now).limited, true);
  // A different IP is unaffected.
  assert.equal(checkRateLimit("10.0.0.2", now).limited, false);
});

test("clientIpFromHeaders prefers the first x-forwarded-for entry", () => {
  const h = new Headers({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" });
  assert.equal(clientIpFromHeaders(h), "203.0.113.5");
});

test("clientIpFromHeaders falls back to x-real-ip then 'unknown'", () => {
  assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
  assert.equal(clientIpFromHeaders(new Headers()), "unknown");
});
