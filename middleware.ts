import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

// Public, unauthenticated data endpoints. These bypass the Supabase auth client
// entirely (they must stay reachable with no auth env vars present) but DO get
// a best-effort per-IP burst limiter in front of them to break the trivial
// "loop the sitemap → clone the whole lake" attack. See lib/rate-limit.ts and
// the PR runbook for why the authoritative ceiling is a Vercel WAF dashboard
// rule, not this code path.
const RATE_LIMITED_PREFIXES = ["/api/b/", "/api/mcp", "/api/waitlist"];

function isRateLimited(pathname: string): boolean {
  return RATE_LIMITED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

const SDG_CID_COOKIE = "sdg_cid";
const SDG_CID_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

async function hmac16(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}

/** Returns a fresh signed cid, or null if minting is impossible (no secret / crypto error). */
async function mintCid(): Promise<string | null> {
  const secret = process.env.SDG_COOKIE_SECRET;
  if (!secret) return null;
  try {
    const randomId = crypto.randomUUID();
    return `${randomId}.${await hmac16(randomId, secret)}`;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasCid = Boolean(request.cookies.get(SDG_CID_COOKIE));
  const freshCid = hasCid ? null : await mintCid();

  const attachCid = (res: NextResponse) => {
    if (freshCid) {
      res.cookies.set(SDG_CID_COOKIE, freshCid, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: SDG_CID_MAX_AGE,
      });
    }
    return res;
  };

  // Public API: per-IP burst guard, NO Supabase client (keeps these routes
  // reachable without auth env vars and saves a function invocation per hit).
  if (isRateLimited(pathname)) {
    const ip = clientIpFromHeaders(request.headers);
    const result = checkRateLimit(ip);
    if (result.limited) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      return NextResponse.json(
        { error: "rate limit exceeded" },
        {
          status: 429,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": String(result.remaining),
            "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
          },
        },
      );
    }
    // Under the limit: let the request through untouched, but surface the
    // budget so well-behaved clients can self-throttle.
    const pass = NextResponse.next();
    pass.headers.set("X-RateLimit-Limit", String(result.limit));
    pass.headers.set("X-RateLimit-Remaining", String(result.remaining));
    pass.headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
    return attachCid(pass);
  }

  // Everything else: refresh the Supabase session (and get the current user).
  const { response, user } = await updateSession(request);

  // Gate the entire /project prefix when unauthenticated — every other path
  // behaves exactly as before (the named lock-out risk). NOTE: there is no
  // anonymous-draft carve-out. The /project/draft path was previously exempted
  // here, but no such page exists — the request fell through to /project/[id],
  // which gated id="draft" with its own getUser redirect anyway. Removed that
  // dead exemption (2026-06-10) so middleware doesn't lie about a public draft.
  // If an anonymous /project/draft view is built later, re-add the exemption
  // in the SAME commit as the page.
  const isProject = pathname === "/project" || pathname.startsWith("/project/");
  if (isProject && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    const redirect = NextResponse.redirect(url);
    // Per the Supabase SSR docs: when building a new response, copy the refreshed
    // auth cookies over so the browser/server session doesn't desync.
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return attachCid(redirect);
  }

  return attachCid(response);
}

export const config = {
  matcher: [
    // Run on every path EXCEPT static assets and image optimization output.
    // The public stateless API routes (/api/b/*, /api/mcp, /api/waitlist) are
    // now INCLUDED so the burst limiter above can guard them; the middleware
    // body short-circuits them past the Supabase client, so they still need no
    // auth env vars and still cost only the lightweight limiter path.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
