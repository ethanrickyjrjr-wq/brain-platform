import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { createClient } from "@/utils/supabase/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All columns from public.project_feed */
export interface FeedRow {
  id: number;
  user_id: string;
  project_id: string | null;
  kind: string;
  scope_kind: string | null;
  scope_value: string | null;
  title: string;
  detail: string | null;
  ref_url: string | null;
  payload: Record<string, unknown>;
  dedup_key: string;
  created_at: string;
  read_at: string | null;
  void_at: string | null;
}

/** Writable subset for writes — user_id, kind, title, dedup_key required; payload optional */
export interface FeedRowInput {
  user_id: string;
  project_id?: string | null;
  kind: string;
  scope_kind?: string | null;
  scope_value?: string | null;
  title: string;
  detail?: string | null;
  ref_url?: string | null;
  payload?: Record<string, unknown>;
  dedup_key: string;
}

/** A scope entry for late-binding scope-keyed rows. */
export interface ScopeEntry {
  scope_kind: string | null;
  scope_value: string | null;
}

// ---------------------------------------------------------------------------
// writeFeed — service-role writer, never throws (mirrors recordUseForClient)
// ---------------------------------------------------------------------------

/**
 * Write feed rows to project_feed with dedup enforcement.
 * Opens its OWN service-role client unless opts.client is injected (for tests).
 * Uses upsert with ignoreDuplicates:true (ON CONFLICT DO NOTHING).
 * Never throws — returns 0 on any error.
 */
export async function writeFeed(
  rows: FeedRowInput[],
  opts?: { client?: SupabaseClient },
): Promise<number> {
  if (rows.length === 0) return 0;
  try {
    const db = opts?.client ?? createServiceRoleClient();
    // Fill payload default
    const normalized = rows.map((r) => ({
      ...r,
      payload: r.payload ?? {},
    }));
    const { data } = await db
      .from("project_feed")
      .upsert(normalized, { onConflict: "dedup_key", ignoreDuplicates: true })
      .select("id");
    return data?.length ?? 0;
  } catch {
    return 0; // feed writes must never break a caller
  }
}

/**
 * Quote a value for use inside a PostgREST `.or()` filter. PostgREST treats
 * `, . : ( )` as reserved; a bare reserved char silently breaks the parse or
 * mis-matches. SWFL `scope_value`s (5-digit ZIPs, lowercase place names) are
 * reserved-char-free today, but the gazetteer could gain a "St. James City"
 * (period) or "Naples, FL" (comma) tomorrow — quote defensively (doubling any
 * embedded `"`) so the filter can't rot when the data does.
 * https://postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters
 */
function pgOrValue(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// readProjectFeed — cookie client (RLS enforces owner), never throws
// ---------------------------------------------------------------------------

/**
 * Read feed rows for a project: Bound rows (project_id = projectId) UNION
 * Tier-2 scope-matched rows (project_id IS NULL AND scope in scopeSet),
 * within the recency window, void_at IS NULL, unread first then created_at DESC.
 *
 * Uses the cookie client (RLS enforces owner) unless opts.client is injected.
 * Never throws — returns [] on any error.
 */
export async function readProjectFeed(
  projectId: string,
  scopeSet: ScopeEntry[],
  opts?: { windowDays?: number; client?: SupabaseClient },
): Promise<FeedRow[]> {
  try {
    const windowDays = opts?.windowDays ?? 14;
    const db = opts?.client ?? createClient(await cookies());

    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    // Build the OR filter for scope-matched rows.
    // Each entry: (project_id.is.null,scope_kind.eq.<k>,scope_value.eq.<v>)
    // For null scope_kind/scope_value we use .is.null syntax.
    // scope_value is wrapped via pgOrValue: PostgREST treats , . : ( ) as reserved
    // inside .or(), so a bare reserved char silently breaks the parse / mis-matches.
    // (scope_kind is a fixed enum {zip,place,county}; projectId is a server-minted
    // slug — neither can carry a reserved char, so only scope_value needs quoting.)
    const scopeFilters = scopeSet.map((s) => {
      const kindFilter =
        s.scope_kind === null ? "scope_kind.is.null" : `scope_kind.eq.${s.scope_kind}`;
      const valueFilter =
        s.scope_value === null
          ? "scope_value.is.null"
          : `scope_value.eq.${pgOrValue(s.scope_value)}`;
      return `and(project_id.is.null,${kindFilter},${valueFilter})`;
    });

    // Bound filter: project_id = projectId
    const boundFilter = `project_id.eq.${projectId}`;

    // Combine: bound OR any scope match
    const orParts = [boundFilter, ...scopeFilters];
    const orFilter = orParts.join(",");

    const { data, error } = await db
      .from("project_feed")
      .select("*")
      .or(orFilter)
      .gte("created_at", since)
      .is("void_at", null)
      .order("read_at", { ascending: false, nullsFirst: true }) // unread (null) first
      .order("created_at", { ascending: false });

    if (error) return [];
    return (data ?? []) as FeedRow[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// markFeedSeen — cookie client, never throws
// ---------------------------------------------------------------------------

/**
 * Set read_at = now() on the given feed row ids (where read_at IS NULL).
 * Returns the number of rows updated. Never throws.
 */
export async function markFeedSeen(
  feedIds: number[],
  opts?: { client?: SupabaseClient },
): Promise<number> {
  if (feedIds.length === 0) return 0;
  try {
    const db = opts?.client ?? createClient(await cookies());
    const { data } = await db
      .from("project_feed")
      .update({ read_at: new Date().toISOString() })
      .in("id", feedIds)
      .is("read_at", null)
      .select("id");
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// feedRowMatches — pure predicate, directly unit-testable without a DB
// ---------------------------------------------------------------------------

/**
 * Pure predicate: does a FeedRow surface for a given project + scope + window?
 *
 * Matches when:
 *   (Bound: row.project_id === projectId)
 *   OR (Scope-keyed: row.project_id IS NULL AND (scope_kind, scope_value) ∈ scopeSet)
 * AND within the recency window (created_at >= now - windowDays)
 * AND void_at IS NULL
 */
export function feedRowMatches(
  row: Pick<FeedRow, "project_id" | "scope_kind" | "scope_value" | "created_at" | "void_at">,
  opts: {
    projectId: string;
    scopeSet: ScopeEntry[];
    windowDays?: number;
    now?: Date;
  },
): boolean {
  const windowDays = opts.windowDays ?? 14;
  const now = opts.now ?? new Date();

  // void_at guard
  if (row.void_at !== null && row.void_at !== undefined) return false;

  // recency window
  const created = new Date(row.created_at);
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  if (created < cutoff) return false;

  // Bound match
  if (row.project_id === opts.projectId) return true;

  // Scope-keyed match: project_id null AND scope in set
  if (row.project_id === null || row.project_id === undefined) {
    for (const s of opts.scopeSet) {
      if (s.scope_kind === row.scope_kind && s.scope_value === row.scope_value) {
        return true;
      }
    }
  }

  return false;
}
