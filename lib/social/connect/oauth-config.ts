/**
 * lib/social/connect/oauth-config.ts
 *
 * Per-platform OAuth connector registry for the USER SIDE "connect your socials"
 * flow (U1). One entry per `Platform` carrying its authorize/token endpoints,
 * scope set, PKCE flag, and two operations the routes call:
 *   - buildAuthUrl({ state, redirectUri, codeChallenge? }) → the consent-screen URL
 *   - exchangeCode({ code, redirectUri, codeVerifier? }) → ExchangedTokens
 *
 * This file mirrors the proven Google-Contacts OAuth precedent
 * (`lib/email/google-oauth.ts`): plain `fetch`, no SDK, secret stays server-side.
 * The ONE net-new difference vs that precedent is that U1's callback PERSISTS the
 * tokens — but persistence is build 03's job (`storeTokens`, AES-256-GCM); this
 * file only EXCHANGES + shapes them. It never encrypts or writes `social_accounts`.
 *
 * VENDOR-FIRST — every endpoint + scope below was re-verified live in-session
 * (2026-06-20) against the authoritative docs; treat scope strings + API versions
 * as time-sensitive and re-verify before changing them (CLAUDE.md Rule 1):
 *   X        authorize https://x.com/i/oauth2/authorize · token https://api.x.com/2/oauth2/token
 *            PKCE S256 mandatory; scopes incl. offline.access (refresh) + media.write (image post)
 *            docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
 *   Meta     authorize https://www.facebook.com/v25.0/dialog/oauth (v25.0 current)
 *            token https://graph.facebook.com/v25.0/oauth/access_token · confidential (client_secret), no PKCE
 *            short→long-lived user token (fb_exchange_token) → non-expiring Page token
 *            developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
 *   LinkedIn authorize https://www.linkedin.com/oauth/v2/authorization (code TTL 30 min)
 *            token https://www.linkedin.com/oauth/v2/accessToken · confidential; w_member_social + openid profile email
 *            learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 *   GBP      PARKED (U-D5): authorize https://accounts.google.com/o/oauth2/v2/auth
 *            token https://oauth2.googleapis.com/token · access_type=offline + prompt=consent
 *            scope business.manage; allowlist-gated (0 QPM until Google approves) — connect, never block launch
 *            developers.google.com/identity/protocols/oauth2/web-server
 */

import { createHash, randomBytes } from "node:crypto";
import { isSafeReturnPath } from "@/lib/safe-return";
import type { Platform } from "../types";

const META_GRAPH_VERSION = "v25.0"; // verified current 2026-06-20
const DEFAULT_SITE_URL = "https://www.swfldatagulf.com";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized token-exchange result. The callback maps this onto build 03's
 * `TokenBundle` + `AccountInfo` and calls `storeTokens`.
 * `expires_in` is SECONDS-from-now (null = non-expiring, e.g. a Meta Page token).
 */
export interface ExchangedTokens {
  access_token: string;
  refresh_token: string | null;
  expires_in: number | null;
  token_type: string | null;
  platform_account_id: string;
  account_name: string | null;
  scopes: string[];
}

export interface OAuthPlatformConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** X is the only PKCE platform (S256 mandatory). */
  usesPkce: boolean;
  /** google_business is parked (U-D5) — connect, but never block launch. */
  parked: boolean;
  buildAuthUrl(args: { state: string; redirectUri: string; codeChallenge?: string }): string;
  exchangeCode(args: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<ExchangedTokens>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PKCE helpers (X) — RFC 7636, node crypto (no new dep)
// ─────────────────────────────────────────────────────────────────────────────

/** A high-entropy PKCE code verifier: 32 random bytes → base64url (43 chars, all RFC-7636-unreserved). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** The S256 code challenge for a verifier: base64url(sha256(verifier)). */
export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. State cookie codec — carries the CSRF state + PKCE verifier + return path
//    across the round-trip. base64url(JSON) in one httpOnly cookie.
// ─────────────────────────────────────────────────────────────────────────────

export interface OAuthStatePayload {
  /** The platform this cookie was minted for (callback asserts it matches its route param). */
  p: Platform;
  /** CSRF nonce echoed back as `state` by the provider. */
  s: string;
  /** PKCE verifier (X only); null/absent otherwise. */
  v: string | null;
  /** Same-origin relative path to return to after connect (open-redirect-guarded). */
  r: string;
}

export function encodeOAuthState(payload: OAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeOAuthState(raw: string | undefined | null): OAuthStatePayload | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as OAuthStatePayload;
    if (!obj || typeof obj.s !== "string" || typeof obj.p !== "string") return null;
    return obj;
  } catch {
    return null;
  }
}

