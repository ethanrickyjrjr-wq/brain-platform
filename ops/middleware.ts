import { NextRequest, NextResponse } from "next/server";

/**
 * Single-env-var basic-auth gate. Private dashboard.
 *
 * OPS_BASIC_AUTH = "user:password". When unset, the gate is OPEN — intended
 * only for local dev. In the Vercel project the var is always set, so prod is
 * always gated.
 */
export function middleware(req: NextRequest) {
  const expected = process.env.OPS_BASIC_AUTH;
  if (!expected) return NextResponse.next(); // dev: no gate

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    if (decoded === expected) return NextResponse.next();
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="SWFL /ops"' },
  });
}

// Gate everything except Next internals.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
