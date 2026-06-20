/**
 * GET /api/social/connect/[platform]/start
 *
 * Begins the "connect your socials" OAuth for one platform (U1). Requires a
 * signed-in user. Mints a CSRF `state` and — for X (PKCE) — a `code_verifier`,
 * stows both (plus a same-origin return path) in a short-lived httpOnly cookie,
 * and redirects to the platform's consent screen.
 *
 * Mirrors the Google-Contacts precedent (app/api/email/contacts/google/start).
 * DRY: connecting an account never posts — the publish gate lives in the cron
 * worker (build 04), behind SOCIAL_PUBLISH_ENABLED.
 *
 * Query: `?return=/project/<id>` — a same-origin path to land on after connect
 * (open-redirect-guarded; defaults to `/`).
 */
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/utils/supabase/server";
import { checkRateLimit, clientIpFromHeaders, rateLimitHeaders } from "@/lib/rate-limit";
import {
  buildReturnUrl,
  codeChallengeS256,
  encodeOAuthState,
  generateCodeVerifier,
  getOAuthConfig,
  isPlatform,
  isSafeReturnPath,
  socialOauthConfigured,
  socialRedirectUri,
} from "@/lib/social/connect/oauth-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const SOCIAL_OAUTH_COOKIE = "social_oauth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  // Per-IP rate limit — guards OAuth-mint spam (not in the middleware prefix list).
  const rl = checkRateLimit(clientIpFromHeaders(req.headers));
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { platform } = await params;
  if (!isPlatform(platform)) {
    return NextResponse.json({ error: "unknown_platform" }, { status: 404 });
  }

  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const returnPath = safeReturn(req);
  if (!user) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(returnPath)}`, req.url));
  }

  if (!socialOauthConfigured(platform)) {
    return NextResponse.redirect(
      buildReturnUrl(req.url, returnPath, { social: "error", reason: "not_configured" }),
    );
  }

  const cfg = getOAuthConfig(platform);
  const state = randomBytes(16).toString("hex");
  const codeVerifier = cfg.usesPkce ? generateCodeVerifier() : null;
  const codeChallenge = codeVerifier ? codeChallengeS256(codeVerifier) : undefined;
  const redirectUri = socialRedirectUri(platform, req.url);

  const res = NextResponse.redirect(cfg.buildAuthUrl({ state, redirectUri, codeChallenge }));
  // httpOnly + lax (rides the top-level redirect back) + 10-min TTL; single-use
  // (the callback deletes it on every outcome).
  res.cookies.set(
    SOCIAL_OAUTH_COOKIE,
    encodeOAuthState({ p: platform, s: state, v: codeVerifier, r: returnPath }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    },
  );
  return res;
}

/** Same-origin return path from `?return=`, or `/`. */
function safeReturn(req: NextRequest): string {
  const r = req.nextUrl.searchParams.get("return");
  return isSafeReturnPath(r) ? r : "/";
}
