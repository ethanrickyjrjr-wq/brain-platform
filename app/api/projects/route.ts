import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { projectItemsSchema } from "@/lib/project/items";
import { recordUse } from "@/lib/highlighter/meter";
import { applyUserBrandToProject } from "@/lib/project/apply-brand";

export const runtime = "nodejs";

/**
 * POST /api/projects — create a project owned by the signed-in user.
 *
 * CRITICAL: uses the COOKIE client (RLS-enforced), never the service-role client.
 * RLS WITH CHECK (auth.uid() = user_id) is the authorization — a service-role
 * insert here would bypass ownership and leak across users.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const items = projectItemsSchema.safeParse(body?.items ?? []);
  if (!items.success) {
    return NextResponse.json(
      { error: "invalid items", detail: items.error.issues },
      { status: 422 },
    );
  }

  const id = crypto.randomUUID().slice(0, 12);
  const { error } = await supabase.from("projects").insert({
    id,
    user_id: user.id,
    title: typeof body?.title === "string" ? body.title : null,
    items: items.data,
  });
  if (error) return NextResponse.json({ error: "create failed" }, { status: 500 });

  // 4C / G2: propagate user brand to the new project so it starts branded. Shared
  // with import + claim so every creation path brands identically (00 → J1/G2).
  await applyUserBrandToProject(supabase, user.id, id);

  // A-8.5: stamp the owner's auth.uid — project_create is a funnel/trial event and
  // the user is proven here (401'd above otherwise), so it must carry user_id.
  await recordUse(req, { report_id: "", reach: [], action: "project_create" }, user.id);
  return NextResponse.json({ id });
}
