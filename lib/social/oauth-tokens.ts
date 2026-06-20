/**
 * lib/social/oauth-tokens.ts
 *
 * Encrypted token store + per-platform refresh logic for social accounts.
 * This is the seam the USER SIDE OAuth callback writes to, and the cron (build 04)
 * reads from before calling postToChannel.
 *
 * SECURITY PRIMITIVE (no prior precedent in this codebase):
 *   - AES-256-GCM encryption at rest.
 *   - Payload stored as base64(iv || authTag || ciphertext) — 12 || 16 || N bytes.
 *   - Key: 32-byte raw key from SDG_CRYPTO_KEY env (hex or base64 encoded).
 *   - NEVER log plaintext tokens.
 *
 * Verified vendor docs (2026-06-20):
 *   X:        https://docs.x.com/x-api/posts/creation-of-a-post
 *             Refresh endpoint: POST https://api.twitter.com/2/oauth2/token
 *   LinkedIn: https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
 *             Access token TTL: 60 days (5184000s); Refresh TTL: 365 days
 *             Refresh endpoint: POST https://www.linkedin.com/oauth/v2/accessToken
 *   Meta (FB+IG): https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
 *             Page tokens: permanent (no expiry); long-lived user tokens ~60 days
 *   GBP:      https://developers.google.com/my-business/reference/rest
 *             Google OAuth standard 1h access token; refresh token permanent
 *             Refresh endpoint: POST https://oauth2.googleapis.com/token
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Platform } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Crypto helpers
// ─────────────────────────────────────────────────────────────────────────────

const ALGO = "aes-256-gcm" as const;
const IV_BYTES = 12; // GCM recommended IV length
const TAG_BYTES = 16; // GCM auth tag length (fixed)

/** Derive the 32-byte key from SDG_CRYPTO_KEY env (hex or base64). */
function getKey(): Buffer {
  const raw = process.env.SDG_CRYPTO_KEY;
  if (!raw) throw new Error("SDG_CRYPTO_KEY is not set");
  // Prefer hex (64 chars) — fall back to base64 (44 chars for 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const buf = Buffer.from(raw, "base64");
  if (buf.byteLength !== 32) throw new Error("SDG_CRYPTO_KEY must encode exactly 32 bytes");
  return buf;
}

/**
 * Encrypt a plaintext string.
 * Returns base64( iv[12] || authTag[16] || ciphertext[N] ).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag(); // must call AFTER final()
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Decrypt a value previously produced by encrypt().
 * Throws if the auth tag does not verify (tampered ciphertext).
 */
export function decrypt(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, "base64");
  if (buf.byteLength < IV_BYTES + TAG_BYTES) {
    throw new Error("Ciphertext too short — likely corrupt or wrong key");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag); // must call BEFORE update()
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Token store types
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenBundle {
  access_token: string;
  refresh_token: string | null;
  token_type: string | null;
  /** Unix epoch seconds */
  expires_at: number | null;
  scopes: string[];
}

export interface AccountInfo {
  account_name: string | null;
  /** The platform's own opaque identifier for this account (page_id, org URN, etc.) */
  platform_account_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Store + retrieve
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert a social account row with encrypted tokens.
 * Called by the USER SIDE OAuth callback after the token exchange.
 */
export async function storeTokens(
  db: SupabaseClient,
  userId: string,
  platform: Platform,
  tokens: TokenBundle,
  accountInfo: AccountInfo,
): Promise<void> {
  const { error } = await db.from("social_accounts").upsert(
    {
      user_id: userId,
      platform,
      platform_account_id: accountInfo.platform_account_id,
      access_token: encrypt(tokens.access_token),
      refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      token_type: tokens.token_type,
      expires_at: tokens.expires_at ? new Date(tokens.expires_at * 1000).toISOString() : null,
      scopes: tokens.scopes,
      account_name: accountInfo.account_name,
      status: "connected" as const,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id,platform,platform_account_id",
    },
  );
  if (error) throw new Error(`storeTokens failed: ${error.message}`);
}

/**
 * Retrieve + decrypt tokens for a specific account.
 * Returns null if the account row doesn't exist.
 */
export async function retrieveTokens(
  db: SupabaseClient,
  userId: string,
  platform: Platform,
  platformAccountId: string,
): Promise<
  | (TokenBundle & {
      accountName: string | null;
      status: string;
      rowId: string;
    })
  | null
> {
  const { data, error } = await db
    .from("social_accounts")
    .select("id, access_token, refresh_token, token_type, expires_at, scopes, account_name, status")
    .eq("user_id", userId)
    .eq("platform", platform)
    .eq("platform_account_id", platformAccountId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // not found
    throw new Error(`retrieveTokens failed: ${error.message}`);
  }
  if (!data) return null;

  return {
    access_token: decrypt(data.access_token as string),
    refresh_token: data.refresh_token ? decrypt(data.refresh_token as string) : null,
    token_type: (data.token_type as string | null) ?? null,
    expires_at: data.expires_at
      ? Math.floor(new Date(data.expires_at as string).getTime() / 1000)
      : null,
    scopes: (data.scopes as string[]) ?? [],
    accountName: (data.account_name as string | null) ?? null,
    status: data.status as string,
    rowId: data.id as string,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Per-platform token-refresh logic
// ─────────────────────────────────────────────────────────────────────────────

/** Seconds of buffer before expiry to trigger a refresh. */
const REFRESH_BUFFER_SECONDS = 300; // 5 min

/** Returns true when the stored token needs a refresh now. */
export function tokenNeedsRefresh(expiresAt: number | null): boolean {
  if (expiresAt === null) return false; // no expiry (e.g. permanent page token)
  return Date.now() / 1000 > expiresAt - REFRESH_BUFFER_SECONDS;
}

interface RefreshResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/** Call X's token-refresh endpoint.
 *  Verified: POST https://api.twitter.com/2/oauth2/token
 *  Docs: https://docs.x.com/x-api/posts/creation-of-a-post (OAuth2 section)
 */
async function callXRefresh(refreshToken: string): Promise<RefreshResponse> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("X_CLIENT_ID/X_CLIENT_SECRET not configured");

  // X uses HTTP Basic auth for confidential clients
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${creds}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`X token refresh failed (${res.status}): ${txt}`);
  }
  return (await res.json()) as RefreshResponse;
}

