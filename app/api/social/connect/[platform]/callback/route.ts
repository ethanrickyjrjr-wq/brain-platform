/**
 * GET /api/social/connect/[platform]/callback
 *
 * The platform redirects here with `code` + `state` (U1). We verify `state`
 * against the httpOnly cookie set by /start (CSRF), exchange the code for tokens
 * (server-side, with the PKCE `code_verifier` for X), and PERSIST them via
 * build 03's `storeTokens` (AES-256-GCM at rest) — the one net-new difference vs
 * the read-only Google-Contacts precedent. We NEVER write `social_accounts`
 * columns directly or encrypt anything here.
 *
 * The single-use state cookie is deleted on every outcome (finish). On success
 * we redirect to the saved return path with `?social=connected`; on any failure
 * with `?social=error&reason=…`.
 */
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { storeTokens } from "@/lib/social/oauth-tokens";
import {
  buildReturnUrl,
  decodeOAuthState,
  getOAuthConfig,
  isPlatform,
  isSafeReturnPath,
  socialRedirectUri,
} from "@/lib/social/connect/oauth-config";
import { SOCIAL_OAUTH_COOKIE } from "../start/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const statePayload = decodeOAuthState(cookieStore.get(SOCIAL_OAUTH_COOKIE)?.value);
  const returnPath = statePayload && isSafeReturnPath(statePayload.r) ? statePayload.r : "/";

  const fail = (reason: string) =>
    finish(NextResponse.redirect(buildReturnUrl(req.url, returnPath, { social: "error", reason })));

  if (!user) {
    return finish(
      NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(returnPath)}`, req.url)),
    );
  }
  if (!isPlatform(platform)) return fail("unknown_platform");

  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return fail("denied"); // user declined at the provider

  const code = sp.get("code");
  const stateParam = sp.get("state");
  // CSRF: the cookie must exist, be minted for THIS platform, and echo the same state.
  if (
    !code ||
    !stateParam ||
    !statePayload ||
    statePayload.p !== platform ||
    statePayload.s !== stateParam
  ) {
    return fail("state");
  }

  try {
    const cfg = getOAuthConfig(platform);
    const tokens = await cfg.exchangeCode({
      code,
      redirectUri: socialRedirectUri(platform, req.url),
      codeVerifier: statePayload.v ?? undefined,
    });
    if (!tokens.platform_account_id) return fail("no_account");

    // expires_in (seconds-from-now) → epoch SECONDS for the token store (null = non-expiring).
    const expires_at =
      tokens.expires_in != null ? Math.floor(Date.now() / 1000) + tokens.expires_in : null;

    await storeTokens(
      supabase,
      user.id,
      platform,
      {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_at,
        scopes: tokens.scopes,
      },
      { account_name: tokens.account_name, platform_account_id: tokens.platform_account_id },
    );
  } catch {
    return fail("exchange");
  }

  return finish(
    NextResponse.redirect(buildReturnUrl(req.url, returnPath, { social: "connected", platform })),
  );
}

/** Drop the single-use state cookie on the way out, whatever the outcome. */
function finish(res: NextResponse): NextResponse {
  res.cookies.delete(SOCIAL_OAUTH_COOKIE);
  return res;
}
