import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { projectItemsSchema } from "@/lib/project/items";
import { markFeedSeen } from "@/lib/project/feed";

export const runtime = "nodejs";

/**
 * GET/PATCH/DELETE /api/projects/[id].
 *
 * CRITICAL: all via the COOKIE client so RLS scopes every operation to the
 * owner (auth.uid() = user_id). Requesting another user's project returns 404
 * because RLS makes the row invisible — never service-role here.
 */

async function authed() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "read failed" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("items" in body) {
    const items = projectItemsSchema.safeParse(body.items);
    if (!items.success) {
      return NextResponse.json(
        { error: "invalid items", detail: items.error.issues },
        { status: 422 },
      );
    }
    update.items = items.data;
  }
  if ("title" in body) update.title = typeof body.title === "string" ? body.title : null;
  if ("branding" in body) update.branding = body.branding ?? null;
  // Piece 1: per-project UI/agent state bag (collapse, mcp dismiss count, …).
  // Object-only; additive keys are merged client-side then PATCHed whole.
  if ("ui_state" in body) {
    if (body.ui_state && typeof body.ui_state === "object" && !Array.isArray(body.ui_state)) {
      update.ui_state = body.ui_state;
    } else {
      return NextResponse.json({ error: "invalid ui_state" }, { status: 422 });
    }
  }

  // Piece 3: when the user dismisses a feed-derived prompt, mark those `project_feed`
  // rows seen so they stop surfacing — mirrors the cross-project dismiss (which persists
  // `ui_state.dismissed_overlap_keys` in the same PATCH). `markFeedSeen` is owner-scoped
  // by RLS and never throws; numeric ids only.
  if ("seen_feed_ids" in body) {
    const ids = Array.isArray(body.seen_feed_ids)
      ? body.seen_feed_ids.filter((n: unknown): n is number => typeof n === "number")
      : [];
    if (ids.length > 0) await markFeedSeen(ids);
  }

  // RLS scopes the UPDATE to the owner; a non-owner id matches zero rows.
  const { data, error } = await supabase
    .from("projects")
    .update(update)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "update failed" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "delete failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
