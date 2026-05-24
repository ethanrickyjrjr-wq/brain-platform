import { type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

export function middleware(request: NextRequest) {
  return createClient(request);
}

export const config = {
  matcher: [
    // Run on every path EXCEPT static assets, image optimization output, and
    // the public stateless API routes. /api/b/*, /api/mcp, and /api/waitlist
    // must stay reachable without any auth-client env vars present (the
    // Supabase middleware client no-ops on missing env, but we skip it
    // entirely to avoid burning a function invocation per public request).
    "/((?!api/b/|api/mcp|api/waitlist|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
