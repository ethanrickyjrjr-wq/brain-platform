import { buildFreshnessToken, buildFreshnessComment, parseFreshnessToken } from "./freshness.mts";
import assert from "node:assert";
import test from "node:test";

test("freshness token builder", () => {
  const t = buildFreshnessToken(4, "2026-05-14T20:00:00Z");
  assert.strictEqual(t, "SWFL-7421-v4-20260514");
});

test("freshness token builder (ALPHA)", () => {
  const t = buildFreshnessToken("ALPHA", "2026-05-14T20:00:00Z");
  assert.strictEqual(t, "SWFL-7421-ALPHA");
});

test("freshness comment builder", () => {
  const t = "SWFL-7421-v4-20260514";
  const c = buildFreshnessComment(4, t);
  assert.strictEqual(c, "<!-- FRESHNESS: v4 | Token: SWFL-7421-v4-20260514 -->");
});

test("freshness token parser", () => {
  const t = "SWFL-7421-v4-20260514";
  const p = parseFreshnessToken(t);
  assert.deepStrictEqual(p, {
    prefix: "SWFL",
    lake: "7421",
    version: "v4",
    date: "20260514",
  });
});