// Open-redirect guard (single source of truth in lib/safe-return). Re-exported so
// existing `from "@/lib/social/connect/oauth-config"` importers keep working.
export { isSafeReturnPath };

// ─────────────────────────────────────────────────────────────────────────────
// 4. Site origin + redirect URI (mirrors lib/email/google-oauth siteBaseUrl)
// ─────────────────────────────────────────────────────────────────────────────

/** Public site origin (no trailing slash), preferring the configured URL. */
export function siteBaseUrl(reqUrl?: string): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (reqUrl) {
    try {
      return new URL(reqUrl).origin;
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_SITE_URL;
}

/** The OAuth redirect target for a platform — MUST match the provider's allow-listed URI. */
export function socialRedirectUri(platform: Platform, reqUrl?: string): string {
  return `${siteBaseUrl(reqUrl)}/api/social/connect/${platform}/callback`;
}

/**
 * Build the post-connect redirect target. Always rooted at OUR origin (never the
 * request URL's host) so a same-origin-guarded `returnPath` can't be turned into
 * an open redirect; the query carries the connect outcome for the UI banner.
 */
export function buildReturnUrl(
  reqUrl: string,
  returnPath: string,
  query: Record<string, string>,
): URL {
  const safePath = isSafeReturnPath(returnPath) ? returnPath : "/";
  const url = new URL(safePath, siteBaseUrl(reqUrl));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Per-platform credentials (env) + graceful-degrade check
//    Names match the refresh functions in oauth-tokens.ts so connect + refresh
//    share one credential set per platform.
// ─────────────────────────────────────────────────────────────────────────────

interface ClientCreds {
  id: string;
  secret: string;
}

const CRED_ENV: Record<Platform, { id: string; secret: string }> = {
  x: { id: "X_CLIENT_ID", secret: "X_CLIENT_SECRET" },
  facebook: { id: "META_APP_ID", secret: "META_APP_SECRET" },
  instagram: { id: "META_APP_ID", secret: "META_APP_SECRET" },
  linkedin: { id: "LINKEDIN_CLIENT_ID", secret: "LINKEDIN_CLIENT_SECRET" },
  google_business: { id: "GBP_CLIENT_ID", secret: "GBP_CLIENT_SECRET" },
};

function creds(platform: Platform): ClientCreds {
  const { id, secret } = CRED_ENV[platform];
  const idVal = process.env[id];
  const secretVal = process.env[secret];
  if (!idVal || !secretVal) throw new Error(`${id}/${secret} not configured`);
  return { id: idVal, secret: secretVal };
}

/** Are this platform's OAuth credentials present? Routes degrade gracefully when not. */
export function socialOauthConfigured(platform: Platform): boolean {
  const { id, secret } = CRED_ENV[platform];
  return Boolean(process.env[id] && process.env[secret]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. fetch helpers
// ─────────────────────────────────────────────────────────────────────────────

/** POST an x-www-form-urlencoded body and parse JSON. Throws on non-2xx (token never logged). */
async function postForm(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`token exchange failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** GET a JSON resource with a Bearer token. Throws on non-2xx. */
async function getJson(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`profile fetch failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. X (Twitter) — OAuth2 Authorization Code + PKCE (S256)
// ─────────────────────────────────────────────────────────────────────────────

const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access", // required → refresh token (else access token dies in ~2h)
  "media.write", // required → v2 media upload for image posts
];

const xConfig: OAuthPlatformConfig = {
  authorizeUrl: "https://x.com/i/oauth2/authorize",
  tokenUrl: "https://api.x.com/2/oauth2/token",
  scopes: X_SCOPES,
  usesPkce: true,
  parked: false,
  buildAuthUrl({ state, redirectUri, codeChallenge }) {
    const { id } = creds("x");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: id,
      redirect_uri: redirectUri,
      scope: X_SCOPES.join(" "),
      state,
      code_challenge: codeChallenge ?? "",
      code_challenge_method: "S256",
    });
    return `${this.authorizeUrl}?${params.toString()}`;
  },
  async exchangeCode({ code, redirectUri, codeVerifier }) {
    const { id, secret } = creds("x");
    // Confidential client → HTTP Basic on the token endpoint.
    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const tok = await postForm(
      "https://api.x.com/2/oauth2/token",
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier ?? "",
        client_id: id,
      },
      { authorization: `Basic ${basic}` },
    );
    const accessToken = str(tok.access_token);
    if (!accessToken) throw new Error("X token exchange returned no access_token");

    // Identity: GET /2/users/me → handle + numeric id.
    const me = await getJson("https://api.x.com/2/users/me", accessToken);
    const data = (me.data as Record<string, unknown> | undefined) ?? {};
    const username = str(data.username);
    return {
      access_token: accessToken,
      refresh_token: str(tok.refresh_token),
      expires_in: typeof tok.expires_in === "number" ? tok.expires_in : null,
      token_type: str(tok.token_type),
      platform_account_id: str(data.id) ?? "",
      account_name: username ? `@${username}` : str(data.name),
      scopes: str(tok.scope)?.split(" ") ?? X_SCOPES,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. Meta — Facebook Page + Instagram (one combined adapter, confidential flow)
// ─────────────────────────────────────────────────────────────────────────────

const META_SCOPES = [
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_show_list",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
];

const META_DIALOG = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
const META_TOKEN = `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`;
const META_GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

interface MetaPage {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id: string; username?: string };
}

/**
 * Shared Meta connect. `forInstagram` selects which identity the connected row
 * represents (the IG business account vs the FB Page) — both ride the same grant
 * and the same non-expiring Page token (IG content-publishing uses the Page token).
 */
function metaConfig(forInstagram: boolean): OAuthPlatformConfig {
  return {
    authorizeUrl: META_DIALOG,
    tokenUrl: META_TOKEN,
    scopes: META_SCOPES,
    usesPkce: false,
    parked: false,
    buildAuthUrl({ state, redirectUri }) {
      const { id } = creds(forInstagram ? "instagram" : "facebook");
      const params = new URLSearchParams({
        client_id: id,
        redirect_uri: redirectUri,
        state,
        response_type: "code",
        scope: META_SCOPES.join(","), // Facebook dialog wants a comma-separated scope list
      });
      return `${META_DIALOG}?${params.toString()}`;
    },
    async exchangeCode({ code, redirectUri }) {
      const { id, secret } = creds(forInstagram ? "instagram" : "facebook");

      // 1. code → short-lived user token
      const short = await postForm(META_TOKEN, {
        client_id: id,
        client_secret: secret,
        redirect_uri: redirectUri,
        code,
      });
      const shortToken = str(short.access_token);
      if (!shortToken) throw new Error("Meta code exchange returned no access_token");

      // 2. short → long-lived user token (~60d)
      const long = await postForm(META_TOKEN, {
        grant_type: "fb_exchange_token",
        client_id: id,
        client_secret: secret,
        fb_exchange_token: shortToken,
      });
      const longToken = str(long.access_token) ?? shortToken;

      // 3. derive the managed Page (+ its non-expiring Page token, + linked IG account)
      const pagesRes = await getJson(
        `${META_GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`,
        longToken,
      );
      const pages = (pagesRes.data as MetaPage[] | undefined) ?? [];
      const page = pages[0];
      if (!page) throw new Error("No manageable Facebook Page on this account");

      const pageToken = str(page.access_token) ?? longToken; // Page token = non-expiring durable credential

      if (forInstagram) {
        const ig = page.instagram_business_account;
        if (!ig?.id) {
          throw new Error("No Instagram business account linked to the connected Page");
        }
        return {
          access_token: pageToken,
          refresh_token: null,
          expires_in: null, // Page token does not expire
          token_type: "bearer",
          platform_account_id: ig.id,
          account_name: str(ig.username) ?? str(page.name),
          scopes: META_SCOPES,
        };
      }

      return {
        access_token: pageToken,
        refresh_token: null,
        expires_in: null,
        token_type: "bearer",
        platform_account_id: page.id,
        account_name: str(page.name),
        scopes: META_SCOPES,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. LinkedIn — member (confidential flow; org posting gated separately)
// ─────────────────────────────────────────────────────────────────────────────

const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"];

const linkedinConfig: OAuthPlatformConfig = {
  authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
  tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
  scopes: LINKEDIN_SCOPES,
  usesPkce: false,
  parked: false,
  buildAuthUrl({ state, redirectUri }) {
    const { id } = creds("linkedin");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: id,
      redirect_uri: redirectUri,
      state,
      scope: LINKEDIN_SCOPES.join(" "),
    });
    return `${this.authorizeUrl}?${params.toString()}`;
  },
  async exchangeCode({ code, redirectUri }) {
    const { id, secret } = creds("linkedin");
    const tok = await postForm("https://www.linkedin.com/oauth/v2/accessToken", {
      grant_type: "authorization_code",
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri,
    });
    const accessToken = str(tok.access_token);
    if (!accessToken) throw new Error("LinkedIn token exchange returned no access_token");

    // Identity via OpenID Connect userinfo → `sub` is the durable person id.
    const info = await getJson("https://api.linkedin.com/v2/userinfo", accessToken);
    const sub = str(info.sub);
    if (!sub) throw new Error("LinkedIn userinfo returned no sub");
    return {
      access_token: accessToken,
      refresh_token: str(tok.refresh_token), // only for MDP-approved partners; else null → re-auth at 60d
      expires_in: typeof tok.expires_in === "number" ? tok.expires_in : null,
      token_type: str(tok.token_type),
      platform_account_id: sub,
      account_name: str(info.name) ?? str(info.email),
      scopes: str(tok.scope)?.split(" ") ?? LINKEDIN_SCOPES,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. Google Business Profile — PARKED (U-D5). Build the flow; never block launch.
// ─────────────────────────────────────────────────────────────────────────────

const GBP_SCOPES = ["https://www.googleapis.com/auth/business.manage"];
/** Placeholder account id until Google allowlist access lands (the row graduates with zero code change). */
const GBP_PENDING_ACCOUNT_ID = "pending-google-approval";

const gbpConfig: OAuthPlatformConfig = {
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: GBP_SCOPES,
  usesPkce: false,
  parked: true,
  buildAuthUrl({ state, redirectUri }) {
    const { id } = creds("google_business");
    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GBP_SCOPES.join(" "),
      access_type: "offline", // → refresh token
      prompt: "consent", // force refresh-token issuance on re-consent
      state,
    });
    return `${this.authorizeUrl}?${params.toString()}`;
  },
  async exchangeCode({ code, redirectUri }) {
    const { id, secret } = creds("google_business");
    const tok = await postForm("https://oauth2.googleapis.com/token", {
      grant_type: "authorization_code",
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri,
    });
    const accessToken = str(tok.access_token);
    if (!accessToken) throw new Error("GBP token exchange returned no access_token");
    // Account/location id is derived later, post-approval (0 QPM until allowlisted).
    return {
      access_token: accessToken,
      refresh_token: str(tok.refresh_token),
      expires_in: typeof tok.expires_in === "number" ? tok.expires_in : null,
      token_type: str(tok.token_type),
      platform_account_id: GBP_PENDING_ACCOUNT_ID,
      account_name: null,
      scopes: GBP_SCOPES,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 11. Registry + accessor
// ─────────────────────────────────────────────────────────────────────────────

export const OAUTH_CONFIGS: Record<Platform, OAuthPlatformConfig> = {
  x: xConfig,
  facebook: metaConfig(false),
  instagram: metaConfig(true),
  linkedin: linkedinConfig,
  google_business: gbpConfig,
};

const PLATFORMS: readonly Platform[] = [
  "x",
  "facebook",
  "instagram",
  "linkedin",
  "google_business",
];

/** Narrow an arbitrary route param to a known Platform. */
export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

/** The connector config for a platform. Throws on an unknown platform. */
export function getOAuthConfig(platform: Platform): OAuthPlatformConfig {
  const cfg = OAUTH_CONFIGS[platform];
  if (!cfg) throw new Error(`No OAuth config for platform: ${platform}`);
  return cfg;
}