/** Call LinkedIn's token-refresh endpoint.
 *  Verified: POST https://www.linkedin.com/oauth/v2/accessToken
 *  Docs: https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
 *  Access TTL: 60 days; Refresh TTL: 365 days (fixed from initial issue date)
 */
async function callLinkedInRefresh(refreshToken: string): Promise<RefreshResponse> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new Error("LINKEDIN_CLIENT_ID/LINKEDIN_CLIENT_SECRET not configured");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`LinkedIn token refresh failed (${res.status}): ${txt}`);
  }
  return (await res.json()) as RefreshResponse;
}

/** Call Meta's token-refresh endpoint.
 *  Verified: GET https://graph.facebook.com/oauth/access_token (fb_exchange_token)
 *  Docs: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
 *  Page tokens are permanent; user tokens ~60 days. We exchange user token → long-lived.
 */
async function callMetaRefresh(shortLivedToken: string): Promise<RefreshResponse> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("META_APP_ID/META_APP_SECRET not configured");

  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });

  const res = await fetch(`https://graph.facebook.com/oauth/access_token?${params.toString()}`, {
    method: "GET",
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Meta token refresh failed (${res.status}): ${txt}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in?: number;
    token_type?: string;
  };
  return {
    access_token: json.access_token,
    expires_in: json.expires_in,
    token_type: json.token_type,
  };
}

/** Call Google's token-refresh endpoint.
 *  Verified: POST https://oauth2.googleapis.com/token
 *  GBP uses standard Google OAuth. Access token TTL: 3600s (1h).
 *  Refresh token has no expiry by default.
 */
async function callGBPRefresh(refreshToken: string): Promise<RefreshResponse> {
  const clientId = process.env.GBP_CLIENT_ID;
  const clientSecret = process.env.GBP_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GBP_CLIENT_ID/GBP_CLIENT_SECRET not configured");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GBP token refresh failed (${res.status}): ${txt}`);
  }
  return (await res.json()) as RefreshResponse;
}

/**
 * Refresh the access token for a social account, update the DB row, and return
 * the new plaintext access token.
 *
 * Strategy per platform:
 *   x             → callXRefresh (confidential client, HTTP Basic)
 *   linkedin      → callLinkedInRefresh (MDP programmatic refresh)
 *   facebook      → callMetaRefresh (fb_exchange_token for user token; Page tokens permanent)
 *   instagram     → callMetaRefresh (same Meta app)
 *   google_business → callGBPRefresh (standard Google OAuth)
 */
