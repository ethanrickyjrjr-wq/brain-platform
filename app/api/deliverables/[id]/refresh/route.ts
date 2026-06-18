import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { assembleDeliverable, isTemplateId, DeliverableError } from "@/lib/deliverable/assemble";
import { resolveRefreshItems } from "@/lib/deliverable/resolve-refresh-items";
import type { TemplateId } from "@/lib/deliverable/templates";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/deliverables/[id]/refresh — re-render this deliverable against today's lake.
 *
 * Forks a NEW row (supersedes_id = [id]) so a shared /p/[id] stays frozen for an
 * external holder. The new row keeps the same template/branding/scope/instruction; its
 * items are the project's CURRENT items restricted to this deliverable's original
 * snapshot (same items, re-resolved against today's data — charts re-read saved_charts,
 * frames re-bind to live brain data), falling back to the frozen snapshot when the
 * project no longer holds them. Owner-gated like revoke; the assemble write goes through
 * service_role. Free.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Public SELECT — load the source row + verify ownership.
  const { data: src } = await supabase
    .from("deliverables")
    .select(
      "user_id, project_id, template, instruction, branding, items_snapshot, scope_kind, scope_value, deleted_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!src) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (src.user_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (src.deleted_at) return NextResponse.json({ error: "deleted" }, { status: 409 });
  if (!isTemplateId(src.template))
    return NextResponse.json({ error: "invalid template" }, { status: 422 });

  // Same items, today's data (cookie client → owner-scoped project load).
  const items = await resolveRefreshItems(supabase, src.project_id, src.items_snapshot);

  try {
    const { id: newId } = await assembleDeliverable({
      db: createServiceRoleClient(),
      projectId: src.project_id,
      ownerId: user.id,
      items,
      branding: src.branding,
      template: src.template as TemplateId,
      instruction: src.instruction ?? "",
      scope_kind: src.scope_kind ?? undefined,
      scope_value: src.scope_value ?? undefined,
      supersedesId: id,
    });
    return NextResponse.json({ id: newId });
  } catch (e) {
    if (e instanceof DeliverableError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
