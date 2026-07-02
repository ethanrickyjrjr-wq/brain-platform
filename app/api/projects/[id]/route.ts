import type { Database } from "@/database.types";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { projectItemsSchema } from "@/lib/project/items";
import { isValidPropertyUrl } from "@/lib/listings/artifact-link";
import { markFeedSeen } from "@/lib/project/feed";
import { logActivity } from "@/lib/project/activity";

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

  // Snapshot title + item count before the update so activity summaries are accurate.
  const { data: before } = await supabase
    .from("projects")
    .select("title, items")
    .eq("id", id)
    .maybeSingle();
  const prevTitle: string | null = before?.title ?? null;
  const prevItemCount: number = Array.isArray(before?.items) ? before.items.length : 0;

  const update: Database["public"]["Tables"]["projects"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
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

  // Wave 1.5: the user's own listing-page URL — head of the artifact link chain
  // (property_url → feed listing_url → unlinked; lib/listings/artifact-link.ts).
  // Stored VERBATIM (trimmed); shape-validated only, no reachability probe.
  if ("property_url" in body) {
    if (body.property_url === null || body.property_url === "") {
      update.property_url = null;
    } else if (isValidPropertyUrl(body.property_url)) {
      update.property_url = (body.property_url as string).trim();
    } else {
      return NextResponse.json({ error: "invalid property_url" }, { status: 422 });
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

  // Activity log — fire-and-forget after successful write.
  if ("title" in body && typeof body.title === "string" && body.title !== prevTitle) {
    await logActivity(supabase, {
      projectId: id,
      type: "project_renamed",
      actor: "user",
      summary: `Project renamed to "${body.title}"`,
      detail: { from: prevTitle, to: body.title },
    });
  }
  if ("branding" in body && body.branding) {
    const b = body.branding as Record<string, unknown>;
    const agentName =
      typeof b.name === "string" ? b.name : typeof b.agent_name === "string" ? b.agent_name : null;
    const brokerage = typeof b.brokerage === "string" ? b.brokerage : null;
    await logActivity(supabase, {
      projectId: id,
      type: "branding_changed",
      actor: "user",
      summary: [
        "Branding updated",
        agentName ? `agent: ${agentName}` : null,
        brokerage ? `brokerage: ${brokerage}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      detail: { branding: b },
    });
  }
  if ("items" in body) {
    const newCount = Array.isArray(update.items) ? (update.items as unknown[]).length : 0;
    if (newCount > prevItemCount) {
      const added = newCount - prevItemCount;
      await logActivity(supabase, {
        projectId: id,
        type: "item_filed",
        actor: "user",
        summary: `${added} item${added === 1 ? "" : "s"} filed`,
        detail: { prev: prevItemCount, next: newCount },
      });
    }
  }

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
