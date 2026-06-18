/**
 * lib/deliverable/resolve-refresh-items.ts — FINAL BOSS Piece 4.
 *
 * The DB glue over the pure `refreshItemSet`. `supabase` is the caller's COOKIE (RLS)
 * client: it loads the project only if the caller owns it. The route always proves
 * deliverable ownership first; deriving items from the owner-scoped project (never the
 * request body) is what keeps refresh/edit from injecting a foreign file path (IDOR)
 * or a fabricated metric value (no-invention moat).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { projectItemsSchema, type ProjectItem } from "../project/items";
import { refreshItemSet } from "./refresh-items";

/** Load + validate the OWNER's project items (cookie RLS). [] if the project is gone
 *  or its items fail validation — callers fall back so a refresh/edit never hard-fails. */
export async function loadOwnedProjectItems(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectItem[]> {
  const { data: project } = await supabase
    .from("projects")
    .select("items")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return [];
  const parsed = projectItemsSchema.safeParse((project as { items: unknown }).items ?? []);
  return parsed.success ? parsed.data : [];
}

/** Resolve the item set for a refresh (or a no-items content edit): the project's
 *  CURRENT items restricted to the deliverable's snapshot (frame binding params
 *  intact), falling back to the frozen snapshot when the project no longer holds them. */
export async function resolveRefreshItems(
  supabase: SupabaseClient,
  projectId: string,
  itemsSnapshot: unknown,
): Promise<unknown> {
  const snapshot = Array.isArray(itemsSnapshot) ? (itemsSnapshot as { id: string }[]) : [];
  const projectItems = await loadOwnedProjectItems(supabase, projectId);
  const refreshed = refreshItemSet(projectItems, snapshot);
  return refreshed.length > 0 ? refreshed : itemsSnapshot;
}
