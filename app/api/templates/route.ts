import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { projectItemsSchema } from "@/lib/project/items";
import { extractRecipes, type ProjectTemplate } from "@/lib/deliverable/project-template";

export const runtime = "nodejs";

/**
 * GET /api/templates — list the signed-in user's saved templates.
 *
 * Returns `{ templates: ProjectTemplate[] }`. RLS on `project_templates`
 * filters to the requesting user's rows automatically.
 */
export async function GET() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("project_templates")
    .select("id, name, recipes, scope_type, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "read failed" }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

/**
 * POST /api/templates — save a new template.
 *
 * Accepts:
 *   { name: string; items: ProjectItem[]; scope_type?: string; id?: string }
 *
 * Extracts frame recipes from `items` (non-frame items are dropped — they are
 * snapshot-specific and cannot be re-bound for a new scope). Returns `{ id }`.
 *
 * CRITICAL: uses the COOKIE client (RLS-enforced). The RLS WITH CHECK
 * (auth.uid() = user_id) is the authorization gate — never bypass with service role.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const name =
    typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim() : null;
  if (!name) return NextResponse.json({ error: "name required" }, { status: 422 });

  const parsedItems = projectItemsSchema.safeParse(body.items ?? []);
  if (!parsedItems.success) {
    return NextResponse.json({ error: "invalid items" }, { status: 422 });
  }

  const recipes = extractRecipes(parsedItems.data);
  if (recipes.length === 0) {
    return NextResponse.json(
      { error: "no frame items — templates require at least one frame recipe" },
      { status: 422 },
    );
  }

  const scopeType =
    body.scope_type === "zip" ||
    body.scope_type === "corridor" ||
    body.scope_type === "county" ||
    body.scope_type === "region"
      ? (body.scope_type as ProjectTemplate["scope_type"])
      : undefined;

  const id =
    typeof body.id === "string" && body.id.length > 0 ? body.id : crypto.randomUUID().slice(0, 12);

  const { error } = await supabase.from("project_templates").insert({
    id,
    user_id: user.id,
    name,
    recipes,
    scope_type: scopeType ?? null,
  });
  if (error) return NextResponse.json({ error: "save failed" }, { status: 500 });

  return NextResponse.json({ id });
}
