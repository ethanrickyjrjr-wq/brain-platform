# U1 — DONE (Connect your socials / OAuth) — build handoff

**Status: BUILT + GATED on the working tree, committed (explicit-path), NOT pushed** (operator pushes — no-autonomous-push). This is the *what-shipped* companion to the pre-build `U1-HANDOFF.md`. Read this before U2/U3/U4 — it pins the exact seams those surfaces consume.

## What landed (files)

| File | Role |
|---|---|
| `lib/social/connect/oauth-config.ts` | Per-`Platform` OAuth registry: authorize/token endpoints + scopes + `buildAuthUrl` + `exchangeCode`; PKCE (S256) helpers; state-cookie codec; open-redirect guard; redirect-URI builder; `socialOauthConfigured`/`isPlatform`. |
| `app/api/social/connect/[platform]/start/route.ts` | `GET` — auth + rate-limit, mint state (+ X PKCE verifier), set httpOnly `social_oauth` cookie, redirect to consent. |
| `app/api/social/connect/[platform]/callback/route.ts` | `GET` — CSRF state-check → `exchangeCode` → **`storeTokens` (build 03)** → redirect `?social=connected\|error`. Single-use cookie deleted on every outcome. |
| `app/api/social/connect/[platform]/disconnect/route.ts` | `POST` — `revokeToken` + auto-pause that platform's active schedules (U-D3) → `{ ok, paused_count }`. |
| `lib/social/oauth-tokens.ts` | **ADDED `revokeToken(db, userId, platform[, platformAccountId])`** (the gap `U1-HANDOFF.md` flagged) — best-effort platform revoke (X + Google) + authoritative `status='revoked'`. Existing exports untouched. |
| `__tests__` (3 files) | `oauth-config.test.ts`, callback `route.test.ts`, disconnect `route.test.ts`, `lib/social/__tests__/oauth-tokens-revoke.test.ts`. |

## Gates (U1 done-bar) — all green
`real-tsc` 0 (only pre-existing stale `.next` artifact) · `eslint` clean · `next build` ✓ (all 3 routes compiled `ƒ` dynamic) · **38/38 tests** (CSRF reject + no-exchange, X PKCE S256 round-trip, per-platform authorize URL + scopes, exchangeCode happy-paths, callback→storeTokens, disconnect→revokeToken + platform-scoped pause, safe-return guard). DRY — no live post fires; the publish gate stays in the cron (build 04).

## Adversarial security review (9-agent workflow, 6 attack-surface lenses)
**U1 code: CLEAN.** The CSRF/state, PKCE, token-lifecycle, auth/RLS, and vendor-contract lenses found **zero** real issues in the U1 surface — the state cookie is platform-bound + single-use, PKCE S256 is correct, `expires_in→expires_at` is right, every route requires `getUser()`, and the authed (RLS) client is used throughout (never service-role).

**Bonus find (pre-existing, NOT U1):** the open-redirect lens caught that 3 older auth surfaces had only a `startsWith("/")` guard, so `?next=//evil.com` escapes to an attacker origin (HIGH on `/login` + `login-form`, MED on `/auth/callback`, LOW on `contacts/upload`). The guard U1 introduced (`isSafeReturnPath`) is the exact fix. **Shipped as a SEPARATE commit** (`fix(security): …`): extracted `lib/safe-return.ts` (single source of truth, used by U1 + the auth sinks) and wired all four. Push it with U1 or independently.

## Vendor-First — re-verified live in-session (2026-06-20), not from memory
- **X:** `x.com/i/oauth2/authorize` + `api.x.com/2/oauth2/token`; PKCE **S256 mandatory**; scopes `tweet.read tweet.write users.read offline.access media.write` (offline.access → refresh; media.write → image post); confidential client (HTTP Basic) on token; refresh token may rotate (storeTokens persists the new one).
- **Meta:** **v25.0 confirmed current**; dialog `facebook.com/v25.0/dialog/oauth` + token `graph.facebook.com/v25.0/oauth/access_token`; client_secret, **no PKCE**; **scope list is COMMA-joined** in the dialog URL; short→long-lived (`fb_exchange_token`) → non-expiring **Page token** (the durable credential).
- **LinkedIn:** `linkedin.com/oauth/v2/authorization` + `/accessToken`; 30-min code; `w_member_social openid profile email`; identity from `/v2/userinfo` `sub`; refresh only for MDP partners (else re-auth at 60d).
- **GBP (parked):** `accounts.google.com/o/oauth2/v2/auth` + `oauth2.googleapis.com/token`; `access_type=offline` + `prompt=consent`; scope `business.manage`; revoke `oauth2.googleapis.com/revoke`.

## Seams the next surfaces consume
- **U4 (workspace lane / connect block):** the connect/disconnect actions are these routes. Start a connect with `GET /api/social/connect/{platform}/start?return=/project/<id>` — `?return=` is same-origin-guarded; the callback lands back there with `?social=connected|error&reason=…&platform=…`. Reconnect-on-expiry (U-D4) = re-hit `/start` for that platform. Read connected state from `social_accounts` (`status`, `account_name`, `platform`).
- **Disconnect:** `POST /api/social/connect/{platform}/disconnect` → `{ ok, paused_count }`. It flips `social_accounts.status='revoked'` AND pauses that platform's `active` schedules.
- **storeTokens contract honored:** `expires_in` (sec-from-now) → `expires_at` epoch **seconds**; Meta Page token stored with `expires_at=null` (non-expiring). The callback uses the **authed cookie client** (RLS `auth.uid()=user_id`) — never service-role.

## Env vars OPS must set for a live connect (per platform; all absent today → graceful "not_configured")
`X_CLIENT_ID/X_CLIENT_SECRET` · `META_APP_ID/META_APP_SECRET` · `LINKEDIN_CLIENT_ID/LINKEDIN_CLIENT_SECRET` · `GBP_CLIENT_ID/GBP_CLIENT_SECRET`. (`SDG_CRYPTO_KEY` for token encryption already required by build 03.) Each provider's allow-listed redirect URI must be `https://www.swfldatagulf.com/api/social/connect/{platform}/callback`.

## Known v1 limitations (documented, not bugs)
- **Meta connects the first managed Page** (`me/accounts[0]`); multi-page picker is a fast-follow.
- **GBP is parked** — connect + token-store work; account id is `pending-google-approval` until Google allowlist access lands (then it graduates with a follow-up, no rewrite).
- **LinkedIn org posting** (`w_organization_social`) is NOT requested — member-only (`w_member_social`); org Pages need the vetted Community Management API (separate approval).

## Plan order (corrected, still holds): **U1 ‖ U2 → U3 → U4**
U1 done. U2 (ask-AI compose/preview, Opus) and U3 (MCP tools, Sonnet) are next; U4 (workspace lane) edits shared FINAL-BOSS files — re-probe at build time. Go-live image spike (one real post/platform) closes `social_x_media_v2_scope_verify` + `social_media_storage_upload` once creds are set.
