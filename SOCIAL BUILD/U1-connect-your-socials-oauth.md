# U1 — Connect your socials (OAuth per platform)

| | |
|---|---|
| **Model** | **Sonnet** (clone the Google-Contacts OAuth flow + follow vendor docs) |
| **Stage** | USER-SIDE — build after backend **01** (`social_accounts`) + **03** (`oauth-tokens.ts`) merge |
| **Runs in parallel with** | **U3** (no shared files) |
| **CANNOT run with** | nothing directly — depends on 01 + 03 |
| **Blocked by** | 01 (`social_accounts` table + `Platform` type), 03 (`storeTokens` / `retrieveTokens` / `refreshAccessToken` / `revokeToken`) |
| **Files (new)** | `lib/social/connect/oauth-config.ts`, `app/api/social/connect/[platform]/start/route.ts`, `app/api/social/connect/[platform]/callback/route.ts`, `app/api/social/connect/[platform]/disconnect/route.ts`, `lib/social/connect/__tests__/oauth-config.test.ts` |
| **Gate** | no new deps (PKCE uses node `crypto`); **Vendor-First re-verify each platform before coding its branch** |

## Goal
Let a user connect their own social accounts so OUR cron can post on their behalf. Mirror the proven Google-Contacts OAuth precedent exactly — with the one net-new difference that the callback **persists** tokens (via build 03's seam, never reimplementing crypto). DRY: everything connects ahead of go-live; nothing posts until `SOCIAL_PUBLISH_ENABLED=true` (gate lives in the cron, not here).

## Verified anchors (2026-06-20 — cite the symbol, never a line number)
- `buildGoogleAuthUrl({ state, redirectUri }): string` and `exchangeCodeForToken({ code, redirectUri }): Promise<string>` — `lib/email/google-oauth.ts`. Scopes joined with `" "` into the consent URL.
- `app/api/email/contacts/google/start/route.ts` — `export const OAUTH_STATE_COOKIE = "g_contacts_oauth"` (the handoff's `OAUTH_STATE_COOKIE` was a placeholder; the literal value is `g_contacts_oauth`). `GET(req: NextRequest)`. Cookie: `httpOnly: true`, `secure` only when `NODE_ENV==='production'`, `sameSite: 'lax'`, `maxAge: 600` (10 min). Payload `${state}.${flag}`. **Rate-limited per IP.**
- `app/api/email/contacts/google/callback/route.ts` — `GET(req)`; `finish(res): NextResponse` **deletes the cookie on every outcome**; **the token is never stored** (callback comment) — this is exactly the line U1 changes.
- Auth on both legs: `createClient()` (`utils/supabase/server`) + `supabase.auth.getUser()`.
- **Seam (build 03):** `storeTokens(db, userId, platform, tokens, accountInfo)`, `retrieveTokens(db, userId, platform, platformAccountId)`, `refreshAccessToken(db, userId, platform, platformAccountId)`, `revokeToken(db, userId, platform[, platformAccountId])` in `lib/social/oauth-tokens.ts`. Encrypt-at-rest is build 03's job (AES-256-GCM, `SDG_CRYPTO_KEY`) — **U1 calls these, never writes `social_accounts` columns or encrypts anything.**
- `Platform = 'x'|'facebook'|'instagram'|'linkedin'|'google_business'` — `lib/social/types.ts` (build 01). `social_accounts` cols (build 01): `platform, platform_account_id, access_token, refresh_token, token_type, expires_at, scopes[], account_name, status`.

## VENDOR-FIRST — re-verify before coding each branch (contracts in `docs/superpowers/specs/2026-06-20-social-user-side-design.md` §4)
- **X:** OAuth2 **PKCE mandatory** (`S256`). authorize `https://x.com/i/oauth2/authorize`, token `https://api.x.com/2/oauth2/token`. Scopes `tweet.write tweet.read users.read offline.access media.write` — **`offline.access` required** (else token dies in 2h, no refresh). Refresh token may rotate on use → persist the new one.
- **Meta (one combined adapter):** confidential code flow (`client_secret`, **no PKCE**). authorize `https://www.facebook.com/v25.0/dialog/oauth`, token `https://graph.facebook.com/v25.0/oauth/access_token`. Scopes `pages_manage_posts pages_read_engagement pages_show_list instagram_basic instagram_content_publish business_management`. Exchange short→**long-lived user token (~60d)** via `grant_type=fb_exchange_token`, then derive the **non-expiring long-lived Page token**. **Standard Access covers the operator's own assets (dogfood needs no review); Advanced Access = App Review + Business Verification** for customers.
- **LinkedIn:** confidential code flow. authorize `https://www.linkedin.com/oauth/v2/authorization` (code TTL 30 min), token `https://www.linkedin.com/oauth/v2/accessToken`. `w_member_social` (member; **self-serve** "Share on LinkedIn") + `openid profile email` (identity, person id from userinfo `sub`); **`w_organization_social` is gated behind the vetted Community Management API** — gate org posting behind an "org access approved" flag. Access 60d; refresh 365d **only for MDP-approved partners** else re-auth.
- **GBP (PARKED — Operation Dumbo Drop, U-D5):** standard Google OAuth, scope `https://www.googleapis.com/auth/business.manage`, `access_type=offline` + `prompt=consent`. **Allowlist-gated (0 QPM until Google approves).** Build the connect card + the flow, but surface "access pending Google approval" and do NOT block launch on it.

## Build
1. **`lib/social/connect/oauth-config.ts`** — a per-`Platform` registry: `{ authorizeUrl, tokenUrl, scopes: string[], usesPkce: boolean, parked?: boolean, buildAuthUrl({ state, redirectUri, codeChallenge? }): string, exchangeCode({ code, redirectUri, codeVerifier? }): Promise<{ access_token, refresh_token?, expires_in?, token_type?, platform_account_id, account_name, scopes: string[] }> }`. One entry per platform with the §4 contracts. Mark `google_business` `parked: true`. Mirror `buildGoogleAuthUrl`'s scope-join + param pattern.
2. **`app/api/social/connect/[platform]/start/route.ts`** — `GET(req)`: validate `[platform]` ∈ `Platform`; require `supabase.auth.getUser()`; rate-limit per IP (mirror the google `/start`); mint `state` (random) and, **for `usesPkce` (X), a `code_verifier`** → `code_challenge = base64url(sha256(verifier))`; set a `social_oauth` cookie carrying `${state}` (+ the verifier for X), `httpOnly: true`, `secure` in prod, `sameSite: 'lax'`, `maxAge: 600`; `return NextResponse.redirect(config.buildAuthUrl({ state, redirectUri, codeChallenge }))`.
3. **`app/api/social/connect/[platform]/callback/route.ts`** — `GET(req)`: read `code`+`state` from query, read the `social_oauth` cookie, **reject on state mismatch**; `config.exchangeCode({ code, redirectUri, codeVerifier })` (Meta branch performs the short→long-lived + Page-token derivation; capture `platform_account_id` + `account_name`); **`await storeTokens(db, userId, platform, tokens, accountInfo)`**; delete the cookie via a `finish(res)` helper on every outcome; `return NextResponse.redirect(workspaceUrl + '?social=connected')` (or `?social=error&reason=...` on failure). **Never store the token any other way.**
4. **`app/api/social/connect/[platform]/disconnect/route.ts`** — `POST(req)`: require user; `await revokeToken(db, userId, platform)`; set `social_accounts.status='revoked'`; **auto-pause that platform's schedules**: `UPDATE social_schedules SET status='paused' WHERE user_id=$uid AND platform=$platform AND status='active'` (U-D3). Return JSON `{ ok, paused_count }`.
5. **GBP parked:** `/start` may run OAuth, but the connect card (U4) shows "access pending Google approval"; a 0-QPM/403 from the post path (cron) is surfaced as pending, never a generic error.

## Tests & gates
State-cookie CSRF reject (mismatched/absent `state` → 4xx, no token exchange) · **X PKCE** `code_verifier`→`code_challenge` S256 round-trip · `oauth-config` builds the right authorize URL + scope set per platform · callback calls `storeTokens` with the exchanged tokens (mock build 03) and never persists otherwise · disconnect calls `revokeToken` + pauses only that platform's active schedules · real-tsc 0, eslint clean.

## Done =
A user connects X / Meta(FB+IG) / LinkedIn (GBP shows pending-approval); tokens land encrypted via `storeTokens`; disconnect revokes + auto-pauses that platform's schedules; CSRF + PKCE tests green. No live post fires (DRY).
