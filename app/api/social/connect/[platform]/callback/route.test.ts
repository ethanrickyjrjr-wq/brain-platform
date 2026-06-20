/**
 * Callback route: CSRF state enforcement + token persistence.
 * Real oauth-config (decode + exchangeCode over a mocked fetch); storeTokens is a
 * spy so we assert the callback PERSISTS without touching crypto/DB.
 */
import { test, expect, mock, beforeEach, afterEach } from "bun:test";
import { NextRequest } from "next/server";
import { encodeOAuthState } from "@/lib/social/connect/oauth-config";

const captured: { storeArgs?: unknown[] } = {};
const scenario: { user: { id: string } | null; cookie: string | undefined } = {
  user: { id: "user-a" },
  cookie: undefined,
};

mock.module("@/lib/social/oauth-tokens", () => ({
  storeTokens: async (...args: unknown[]) => {
    captured.storeArgs = args;
  },
  revokeToken: async () => ({ revokedRows: 0 }),
}));
mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
  }),
}));
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) => (scenario.cookie ? { value: scenario.cookie } : undefined),
    getAll: () => [],
  }),
}));

const { GET } = await import("./route");

const realFetch = globalThis.fetch;

function stubXFetch() {
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    const json =
      url === "https://api.x.com/2/users/me"
        ? { data: { id: "1799", username: "swfldata" } }
        : { access_token: "a", refresh_token: "r", expires_in: 7200, scope: "tweet.write" };
    return {
      ok: true,
      status: 200,
      json: async () => json,
      text: async () => JSON.stringify(json),
    };
  }) as typeof fetch;
}

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.cookie = undefined;
  captured.storeArgs = undefined;
  process.env.X_CLIENT_ID = "x-id";
  process.env.X_CLIENT_SECRET = "x-secret";
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.swfldatagulf.com";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function callbackReq(query: string) {
  return new NextRequest(`https://www.swfldatagulf.com/api/social/connect/x/callback?${query}`);
}
const ctx = { params: Promise.resolve({ platform: "x" }) };

test("state mismatch → error redirect, NO token exchange", async () => {
  scenario.cookie = encodeOAuthState({ p: "x", s: "AAA", v: "V", r: "/project/9" });
  const res = await GET(callbackReq("code=C&state=BBB"), ctx);
  expect(res.status).toBeGreaterThanOrEqual(300);
  const loc = res.headers.get("location") ?? "";
  expect(loc).toContain("social=error");
  expect(loc).toContain("reason=state");
  expect(captured.storeArgs).toBeUndefined();
});

test("absent cookie → state reject (no exchange)", async () => {
  scenario.cookie = undefined;
  const res = await GET(callbackReq("code=C&state=BBB"), ctx);
  expect(res.headers.get("location") ?? "").toContain("reason=state");
  expect(captured.storeArgs).toBeUndefined();
});

test("cookie minted for a different platform → reject", async () => {
  scenario.cookie = encodeOAuthState({ p: "linkedin", s: "MATCH", v: null, r: "/" });
  const res = await GET(callbackReq("code=C&state=MATCH"), ctx);
  expect(res.headers.get("location") ?? "").toContain("reason=state");
  expect(captured.storeArgs).toBeUndefined();
});

test("provider error param → denied (no exchange)", async () => {
  scenario.cookie = encodeOAuthState({ p: "x", s: "MATCH", v: "V", r: "/" });
  const res = await GET(callbackReq("error=access_denied&state=MATCH"), ctx);
  expect(res.headers.get("location") ?? "").toContain("reason=denied");
  expect(captured.storeArgs).toBeUndefined();
});

test("unauthenticated → login redirect", async () => {
  scenario.user = null;
  const res = await GET(callbackReq("code=C&state=BBB"), ctx);
  expect(res.headers.get("location") ?? "").toContain("/login");
});

test("valid state → exchanges code, calls storeTokens, connected redirect", async () => {
  stubXFetch();
  scenario.cookie = encodeOAuthState({ p: "x", s: "MATCH", v: "VER", r: "/project/9" });
  const res = await GET(callbackReq("code=C&state=MATCH"), ctx);
  const loc = res.headers.get("location") ?? "";
  expect(loc).toContain("social=connected");
  expect(loc).toContain("/project/9");
  expect(captured.storeArgs).toBeDefined();
  // [db, userId, platform, tokens, accountInfo]
  expect(captured.storeArgs![1]).toBe("user-a");
  expect(captured.storeArgs![2]).toBe("x");
  expect((captured.storeArgs![4] as { platform_account_id: string }).platform_account_id).toBe(
    "1799",
  );
});
