/**
 * Minimal Google OAuth + People API client for read-only contact import.
 *
 * No `googleapis` SDK — the flow is a single consent redirect, one token
 * exchange, and a paginated REST read, so plain `fetch` keeps the dependency
 * surface (and the lockfile) untouched. The access token is used in-memory in
 * the callback and never persisted (online access, no refresh token).
 *
 * Scope `contacts.readonly` is a Google *sensitive* scope: an unverified app is
 * capped at ~100 users and shows an "unverified app" screen until Google
 * verifies the consent screen. Enable the People API + submit verification in
 * the Cloud Console (see .env.example / the plan); test users work immediately.
 */
import type { GooglePerson } from "./google-people";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const PEOPLE_CONNECTIONS_ENDPOINT = "https://people.googleapis.com/v1/people/me/connections";

export const GOOGLE_CONTACTS_SCOPES = [
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

const DEFAULT_SITE_URL = "https://www.swfldatagulf.com";

/** Are the Google OAuth credentials configured? Routes degrade gracefully when not. */
export function googleOauthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function clientId(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_OAUTH_CLIENT_ID is not set");
  return v;
}

function clientSecret(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not set");
  return v;
}

/** Public site origin (no trailing slash), preferring the configured URL. Mirrors app/api/webhooks/resend. */
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

/** The OAuth redirect target — MUST match an Authorized redirect URI in the Cloud Console. */
export function googleRedirectUri(reqUrl?: string): string {
  return `${siteBaseUrl(reqUrl)}/api/email/contacts/google/callback`;
}

/** Build the consent-screen URL. `state` is the CSRF nonce echoed back to the callback. */
export function buildGoogleAuthUrl({
  state,
  redirectUri,
}: {
  state: string;
  redirectUri: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CONTACTS_SCOPES.join(" "),
    access_type: "online", // read once; no refresh token to store
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchange an authorization code for an access token (server-side; secret stays here). */
export async function exchangeCodeForToken({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed (${res.status})`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("token exchange returned no access_token");
  return json.access_token;
}

/** Read ALL of the user's connections, following People API pagination. */
export async function fetchAllConnections(accessToken: string): Promise<GooglePerson[]> {
  const out: GooglePerson[] = [];
  let pageToken: string | undefined;
  // Bound the loop so a pathological pagination response can't spin forever.
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({
      personFields: "names,emailAddresses",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${PEOPLE_CONNECTIONS_ENDPOINT}?${params.toString()}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`people.connections.list failed (${res.status})`);
    const json = (await res.json()) as { connections?: GooglePerson[]; nextPageToken?: string };
    if (json.connections?.length) out.push(...json.connections);
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return out;
}
