import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { projectItemsSchema } from "@/lib/project/items";
import { recordUse } from "@/lib/highlighter/meter";
import { applyUserBrandToProject } from "@/lib/project/apply-brand";
import { deriveProjectName } from "@/lib/project/derive-name";

export const runtime = "nodejs";

/**
 * POST /api/projects/import — migrate the anonymous localStorage draft
 * (`swfl_project_draft_v1`, a ProjectItem[]) into the user's first owned project.
 *
 * The draft has the SAME shape as projects.items, so this is a straight insert
 * (no transform). Cookie client only — RLS WITH CHECK binds the row to auth.uid().
 */
export async function POST(req: NextRequest) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const items = projectItemsSchema.safeParse(body?.items);
  if (!items.success) {
    return NextResponse.json(
      { error: "invalid items", detail: items.error.issues },
      { status: 422 },
    );
  }
  if (items.data.length === 0) {
    return NextResponse.json({ error: "nothing to import" }, { status: 400 });
  }

  // G/§G: auto-name from the items when the caller supplies no title, so a project
  // created from anywhere (briefcase draft, charts, /r/ answer) lands already named.
  const title =
    typeof body?.title === "string" && body.title.trim()
      ? body.title
      : deriveProjectName(items.data);

  const id = crypto.randomUUID().slice(0, 12);
  const { error } = await supabase.from("projects").insert({
    id,
    user_id: user.id,
    title,
    items: items.data,
  });
  if (error) return NextResponse.json({ error: "import failed" }, { status: 500 });

  // G2: branding follows EVERY creation path — a project imported from an anon
  // draft must start branded just like a direct create (00 → J1/G2).
  await applyUserBrandToProject(supabase, user.id, id);

  // A-8.5: stamp the owner's auth.uid — project_create is a funnel/trial event and
  // the user is proven here (401'd above otherwise), so it must carry user_id.
  await recordUse(req, { report_id: "", reach: [], action: "project_create" }, user.id);
  return NextResponse.json({ id });
}
