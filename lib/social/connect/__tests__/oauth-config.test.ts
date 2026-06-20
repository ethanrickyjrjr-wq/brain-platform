/**
 * lib/social/connect/__tests__/oauth-config.test.ts
 *
 * U1 connector contract: authorize-URL shape + scopes per platform, PKCE S256
 * round-trip, the state-cookie codec + open-redirect guard, and the per-platform
 * token exchange (mocked fetch — no live calls). Vendor endpoints/scopes here are
 * pinned to the 2026-06-20 live verification; a drift in these assertions is the
 * signal to re-run Vendor-First.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import {
  OAUTH_CONFIGS,
  buildReturnUrl,
  codeChallengeS256,
  decodeOAuthState,
  encodeOAuthState,
  generateCodeVerifier,
  getOAuthConfig,
  isPlatform,
  isSafeReturnPath,
  socialOauthConfigured,
  socialRedirectUri,
} from "../oauth-config";

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.X_CLIENT_ID = "x-id";
  process.env.X_CLIENT_SECRET = "x-secret";
  process.env.META_APP_ID = "meta-id";
  process.env.META_APP_SECRET = "meta-secret";
  process.env.LINKEDIN_CLIENT_ID = "li-id";
  process.env.LINKEDIN_CLIENT_SECRET = "li-secret";
  process.env.GBP_CLIENT_ID = "gbp-id";
  process.env.GBP_CLIENT_SECRET = "gbp-secret";
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.swfldatagulf.com";
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Install a fetch stub that dispatches by URL (+ optional body predicate). */
function stubFetch(
  routes: {
    test: (url: string, body: string) => boolean;
    json: unknown;
    ok?: boolean;
    status?: number;
  }[],
) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (
    input: unknown,
    init?: { body?: string; headers?: Record<string, string> },
  ) => {
    const url = typeof input === "string" ? input : String(input);
    const body = init?.body ?? "";
    calls.push({ url, body, headers: (init?.headers as Record<string, string>) ?? {} });
    const r = routes.find((x) => x.test(url, body));
    if (!r) throw new Error(`no fetch stub for ${url} (body=${body})`);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    };
  }) as typeof fetch;
  return calls;
}

// ─────────────────────────────────────────────────────────────────────────────
// PKCE
// ─────────────────────────────────────────────────────────────────────────────

