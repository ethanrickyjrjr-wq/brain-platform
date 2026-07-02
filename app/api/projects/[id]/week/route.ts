// app/api/projects/[id]/week/route.ts
//
// Cockpit D0 — generate the ready-for-you week server-side, at most once per
// week per project (regenerate on demand with force:true; a partial failure
// retries only the missing side). Promotion, not construction: the email goes
// through buildContentDoc (the lab's auto-fill root) and socials through
// buildWeek (Generate-Week's root). Docs persist as ordinary block-canvas
// deliverables (service-role insert — deliverables has no owner INSERT policy;
// ownership proven on projects first, the materials-route pattern). Docs are
// saved UNBRANDED — brand applies client-side on load, like calendar cards.
import type { Database } from "@/database.types";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { buildContentDoc, type BuildScope } from "@/lib/email/build-doc";
import { buildWeek } from "@/lib/email/social-calendar/build-week";
import { mondayOf } from "@/lib/email/social-calendar/week";
import { defaultDoc } from "@/lib/email/doc/default-docs";
import { EmailDocSchema } from "@/lib/email/doc/schema";
import { inferScopeFromItems } from "@/lib/project/derive-name";
import type { ProjectItem } from "@/lib/project/items";
import { recordUse } from "@/lib/highlighter/meter";
import {
  missingSides,
  weekIsCurrent,
  type ThisWeekSocial,
  type ThisWeekState,
} from "@/lib/project/this-week";

export const runtime = "nodejs";
export const maxDuration = 300;

const EMPTY_NARRATIVE = { exec_summary: "", sections: [], inference_notes: [] };

/** Insert one queue doc as a block-canvas material; returns its id or null. */
async function insertMaterial(
  admin: ReturnType<typeof createServiceRoleClient>,
  projectId: string,
  userId: string,
  doc: unknown,
  instruction: string | null,
): Promise<string | null> {
  const parsed = EmailDocSchema.safeParse(doc);
  if (!parsed.success) return null;
  const newId = crypto.randomUUID();
  const { error } = await admin.from("deliverables").insert({
    id: newId,
    project_id: projectId,
    user_id: userId,
    template: "block-canvas",
    doc: parsed.data,
    instruction,
    data_as_of: new Date().toISOString(),
    narrative: EMPTY_NARRATIVE,
    items_snapshot: [],
    status: "ready",
  });
  return error ? null : newId;
}

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

  // Ownership via owner-RLS'd projects select (materials-route pattern).
  const { data: project } = await db
    .from("projects")
    .select("id, items, ui_state")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  const monday = mondayOf(new Date());
  const uiState = (project.ui_state ?? {}) as Record<string, unknown> & {
    this_week?: ThisWeekState;
  };
  const existing =
    !body.force && weekIsCurrent(uiState.this_week, monday) ? uiState.this_week! : null;
  const missing = missingSides(existing);
  if (existing && !missing.email && !missing.social) {
    return NextResponse.json({ week: existing, cached: true });
  }

  const items: ProjectItem[] = Array.isArray(project.items) ? project.items : [];
  const inferred = inferScopeFromItems(items);
  const scope: BuildScope = inferred.zip
    ? { kind: "zip", value: inferred.zip }
    : inferred.place
      ? { kind: "place", value: inferred.place }
      : { kind: "region", value: "swfl" };
  const scopeLabel = inferred.place
    ? `${inferred.place}${inferred.zip ? ` ${inferred.zip}` : ""}`
    : (inferred.zip ?? "Southwest Florida");

  const admin = createServiceRoleClient();
  const week: ThisWeekState = existing ?? {
    week_of: monday,
    generated_at: new Date().toISOString(),
    email: null,
    social: [],
  };
  const errors: { email?: boolean; social?: boolean } = {};

  // ── Email side (the lab's auto-fill prompt, verbatim) ──────────────────────
  if (missing.email) {
    const prompt = `Market spotlight email for ${scopeLabel} — fill in realistic market context and agent copy`;
    try {
      const { payload } = await buildContentDoc({ prompt, rawDoc: defaultDoc(), scope });
      const did =
        payload.applied === false || !payload.doc
          ? null
          : await insertMaterial(admin, id, user.id, payload.doc, prompt);
      if (did) week.email = { did, state: "pending" };
      else errors.email = true;
    } catch {
      errors.email = true;
    }
  }

  // ── Social side (Generate-Week root) ───────────────────────────────────────
  if (missing.social) {
    try {
      const calendar = await buildWeek(scope, monday);
      const social: ThisWeekSocial[] = [];
      for (const post of calendar.posts) {
        const did = await insertMaterial(admin, id, user.id, post.card, null);
        if (did) {
          social.push({
            day: post.day,
            did,
            theme: post.theme,
            caption: post.caption,
            hashtags: post.hashtags,
            state: "pending",
          });
        }
      }
      if (social.length > 0) week.social = social;
      else errors.social = true;
    } catch {
      errors.social = true;
    }
  }

  week.errors = Object.keys(errors).length > 0 ? errors : undefined;
  week.generated_at = new Date().toISOString();

  // Persist the pointer bag (cookie client — owner RLS scopes the update).
  // Cast: ThisWeekState is plain JSON but lacks an index signature, so the
  // typed client's Json column type rejects it structurally.
  await db
    .from("projects")
    .update({
      ui_state: {
        ...uiState,
        this_week: week,
      } as unknown as Database["public"]["Tables"]["projects"]["Update"]["ui_state"],
    })
    .eq("id", id);

  // Verdict metric #2's anchor: the generated-week event (7-day return reads
  // project_open events after this one). recordUse never throws.
  if (week.email || week.social.length > 0) {
    await recordUse(
      req,
      { report_id: "", reach: [`project:${id}`], action: "week_generated" },
      user.id,
    );
  }

  return NextResponse.json({ week });
}
