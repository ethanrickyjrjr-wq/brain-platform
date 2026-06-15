import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  LAKE_ID,
  freshnessToken,
  freshnessComment,
  parseFreshnessComment,
  expiresFor,
  freshnessGate,
} from "./freshness.mts";

test("LAKE_ID is the fixed SWFL constant", () => {
  assert.equal(LAKE_ID, "7421");
});

test("freshnessToken builds SWFL-7421-v{n}-{YYYYMMDD}", () => {
  assert.equal(freshnessToken(4, "2026-05-14T19:21:08Z"), "SWFL-7421-v4-20260514");
  assert.equal(freshnessToken(2, "2026-05-14T11:44:04Z"), "SWFL-7421-v2-20260514");
});

test("freshnessComment wraps the token", () => {
  assert.equal(
    freshnessComment(4, "SWFL-7421-v4-20260514"),
    "<!-- FRESHNESS: v4 | Token: SWFL-7421-v4-20260514 -->",
  );
});

test("parseFreshnessComment reads a well-formed comment", () => {
  assert.deepEqual(parseFreshnessComment("<!-- FRESHNESS: v4 | Token: SWFL-7421-v4-20260514 -->"), {
    version: 4,
    token: "SWFL-7421-v4-20260514",
  });
});

test("parseFreshnessComment returns null on malformed input", () => {
  assert.equal(parseFreshnessComment(""), null);
  assert.equal(parseFreshnessComment("not a comment"), null);
  assert.equal(parseFreshnessComment("<!-- something else -->"), null);
  assert.equal(parseFreshnessComment("<!-- FRESHNESS: 4 | Token: x -->"), null);
  assert.equal(parseFreshnessComment("FRESHNESS: v4 | Token: x"), null);
});

test("round-trip: parse(comment(token)) recovers version and token", () => {
  for (const [v, ts] of [
    [4, "2026-05-14T19:21:08Z"],
    [5, "2026-05-14T19:21:06Z"],
    [2, "2026-05-14T11:44:04Z"],
    [3, "2026-05-14T04:00:00Z"],
  ] as const) {
    const token = freshnessToken(v, ts);
    const parsed = parseFreshnessComment(freshnessComment(v, token));
    assert.deepEqual(parsed, { version: v, token });
  }
});

// --- expiresFor: refined_at + ttl_seconds -> ISO expiry (ms-stripped) ---

test("expiresFor: canonical 35-day TTL lands on the exact ms-stripped ISO", () => {
  // Mirrors task-1 acceptance literal verbatim. isoTimestamp strips only the
  // .000 ms, so there is no `.000` segment in the result.
  assert.equal(expiresFor("2026-05-01T00:00:00Z", 86400 * 35), "2026-06-05T00:00:00Z");
});

test("expiresFor: a 1-day TTL preserves the sub-day (HH:MM:SS) offset", () => {
  // Distinguishes expiresFor from the date-only `expiresDate` helper — it keeps
  // second precision so freshnessGate compares at the right instant.
  assert.equal(expiresFor("2026-06-15T12:00:00Z", 86400), "2026-06-16T12:00:00Z");
  assert.equal(expiresFor("2026-05-01T08:30:15Z", 86400), "2026-05-02T08:30:15Z");
});

test("expiresFor: R2 NaN-guard — unparseable refined_at returns undefined (never throws)", () => {
  // The worst-direction failure would be `new Date(NaN).toISOString()` throwing
  // RangeError; a corrupt refined_at must degrade to no-TTL-basis, not a crash.
  assert.equal(expiresFor("not-a-date", 86400), undefined);
  assert.equal(expiresFor("", 86400), undefined);
});

// --- freshnessGate: the ONLY reject primitive, fail-closed ---

test("freshnessGate: an expired stamp rejects and reports days_past", () => {
  const g = freshnessGate("2026-01-01T00:00:00Z", "2026-06-15T00:00:00Z");
  assert.equal(g.fresh, false);
  assert.equal(g.expired, true);
  assert.equal(g.expires_at, "2026-01-01T00:00:00Z");
  assert.equal(g.days_past, 165); // Jan 1 -> Jun 15 2026 = 165 days
});

test("freshnessGate: a future stamp is fresh and omits days_past", () => {
  const g = freshnessGate("2026-12-31T00:00:00Z", "2026-06-15T00:00:00Z");
  assert.equal(g.fresh, true);
  assert.equal(g.expired, false);
  assert.equal(g.expires_at, "2026-12-31T00:00:00Z");
  assert.equal(g.days_past, undefined);
});

test("freshnessGate: the expiry instant itself is still fresh (strict >)", () => {
  // now === expires -> not yet past -> fresh; one ms later -> expired.
  const at = freshnessGate("2026-06-15T00:00:00Z", "2026-06-15T00:00:00Z");
  assert.equal(at.fresh, true);
  assert.equal(at.expired, false);
  const past = freshnessGate("2026-06-15T00:00:00.000Z", "2026-06-15T00:00:00.001Z");
  assert.equal(past.expired, true);
  assert.ok((past.days_past ?? 0) > 0);
});

test("freshnessGate: N1 — garbage `expires` FAILS CLOSED (never reports fresh)", () => {
  // The bare `now > Date.parse(expires)` would be `now > NaN` === false ->
  // expired:false -> the metric reads FRESH. The NaN-guard must run first.
  const g = freshnessGate("garbage", "2026-06-15T00:00:00Z");
  assert.equal(g.fresh, false);
  assert.equal(g.expired, true);
  assert.equal(g.expires_at, "garbage");
  assert.equal(g.days_past, undefined);
  assert.equal(freshnessGate("", "2026-06-15T00:00:00Z").expired, true);
});

test("freshnessGate: an unparseable `now` also fails closed", () => {
  const g = freshnessGate("2026-12-31T00:00:00Z", "garbage");
  assert.equal(g.fresh, false);
  assert.equal(g.expired, true);
});

test("freshnessGate: default `now` resolves to the live clock", () => {
  assert.equal(freshnessGate("1999-01-01T00:00:00Z").expired, true);
  assert.equal(freshnessGate("2999-01-01T00:00:00Z").fresh, true);
});