describe("PKCE (X)", () => {
  it("verifier is 43 url-safe chars and challenge is its S256 base64url digest", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes → base64url, no padding
    const challenge = codeChallengeS256(verifier);
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("distinct verifiers each call (random)", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State codec + open-redirect guard
// ─────────────────────────────────────────────────────────────────────────────

describe("state cookie codec", () => {
  it("round-trips the payload", () => {
    const enc = encodeOAuthState({ p: "x", s: "abc123", v: "verifier-xyz", r: "/project/42" });
    expect(decodeOAuthState(enc)).toEqual({
      p: "x",
      s: "abc123",
      v: "verifier-xyz",
      r: "/project/42",
    });
  });
  it("returns null on garbage / empty", () => {
    expect(decodeOAuthState("not-base64url-$$$")).toBeNull();
    expect(decodeOAuthState(undefined)).toBeNull();
    expect(decodeOAuthState("")).toBeNull();
  });
});

describe("isSafeReturnPath", () => {
  it("accepts same-origin relative paths", () => {
    expect(isSafeReturnPath("/")).toBe(true);
    expect(isSafeReturnPath("/project/42")).toBe(true);
  });
  it("rejects absolute, protocol-relative, and backslash tricks", () => {
    expect(isSafeReturnPath("//evil.com")).toBe(false);
    expect(isSafeReturnPath("https://evil.com")).toBe(false);
    expect(isSafeReturnPath("/\\evil.com")).toBe(false);
    expect(isSafeReturnPath("evil")).toBe(false);
    expect(isSafeReturnPath(42)).toBe(false);
  });
});

describe("buildReturnUrl", () => {
  it("roots at our origin (not the request host) and carries the outcome query", () => {
    const url = buildReturnUrl(
      "https://attacker.example/api/social/connect/x/callback",
      "/project/9",
      {
        social: "connected",
        platform: "x",
      },
    );
    expect(url.origin).toBe("https://www.swfldatagulf.com");
    expect(url.pathname).toBe("/project/9");
    expect(url.searchParams.get("social")).toBe("connected");
    expect(url.searchParams.get("platform")).toBe("x");
  });
  it("falls back to / for an unsafe return path", () => {
    const url = buildReturnUrl("https://www.swfldatagulf.com/x", "//evil.com", { social: "error" });
    expect(url.origin).toBe("https://www.swfldatagulf.com");
    expect(url.pathname).toBe("/");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Registry + platform guard
// ─────────────────────────────────────────────────────────────────────────────

describe("registry", () => {
  it("isPlatform narrows the five known platforms only", () => {
    for (const p of ["x", "facebook", "instagram", "linkedin", "google_business"]) {
      expect(isPlatform(p)).toBe(true);
    }
    expect(isPlatform("bluesky")).toBe(false);
    expect(isPlatform("")).toBe(false);
    expect(isPlatform(undefined)).toBe(false);
  });
  it("only X uses PKCE; only GBP is parked", () => {
    expect(OAUTH_CONFIGS.x.usesPkce).toBe(true);
    expect(OAUTH_CONFIGS.facebook.usesPkce).toBe(false);
    expect(OAUTH_CONFIGS.linkedin.usesPkce).toBe(false);
    expect(OAUTH_CONFIGS.google_business.parked).toBe(true);
    expect(OAUTH_CONFIGS.x.parked).toBe(false);
    expect(OAUTH_CONFIGS.facebook.parked).toBe(false);
    expect(OAUTH_CONFIGS.linkedin.parked).toBe(false);
  });
  it("socialOauthConfigured reflects env presence", () => {
    expect(socialOauthConfigured("x")).toBe(true);
    delete process.env.X_CLIENT_SECRET;
    expect(socialOauthConfigured("x")).toBe(false);
  });
  it("redirect URI is per-platform under our origin", () => {
    expect(socialRedirectUri("linkedin", "https://x/")).toBe(
      "https://www.swfldatagulf.com/api/social/connect/linkedin/callback",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildAuthUrl per platform (verified endpoints + scopes)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildAuthUrl", () => {
  const redirectUri = "https://www.swfldatagulf.com/api/social/connect/x/callback";

  it("X → x.com authorize with PKCE S256 + offline.access + media.write", () => {
    const u = new URL(
      getOAuthConfig("x").buildAuthUrl({ state: "STATE", redirectUri, codeChallenge: "CHAL" }),
    );
    expect(u.origin + u.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe("STATE");
    expect(u.searchParams.get("code_challenge")).toBe("CHAL");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const scopes = (u.searchParams.get("scope") ?? "").split(" ");
    expect(scopes).toContain("offline.access");
    expect(scopes).toContain("media.write");
    expect(scopes).toContain("tweet.write");
  });

  it("Meta → facebook.com v25.0 dialog, comma-joined scopes, no PKCE params", () => {
    const u = new URL(getOAuthConfig("facebook").buildAuthUrl({ state: "ST", redirectUri }));
    expect(u.origin + u.pathname).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(u.searchParams.get("code_challenge")).toBeNull();
    const scope = u.searchParams.get("scope") ?? "";
    expect(scope.split(",")).toContain("pages_manage_posts");
    expect(scope.split(",")).toContain("instagram_content_publish");
  });

  it("LinkedIn → linkedin.com authorize with w_member_social + openid", () => {
    const u = new URL(getOAuthConfig("linkedin").buildAuthUrl({ state: "ST", redirectUri }));
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    const scopes = (u.searchParams.get("scope") ?? "").split(" ");
    expect(scopes).toContain("w_member_social");
    expect(scopes).toContain("openid");
  });

  it("GBP → accounts.google.com auth with offline access + consent prompt", () => {
    const u = new URL(getOAuthConfig("google_business").buildAuthUrl({ state: "ST", redirectUri }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/business.manage");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// exchangeCode per platform (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("exchangeCode", () => {
  it("X: token (HTTP Basic) + /2/users/me → @handle identity", async () => {
    const calls = stubFetch([
      {
        test: (u) => u === "https://api.x.com/2/oauth2/token",
        json: {
          access_token: "x-access",
          refresh_token: "x-refresh",
          expires_in: 7200,
          token_type: "bearer",
          scope: "tweet.write media.write offline.access",
        },
      },
      {
        test: (u) => u === "https://api.x.com/2/users/me",
        json: { data: { id: "1799", username: "swfldata", name: "SWFL" } },
      },
    ]);
    const out = await getOAuthConfig("x").exchangeCode({
      code: "C",
      redirectUri: "R",
      codeVerifier: "V",
    });
    expect(out.platform_account_id).toBe("1799");
    expect(out.account_name).toBe("@swfldata");
    expect(out.refresh_token).toBe("x-refresh");
    expect(out.expires_in).toBe(7200);
    expect(out.scopes).toContain("media.write");
    // confidential client → Basic auth + code_verifier on the token call
    const tokenCall = calls.find((c) => c.url.endsWith("/oauth2/token"))!;
    expect(tokenCall.headers.authorization).toMatch(/^Basic /);
    expect(tokenCall.body).toContain("code_verifier=V");
  });

  it("LinkedIn: token + userinfo sub → durable person id", async () => {
    stubFetch([
      {
        test: (u) => u === "https://www.linkedin.com/oauth/v2/accessToken",
        json: { access_token: "li-access", expires_in: 5184000, scope: "w_member_social openid" },
      },
      {
        test: (u) => u === "https://api.linkedin.com/v2/userinfo",
        json: { sub: "li-person-7", name: "Ricky Cooper", email: "r@x.com" },
      },
    ]);
    const out = await getOAuthConfig("linkedin").exchangeCode({ code: "C", redirectUri: "R" });
    expect(out.platform_account_id).toBe("li-person-7");
    expect(out.account_name).toBe("Ricky Cooper");
    expect(out.expires_in).toBe(5184000);
    expect(out.refresh_token).toBeNull(); // no MDP partner refresh
  });

  it("Meta facebook: short→long exchange → non-expiring Page token + Page id", async () => {
    stubFetch([
      {
        test: (u, b) =>
          u === "https://graph.facebook.com/v25.0/oauth/access_token" &&
          b.includes("code=C") &&
          !b.includes("fb_exchange_token"),
        json: { access_token: "short-user-token" },
      },
      {
        test: (u, b) =>
          u === "https://graph.facebook.com/v25.0/oauth/access_token" &&
          b.includes("fb_exchange_token"),
        json: { access_token: "long-user-token", expires_in: 5184000 },
      },
      {
        test: (u) => u.includes("/me/accounts"),
        json: { data: [{ id: "page-55", name: "Gulf Realty", access_token: "page-token" }] },
      },
    ]);
    const out = await getOAuthConfig("facebook").exchangeCode({ code: "C", redirectUri: "R" });
    expect(out.platform_account_id).toBe("page-55");
    expect(out.account_name).toBe("Gulf Realty");
    expect(out.access_token).toBe("page-token");
    expect(out.expires_in).toBeNull(); // Page token does not expire
    expect(out.refresh_token).toBeNull();
  });

  it("Meta instagram: derives the linked IG business account id", async () => {
    stubFetch([
      {
        test: (u, b) =>
          u === "https://graph.facebook.com/v25.0/oauth/access_token" &&
          b.includes("code=C") &&
          !b.includes("fb_exchange_token"),
        json: { access_token: "short" },
      },
      {
        test: (u, b) => u.includes("/oauth/access_token") && b.includes("fb_exchange_token"),
        json: { access_token: "long" },
      },
      {
        test: (u) => u.includes("/me/accounts"),
        json: {
          data: [
            {
              id: "page-1",
              name: "Page",
              access_token: "page-token",
              instagram_business_account: { id: "ig-900", username: "swfl_ig" },
            },
          ],
        },
      },
    ]);
    const out = await getOAuthConfig("instagram").exchangeCode({ code: "C", redirectUri: "R" });
    expect(out.platform_account_id).toBe("ig-900");
    expect(out.account_name).toBe("swfl_ig");
    expect(out.access_token).toBe("page-token");
  });

  it("GBP (parked): exchanges tokens, parks the account id pending Google approval", async () => {
    stubFetch([
      {
        test: (u) => u === "https://oauth2.googleapis.com/token",
        json: { access_token: "g-access", refresh_token: "g-refresh", expires_in: 3600 },
      },
    ]);
    const out = await getOAuthConfig("google_business").exchangeCode({
      code: "C",
      redirectUri: "R",
    });
    expect(out.access_token).toBe("g-access");
    expect(out.refresh_token).toBe("g-refresh");
    expect(out.platform_account_id).toBe("pending-google-approval");
  });

  it("throws on a non-2xx token response (never silently succeeds)", async () => {
    stubFetch([
      {
        test: (u) => u.includes("/oauth2/token"),
        json: { error: "invalid_grant" },
        ok: false,
        status: 400,
      },
    ]);
    await expect(
      getOAuthConfig("x").exchangeCode({ code: "bad", redirectUri: "R", codeVerifier: "V" }),
    ).rejects.toThrow(/token exchange failed \(400\)/);
  });
});
