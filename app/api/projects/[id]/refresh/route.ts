// POST /api/projects/[id]/refresh — refresh stale metric/qa item values from the
// current brain. Called on project open when significantChanges detected, or
// before an email blast (Phase 3C).
//
// Never fails the caller on a partial brain fetch — one stale brain value doesn't
// revert all items. Returns { refreshed, items } so the client can update local state.

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { projectItemsSchema, type ProjectItem } from "@/lib/project/items";
import { lookupLakeFact } from "@/lib/reconcile/lane1";
import { applyRefresh, refreshKey, type BrainValueMap } from "@/lib/project/refresh-on-access";
import { logActivity } from "@/lib/project/activity";
import { inferScopeFromItems } from "@/lib/project/derive-name";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Load project (RLS ensures ownership).
  const { data: project } = await supabase
    .from("projects")
    .select("id, items, ui_state")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = projectItemsSchema.safeParse(project.items ?? []);
  if (!parsed.success) return NextResponse.json({ error: "invalid items" }, { status: 500 });
  const items: ProjectItem[] = parsed.data;

  // Infer ZIP fallback from items (used when an item has no scope_value).
  const scope = inferScopeFromItems(items);
  const fallbackZip = scope.zip;

  // Batch-fetch current brain values for all metric + qa items.
  const brainValues: BrainValueMap = {};
  const cache = new Map<string, ReturnType<typeof lookupLakeFact>>();

  await Promise.all(
    items
      .filter((i) => i.kind === "metric" || i.kind === "qa")
      .map(async (item) => {
        if (item.kind !== "metric" && item.kind !== "qa") return;
        const slug = item.kind === "metric" ? (item.metric_slug ?? item.label) : item.question;
        const scopeVal = item.scope_value ?? fallbackZip;
        const key = refreshKey(item.report_id, slug, scopeVal);

        if (!cache.has(key)) {
          cache.set(key, lookupLakeFact(item.report_id, slug, scopeVal));
        }
        const fact = await cache.get(key)!.catch(() => null);
        if (!fact) return;

        brainValues[key] = {
          value: String(fact.value),
          freshness_token: String(fact.freshness_token ?? ""),
        };
      }),
  );

  const { items: refreshedItems, refreshed, summary } = applyRefresh(
    items,
    brainValues,
    (project.ui_state as { confirmed_values?: Record<string, string> } | null)?.confirmed_values,
  );

  if (refreshed > 0) {
    // Write updated items back — same JSONB patch pattern as the project PATCH route.
    const { error: writeErr } = await supabase
      .from("projects")
      .update({ items: refreshedItems, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (writeErr) {
      return NextResponse.json({ error: "write failed" }, { status: 500 });
    }

    // Fire-and-forget activity log.
    void logActivity(supabase, {
      projectId: id,
      type: "item_refreshed",
      actor: "system",
      summary,
      detail: { refreshed },
    });
  }

  return NextResponse.json({ refreshed, items: refreshedItems });
}
