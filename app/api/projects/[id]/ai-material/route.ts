import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { EmailDocSchema } from "@/lib/email/doc/schema";
import { seedById } from "@/lib/email/doc/default-docs";
import { inferScopeFromItems } from "@/lib/project/derive-name";
import type { ProjectItem } from "@/lib/project/items";
import { pickSeedId } from "./pick-seed";

export const runtime = "nodejs";
export const maxDuration = 30;

const EMPTY_NARRATIVE = { exec_summary: "", sections: [], inference_notes: [] };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const db = createClient(await cookies());
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Ownership check (RLS ensures this user owns the project). NOTE: the projects table
  // has NO scope_kind/scope_value columns — selecting them made this route 404 on EVERY
  // call (the lookup errored → null → "not found"), so the intent build never worked.
  const { data: project } = await db.from("projects").select("id, items").eq("id", id).single();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Scope is DERIVED from the project's items (same as the email-lab page / project page),
  // then mapped to the AI fill's {kind,value}. A scope-less project fills region-wide.
  const items: ProjectItem[] = Array.isArray(project.items) ? project.items : [];
  const inferred = inferScopeFromItems(items);
  const scope = inferred.zip
    ? { kind: "zip" as const, value: inferred.zip }
    : inferred.place
      ? { kind: "place" as const, value: inferred.place }
      : { kind: undefined, value: undefined };

  const { intent } = await req.json().catch(() => ({ intent: "" }));
  const seed = seedById(pickSeedId(intent ?? ""))!; // pickSeedId always returns a valid id
  const seededDoc = seed.build();

  // Try to fill with lake data. Never a dead end: if AI can't fill, fall back to the seeded doc.
  let finalDoc = seededDoc;
  const aiRes = await fetch(`${req.nextUrl.origin}/api/email-lab/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      doc: seededDoc,
      scope,
      prompt: intent || "Fill this template with the latest data for this project.",
    }),
  }).catch(() => null);

  if (aiRes?.ok) {
    const result = await aiRes.json().catch(() => null);
    if (result?.applied === true) {
      const validated = EmailDocSchema.safeParse(result.doc);
      if (validated.success) finalDoc = validated.data;
    }
  }

  const newId = crypto.randomUUID();
  const admin = createServiceRoleClient();
  const { error } = await admin.from("deliverables").insert({
    id: newId,
    project_id: id,
    user_id: user.id,
    template: "block-canvas",
    doc: finalDoc,
    data_as_of: new Date().toISOString(),
    narrative: EMPTY_NARRATIVE,
    items_snapshot: [],
    status: "ready",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { id: newId, template: { id: seed.id, name: seed.name } },
    { status: 201 },
  );
}
