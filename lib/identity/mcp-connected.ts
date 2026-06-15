import { createServiceRoleClient } from "@/utils/supabase/service-role";

/**
 * `isMcpConnected(authUid)` — the single DERIVE function behind A's rung-2 send
 * discount (and any future MCP-connected logic). Locked identity decision: there
 * is ONE identity (`auth.uid` == the `<uid>` in `mcp:<uid>` == `projects.user_id`)
 * and "MCP-connected" is DERIVED, never persisted. There is deliberately NO
 * `mcp_account_links` binding table.
 *
 * Returns true iff BOTH hold for `authUid`:
 *  1. the account owns a `projects` row with a non-null `mcp_key` (they wired the
 *     MCP), AND
 *  2. a `usage_events` row exists with `client_id = "mcp:<authUid>"` (they actually
 *     built/added via MCP — these rows already come from the swfl_project_* tools).
 *
 * INTENTIONAL BLIND SPOT: pure `swfl_fetch` READERS leave no server-side trace —
 * the read path is unmetered and Plan B does not touch it. A user who only ever
 * READ via MCP and never built derives `false`. That is correct: the discount
 * rewards builders, not anonymous readers. Do NOT add a read-path emit to make
 * readers detectable — it would violate the "swfl_fetch untouched" invariant for
 * no product reason.
 */
export async function isMcpConnected(authUid: string): Promise<boolean> {
  if (!authUid) return false;
  const db = createServiceRoleClient();

  // (1) Owns a project with a wired MCP key?
  const { count: keyedProjects } = await db
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("user_id", authUid)
    .not("mcp_key", "is", null);
  if (!keyedProjects) return false;

  // (2) Has actually built/added via MCP (an `mcp:<uid>` usage event)?
  const { count: mcpEvents } = await db
    .from("usage_events")
    .select("client_id", { count: "exact", head: true })
    .eq("client_id", `mcp:${authUid}`);
  return (mcpEvents ?? 0) > 0;
}
