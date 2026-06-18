import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";

export const runtime = "nodejs";

/**
 * POST /api/deliverables/[id]/trash
 *   body: { restore?: boolean }
 *
 * Soft-delete (deleted_at = now) or restore (deleted_at = null) a deliverable — the
 * trash twin of the revoke route. A trashed row drops out of the Built lane and
 * /p/[id] (404); it is recoverable from the "Recently deleted" lane for 7 days, then
 * a daily retention sweep hard-deletes it. Trash is a SEPARATE axis from revoke
 * (`status`): a revoked row stays in the lane (its link is killed); a trashed row is
 * gone. Owner-gated exactly like revoke — public SELECT verifies ownership, the write
 * goes through service_role. Free (managing deliverables is free; send is the paywall).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Public SELECT — verify ownership before mutating.
  const { data: deliverable } = await supabase
    .from("deliverables")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!deliverable) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (deliverable.user_id !== user.id)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const deleted_at = body.restore ? null : new Date().toISOString();

  const svc = createServiceRoleClient();
  const { error } = await svc.from("deliverables").update({ deleted_at }).eq("id", id);
  if (error) return NextResponse.json({ error: "update failed" }, { status: 500 });

  return NextResponse.json({ ok: true, deleted_at });
}
