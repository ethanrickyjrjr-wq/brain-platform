/**
 * POST /api/social/connect/[platform]/disconnect
 *
 * Disconnect a platform (U1 / U-D3): revoke the token at the platform + flip
 * `social_accounts.status='revoked'` (build 03's `revokeToken`), then AUTO-PAUSE
 * that platform's active schedules so nothing is left armed to fire against a
 * dead credential. We pause (not delete) — a reconnect can resume.
 *
 * RLS-scoped: the authed cookie client only ever touches the caller's own rows
 * (auth.uid() = user_id); the explicit user_id filter is defense-in-depth.
 *
 * Returns JSON `{ ok, paused_count }`.
 */
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { revokeToken } from "@/lib/social/oauth-tokens";
import { isPlatform } from "@/lib/social/connect/oauth-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isPlatform(platform))
    return NextResponse.json({ error: "unknown_platform" }, { status: 404 });

  // Revoke at the platform (best-effort) + mark the account row revoked.
  try {
    await revokeToken(supabase, user.id, platform);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "revoke_failed" },
      { status: 500 },
    );
  }

  // Auto-pause ONLY this platform's active schedules (U-D3).
  const { data, error } = await supabase
    .from("social_schedules")
    .update({ status: "paused", updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("platform", platform)
    .eq("status", "active")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, paused_count: data?.length ?? 0 });
}
