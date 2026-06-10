import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import type { TemplateId } from "@/lib/deliverable/templates";

export const runtime = "nodejs";

/**
 * POST /api/deliverables/[id]/restyle
 *   body: { template: TemplateId }
 *
 * Re-renders the SAME narrative + frozen items under a different template with
 * NO new LLM call — the /p/[id] page rebuilds the RenderModel from
 * (template, narrative, items_snapshot) at render time, so swapping the
 * `template` column is the entire operation. Free and instant ("cheap restyle").
 *
 * Owner-gated exactly like the revoke route: the deliverables table has only a
 * public SELECT policy, so the write goes through service_role AFTER verifying
 * the caller owns the row.
 */

const TEMPLATES = new Set<TemplateId>(["market-overview", "bov-lite", "client-email", "one-pager"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { template?: string };
  const template = body.template as TemplateId | undefined;
  if (!template || !TEMPLATES.has(template)) {
    return NextResponse.json({ error: "invalid template" }, { status: 400 });
  }

  // Public SELECT — verify ownership before mutating.
  const { data: deliverable } = await supabase
    .from("deliverables")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!deliverable) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (deliverable.user_id !== user.id)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const svc = createServiceRoleClient();
  const { error } = await svc.from("deliverables").update({ template }).eq("id", id);
  if (error) return NextResponse.json({ error: "restyle failed" }, { status: 500 });

  return NextResponse.json({ ok: true, template });
}
