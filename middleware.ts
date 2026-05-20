import { type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

export function middleware(request: NextRequest) {
  return createClient(request);
}

export const config = {
  matcher: [
    // Run on every path EXCEPT static assets and image optimization output.
    // This matcher mirrors the canonical Supabase Next.js SSR pattern.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
