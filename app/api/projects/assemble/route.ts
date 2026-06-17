import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { recordUse } from "@/lib/highlighter/meter";
import { applyUserBrandToProject } from "@/lib/project/apply-brand";
import { planAssembly } from "@/lib/project/assemble-command";
import type { ProjectItem } from "@/lib/project/items";

export const runtime = "nodejs";

/**
 * POST /api/projects/assemble — "build a project for {ZIP/place}, pull the important data
 * from my existing projects" (Piece 2 §E). Deterministic v1 (free): parse the scope,
 * select identity-deduped items from the user's scope-matching projects, create a new
 * branded project seeded with them, land it open. Mirrors `/api/projects/import` (same
 * insert + `applyUserBrandToProject` + `project_create` meter) — only the items are
 * computed instead of imported from a draft. The LLM curation/ordering + one-deliverable
 * pre-build is the gated accelerator (deferred; flag-off → exactly this path).
 *
 * Cookie client only — RLS scopes the projects read AND binds the new row to auth.uid().
 * Builds stay FREE (assemble is a build, never gated; send is the only paywall).
 */
export async function POST(req: NextRequest) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const command = typeof body?.command === "string" ? body.command : "";
  if (!command.trim()) return NextResponse.json({ error: "missing command" }, { status: 400 });

  // The user's projects (RLS → only their own).
  const { data: rows } = await supabase.from("projects").select("id, title, items");
  const projects = (
    (rows as { id: string; title: string | null; items: ProjectItem[] | null }[] | null) ?? []
  ).map((r) => ({ projectId: r.id, title: r.title ?? "", items: r.items ?? [] }));

  const plan = planAssembly(command, projects);
  if (!plan.scope.zip && !plan.scope.place && !plan.scope.topic) {
    return NextResponse.json(
      { error: "Tell me which ZIP or place to build the project for." },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID().slice(0, 12);
  const { error } = await supabase.from("projects").insert({
    id,
    user_id: user.id,
    title: plan.title,
    items: plan.items,
  });
  if (error) return NextResponse.json({ error: "assemble failed" }, { status: 500 });

  // Branding follows EVERY creation path (G2); project_create is a proven-user event.
  await applyUserBrandToProject(supabase, user.id, id);
  await recordUse(req, { report_id: "", reach: [], action: "project_create" }, user.id);

  return NextResponse.json({
    id,
    title: plan.title,
    itemCount: plan.items.length,
    sourceProjectIds: plan.sourceProjectIds,
  });
}
