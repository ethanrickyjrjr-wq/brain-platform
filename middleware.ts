import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/middleware";
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
    return pass;
  }

  // Everything else keeps the existing Supabase auth-refresh behavior unchanged.
  return createClient(request);
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
