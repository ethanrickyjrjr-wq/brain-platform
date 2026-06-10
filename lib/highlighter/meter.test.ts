import { test, expect, describe } from "bun:test";
import crypto from "node:crypto";
import { isoWeek, capEnabled, __clientIdFromForTest } from "./meter";

test("isoWeek formats as YYYY-Www", () => {
  expect(isoWeek(new Date("2026-06-07T00:00:00Z"))).toMatch(/^2026-W\d{2}$/);
});

test("capEnabled is false when the env var is unset", () => {
  delete process.env.HIGHLIGHTER_FREE_WEEKLY_CAP;
  expect(capEnabled()).toBe(false);
});

const SECRET = "test-secret";
function signed(id: string) {
  const sig = crypto.createHmac("sha256", SECRET).update(id).digest("hex").slice(0, 16);
  return `${id}.${sig}`;
}

describe("clientIdFrom", () => {
  test("returns the id for a validly signed cookie", () => {
    process.env.SDG_COOKIE_SECRET = SECRET;
    const id = "11111111-2222-3333-4444-555555555555";
    const req = new Request("http://x", { headers: { cookie: `sdg_cid=${signed(id)}` } });
    expect(__clientIdFromForTest(req)).toBe(id);
  });
  test("returns 'anon' for a forged signature", () => {
    process.env.SDG_COOKIE_SECRET = SECRET;
    const req = new Request("http://x", {
      headers: { cookie: "sdg_cid=abc.deadbeefdeadbeef" },
    });
    expect(__clientIdFromForTest(req)).toBe("anon");
  });
  test("returns 'anon' when no cookie", () => {
    process.env.SDG_COOKIE_SECRET = SECRET;
    expect(__clientIdFromForTest(new Request("http://x"))).toBe("anon");
  });
});
