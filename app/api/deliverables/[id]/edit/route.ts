import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { assembleDeliverable, isTemplateId, DeliverableError } from "@/lib/deliverable/assemble";
import { planDeliverableEdit } from "@/lib/deliverable/edit-plan";
import { resolveRefreshItems } from "@/lib/deliverable/resolve-refresh-items";
import type { TemplateId } from "@/lib/deliverable/templates";

/** A client may include their OWN files, not another client's. Upload paths are
 *  `<uid>/<projectId>/<uuid>` (storage RLS already scopes reads this way); a foreign
 *  file ref would otherwise be re-signed by service_role on the public /p/[id]. Only
 *  `file` items carry private cross-user data — every other item kind is the client's
 *  own asserted content, theirs to use. */
function hasForeignFile(items: unknown, ownerId: string): boolean {
  if (!Array.isArray(items)) return false;
  return items.some(
    (it) =>
      it != null &&
      typeof it === "object" &&
      (it as { kind?: string }).kind === "file" &&
      !String((it as { storage_path?: unknown }).storage_path ?? "").startsWith(`${ownerId}/`),
  );
}

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/deliverables/[id]/edit — guided edit of a past deliverable.
 *   body: { items?, template?, branding?, instruction? }
 *
 * COSMETIC (template and/or branding only) → in-place update, no new row, no LLM
 * (the `restyle` precedent; the public page re-renders from the row at view time).
 * CONTENT (items and/or instruction changed) → fork a NEW gated version
 * (supersedes_id = [id]), leaving the old /p/[id] frozen. NEVER free-text prose —
 * the narrative is always regenerated through assembleDeliverable's gated pipeline
 * (freeze → forced-tool narrative → 4 lints), so editing can't smuggle unsourced
 * claims in. Free (editing is part of build; send is the only paywall).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const body = await req.json().catch(() => ({}));
  const plan = planDeliverableEdit(body);
  if (plan.mode === "invalid")
    return NextResponse.json({ error: plan.error }, { status: plan.status });
  if (plan.mode === "noop") return NextResponse.json({ error: "nothing to edit" }, { status: 400 });

  const svc = createServiceRoleClient();

  // COSMETIC — single in-place update, no new row, no LLM.
  if (plan.mode === "cosmetic") {
    // Frozen-link integrity: an email deliverable renders through a scope-bound path,
    // so swapping its template in place would silently break a shared /p/[id]. (The
    // non-email→email direction is already rejected in planDeliverableEdit.)
    if (plan.patch.template !== undefined && src.template === "email")
      return NextResponse.json(
        { error: "cannot change an email deliverable's template" },
        { status: 400 },
      );
    const { error } = await svc.from("deliverables").update(plan.patch).eq("id", id);
    if (error) return NextResponse.json({ error: "update failed" }, { status: 500 });
    return NextResponse.json({ ok: true, id, inPlace: true });
  }

  // CONTENT — fork a new gated version. Merge the changed inputs over the source row.
  const template: TemplateId = (plan.template ?? src.template) as TemplateId;
  if (!isTemplateId(template))
    return NextResponse.json({ error: "invalid template" }, { status: 422 });
  const branding = plan.brandingProvided ? plan.branding : src.branding;
  const instruction = plan.instructionProvided ? (plan.instruction ?? "") : (src.instruction ?? "");
  // The client supplies the items they want; if none, refresh the source set. The only
  // boundary: a file item must be the caller's own upload (storage-RLS parity).
  const items = plan.itemsProvided
    ? plan.items
    : await resolveRefreshItems(supabase, src.project_id, src.items_snapshot);
  if (hasForeignFile(items, user.id))
    return NextResponse.json(
      { error: "file items must reference your own uploads" },
      { status: 400 },
    );

  try {
    const { id: newId } = await assembleDeliverable({
      db: svc,
      projectId: src.project_id,
      ownerId: user.id,
      items,
      branding,
      template,
      instruction,
      scope_kind: src.scope_kind ?? undefined,
      scope_value: src.scope_value ?? undefined,
      supersedesId: id,
    });
    return NextResponse.json({ id: newId, inPlace: false });
  } catch (e) {
    if (e instanceof DeliverableError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
