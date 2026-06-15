import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/me — a minimal, client-readable auth signal.
 *
 * Lets the global Briefcase/pill branch on logged-in vs out WITHOUT making any
 * page or layout dynamic: the auth read happens here (an API route is dynamic by
 * nature because it reads cookies), and clients poll it via `useSession()`.
 * Returns no PII — only whether a session exists and the opaque user id.
 */
export async function GET() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return NextResponse.json(user ? { authed: true, userId: user.id } : { authed: false });
}
