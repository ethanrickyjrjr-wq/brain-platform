import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { projectItemsSchema } from "@/lib/project/items";
import { instantiateTemplate, projectTemplateSchema } from "@/lib/deliverable/project-template";
import { assembleDeliverable, isTemplateId, DeliverableError } from "@/lib/deliverable/assemble";
import { recordUse } from "@/lib/highlighter/meter";
import { resolveUserBrand } from "@/lib/email/templates/resolve-brand";
import { applyUserBrandToProject } from "@/lib/project/apply-brand";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * POST /api/templates/[id]/run — the one-command "Listing PDF maker" flywheel.
 *
 * Takes a named template ID + a scope value (ZIP or address) and:
 *   1. Loads the template (RLS-proven ownership via cookie client).
 *   2. Instantiates it → fresh ProjectItems with new ids/timestamps.
 *   3. Creates a new project row (service-role write — items validated above).
 *   4. Assembles a deliverable (freeze snapshot → narrative → insert).
 *   5. Returns `{ project_id, deliverable_id, url }` where url = /p/[deliverable_id].
 *
 * The `scope` field is stored as the project title (e.g. "ZIP 33908 — Flood Risk Sheet")
 * so each instantiation is traceable. It is also passed as the build instruction so the
 * LLM narrative can reference the scope explicitly.
 *
 * Body: { scope?: string; template?: TemplateId; instruction?: string }
 *   - scope       A ZIP code, address, or place description for the project title.
 *   - template    Render template id (e.g. "market-overview"). Defaults to "one-pager".
 *   - instruction Extra instruction passed to the narrative step.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: templateId } = await params;
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // RLS proves ownership — a non-owner's template is invisible (returns null).
  const { data: row, error: loadErr } = await supabase
    .from("project_templates")
    .select("id, name, recipes, scope_type")
    .eq("id", templateId)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: "read failed" }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = projectTemplateSchema.safeParse(row);
  if (!parsed.success) {
    return NextResponse.json({ error: "template data corrupted" }, { status: 500 });
  }
  const tpl = parsed.data;

  const body = (await req.json().catch(() => ({}))) as {
    scope?: string;
    template?: string;
    instruction?: string;
  };

  const scope = typeof body.scope === "string" ? body.scope.trim() : "";
  const renderTemplate = isTemplateId(body.template) ? body.template : "one-pager";
  const instruction = [
    scope ? `Scope: ${scope}.` : "",
    typeof body.instruction === "string" ? body.instruction : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Instantiate: produce fresh {kind:"frame"} items — no stale ChartSpecs carried forward.
  const now = new Date().toISOString();
  const items = instantiateTemplate(tpl, now);

  // Validate the freshly-generated items defensively.
  const parsedItems = projectItemsSchema.safeParse(items);
  if (!parsedItems.success) {
    return NextResponse.json({ error: "instantiation produced invalid items" }, { status: 500 });
  }

  const serviceDb = createServiceRoleClient();

  // Create a new project row for this instantiation.
  const projectId = crypto.randomUUID().slice(0, 12);
  const title = scope ? `${scope} — ${tpl.name}` : tpl.name;

  const { error: projectErr } = await serviceDb.from("projects").insert({
    id: projectId,
    user_id: user.id,
    title,
    items: parsedItems.data,
  });
  if (projectErr) return NextResponse.json({ error: "project create failed" }, { status: 500 });

  // Brand the persisted project row too (G2 parity — the other 4 creation paths
  // do this; the template-run path previously branded only the deliverable, leaving
  // the project row unbranded). Best-effort, never throws.
  await applyUserBrandToProject(supabase, user.id, projectId);

  await recordUse(req, { report_id: projectId, reach: [], action: "template_run" });

  // 4E: include resolved user brand so AI narrative has the brand context
  const userBrand = await resolveUserBrand(supabase, user.id);
  const branding = userBrand
    ? {
        primary_color: userBrand.primary,
        accent_color: userBrand.accent,
        logo_url: userBrand.logoUrl,
      }
    : null;

  // Assemble the deliverable (freeze → narrative → insert).
  try {
    const { id: deliverableId } = await assembleDeliverable({
      db: serviceDb,
      projectId,
      ownerId: user.id,
      items: parsedItems.data,
      branding,
      template: renderTemplate,
      instruction,
    });
    return NextResponse.json({
      project_id: projectId,
      deliverable_id: deliverableId,
      url: `/p/${deliverableId}`,
    });
  } catch (e) {
    if (e instanceof DeliverableError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