export async function refreshAccessToken(
  db: SupabaseClient,
  userId: string,
  platform: Platform,
  platformAccountId: string,
): Promise<string> {
  const stored = await retrieveTokens(db, userId, platform, platformAccountId);
  if (!stored) throw new Error(`No social_accounts row for ${platform}/${platformAccountId}`);
  if (!stored.refresh_token) {
    throw new Error(`No refresh_token stored for ${platform}/${platformAccountId}`);
  }

  const rt = stored.refresh_token; // already decrypted by retrieveTokens
  let refreshed: RefreshResponse;

  switch (platform) {
    case "x":
      refreshed = await callXRefresh(rt);
      break;
    case "linkedin":
      refreshed = await callLinkedInRefresh(rt);
      break;
    case "facebook":
    case "instagram":
      refreshed = await callMetaRefresh(stored.access_token); // exchange current user token
      break;
    case "google_business":
      refreshed = await callGBPRefresh(rt);
      break;
    default: {
      // Exhaustiveness guard — TypeScript knows Platform is a closed union
      const _never: never = platform;
      throw new Error(`Unknown platform: ${String(_never)}`);
    }
  }

  const newExpiresAt = refreshed.expires_in
    ? Math.floor(Date.now() / 1000) + refreshed.expires_in
    : null;

  const updates: Record<string, unknown> = {
    access_token: encrypt(refreshed.access_token),
    expires_at: newExpiresAt ? new Date(newExpiresAt * 1000).toISOString() : null,
    status: "connected" as const,
    updated_at: new Date().toISOString(),
  };

  // Some platforms (X) rotate the refresh token on use
  if (refreshed.refresh_token) {
    updates.refresh_token = encrypt(refreshed.refresh_token);
  }

  const { error } = await db.from("social_accounts").update(updates).eq("id", stored.rowId);

  if (error) throw new Error(`Failed to update refreshed token: ${error.message}`);

  return refreshed.access_token;
}

/**
 * Get a valid (non-expired) access token, refreshing if needed.
 * The cron and channel adapters call this before every platform post.
 */
export async function getValidAccessToken(
  db: SupabaseClient,
  userId: string,
  platform: Platform,
  platformAccountId: string,
): Promise<string> {
  const stored = await retrieveTokens(db, userId, platform, platformAccountId);
  if (!stored) throw new Error(`No social_accounts row for ${platform}/${platformAccountId}`);
  if (stored.status === "revoked")
    throw new Error(`Account ${platform}/${platformAccountId} is revoked`);

  if (tokenNeedsRefresh(stored.expires_at)) {
    return refreshAccessToken(db, userId, platform, platformAccountId);
  }
  return stored.access_token;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Disconnect — best-effort platform revoke + authoritative local status flip
//    (USER SIDE /disconnect route, U-D3). Net-new seam added for build U1.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Best-effort token revocation at the platform. NON-FATAL: the local
 * `status='revoked'` flip is the authoritative disconnect, so a failed remote
 * revoke — or a platform with no revoke endpoint — must never block it.
 *   X     POST https://api.twitter.com/2/oauth2/revoke (confidential, HTTP Basic)
 *   GBP   POST https://oauth2.googleapis.com/revoke
 *   Meta / LinkedIn — no standard OAuth revoke endpoint → local revoke only.
 */
async function revokeAtPlatform(platform: Platform, accessToken: string): Promise<void> {
  if (platform === "x") {
    const clientId = process.env.X_CLIENT_ID;
    const clientSecret = process.env.X_CLIENT_SECRET;
    if (!clientId || !clientSecret) return;
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    await fetch("https://api.twitter.com/2/oauth2/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${creds}`,
      },
      body: new URLSearchParams({ token: accessToken, token_type_hint: "access_token" }).toString(),
    });
    return;
  }
  if (platform === "google_business") {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken }).toString(),
    });
  }
  // facebook / instagram / linkedin: no standard revoke endpoint — local revoke only.
}

/**
 * Disconnect a platform for a user: best-effort revoke each matching account's
 * token at the platform, then flip `status='revoked'` locally (the authoritative
 * state). Pass `platformAccountId` to revoke one specific account; omit it to
 * revoke every connected account for that platform.
 *
 * Called by the USER SIDE /disconnect route. Never throws on a remote-revoke
 * failure (best-effort) — only on a DB error. Returns how many rows were revoked.
 */
export async function revokeToken(
  db: SupabaseClient,
  userId: string,
  platform: Platform,
  platformAccountId?: string,
): Promise<{ revokedRows: number }> {
  // Load matching rows — we need the (encrypted) access token to revoke remotely.
  let sel = db
    .from("social_accounts")
    .select("id, access_token")
    .eq("user_id", userId)
    .eq("platform", platform);
  if (platformAccountId) sel = sel.eq("platform_account_id", platformAccountId);
  const { data, error } = await sel;
  if (error) throw new Error(`revokeToken lookup failed: ${error.message}`);
  const rows = (data ?? []) as { id: string; access_token: string }[];

  // Best-effort platform-side revocation (never fatal).
  for (const row of rows) {
    try {
      await revokeAtPlatform(platform, decrypt(row.access_token));
    } catch {
      /* non-fatal — the local revoke below is authoritative */
    }
  }

  // Authoritative local state: status='revoked'.
  let upd = db
    .from("social_accounts")
    .update({ status: "revoked" as const, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("platform", platform);
  if (platformAccountId) upd = upd.eq("platform_account_id", platformAccountId);
  const { data: updated, error: updErr } = await upd.select("id");
  if (updErr) throw new Error(`revokeToken update failed: ${updErr.message}`);

  return { revokedRows: updated?.length ?? 0 };
}
