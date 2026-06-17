import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { recordUse } from "@/lib/highlighter/meter";
import { assembleDeliverable, isTemplateId, DeliverableError } from "@/lib/deliverable/assemble";
import { parseDeliverableScope } from "@/lib/deliverable/parse-scope";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/projects/[id]/build  — assemble a deliverable from a project.
 *
 * Ownership is proven via the COOKIE client (RLS: a non-owner's project row is
 * invisible → 404). The actual assembly (freeze → forced-tool narrative → lint →
 * insert) lives in the shared `assembleDeliverable` orchestrator — ONE build path
 * reused by the MCP `swfl_project_build` tool. The row is written via service-role
 * because `deliverables` has no INSERT policy; ownership is already proven above.
 * Returns `{ id }` → the client navigates to /p/[id].
 */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // RLS proves ownership: a non-owner id resolves to no row → 404.
  const { data: project, error: loadErr } = await supabase
    .from("projects")
    .select("id, items, branding")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: "read failed" }, { status: 500 });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    template?: string;
    instruction?: string;
    scope_kind?: string;
    scope_value?: string;
  };
  const template = body.template;
  if (!isTemplateId(template)) {
    return NextResponse.json({ error: "invalid template" }, { status: 400 });
  }
  const instruction = typeof body.instruction === "string" ? body.instruction : "";

  // G4: thread the deliverable scope (the email_schedules contract, verbatim) so an
  // "email" deliverable seeded from outside carries its ZIP/place/county scope into
  // /p/[id] + the print route. Non-scoped templates pass `{}` → NULL/NULL.
  const scope = parseDeliverableScope(body.scope_kind, body.scope_value);

  // A-8.5: stamp the real auth.uid on the build event so the 30-day trial window
  // (first build per account) is queryable from one column. user is proven above.
  await recordUse(req, { report_id: id, reach: [], action: "build" }, user.id);

  try {
    const { id: slug } = await assembleDeliverable({
      db: createServiceRoleClient(),
      projectId: id,
      ownerId: user.id,
      items: project.items,
      branding: project.branding,
      template,
      instruction,
      ...scope,
    });
    return NextResponse.json({ id: slug });
  } catch (e) {
    if (e instanceof DeliverableError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
