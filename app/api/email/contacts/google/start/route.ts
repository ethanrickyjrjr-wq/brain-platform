/**
 * GET /api/email/contacts/google/start
 *
 * Begins the read-only Google Contacts import. Requires a signed-in user (the
 * import is RLS-scoped to them on the callback leg). Mints a CSRF `state`, stows
 * it — together with the "work emails only" choice — in a short-lived httpOnly
 * cookie, and redirects to Google's consent screen.
 *
 * Query: `work_only=1` to keep only company/professional domains on import.
 */
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/utils/supabase/server";
import { buildGoogleAuthUrl, googleRedirectUri, googleOauthConfigured } from "@/lib/email/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OAUTH_STATE_COOKIE = "g_contacts_oauth";

export async function GET(req: NextRequest) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/contacts/upload", req.url));
  }

  if (!googleOauthConfigured()) {
    return NextResponse.redirect(new URL("/contacts/upload?google_error=not_configured", req.url));
  }

  const workOnly = req.nextUrl.searchParams.get("work_only") === "1";
  const state = randomBytes(16).toString("hex");
  const redirectUri = googleRedirectUri(req.url);

  const res = NextResponse.redirect(buildGoogleAuthUrl({ state, redirectUri }));
  // `${state}.${workOnly}` — lax so the cookie rides the top-level redirect back
  // from Google; httpOnly + 10-min TTL; single-use (callback deletes it).
  res.cookies.set(OAUTH_STATE_COOKIE, `${state}.${workOnly ? "1" : "0"}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
