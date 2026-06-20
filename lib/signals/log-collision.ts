import type { SupabaseClient } from "@supabase/supabase-js";
import type { SignificantChange } from "./types";

export interface CollisionRowArgs {
  projectId: string;
  change: SignificantChange;
  scopeKind?: string;
  scopeValue?: string;
  userAction: "confirmed" | "dismissed" | "ignored";
  gateReason?: string;
}

/** Pure: shape the evidence row (mirrors lib/email/data-readiness.ts insert columns). */
export function buildCollisionRow(a: CollisionRowArgs): Record<string, unknown> {
  return {
    project_id: a.projectId,
    metric_slug: a.change.slug,
    metric_label: a.change.label,
    scope_kind: a.scopeKind ?? null,
    scope_value: a.scopeValue ?? null,
    tier_used: "brain_fresh",
    value_used: a.change.current_value,
    snapshot_value: a.change.previous_value,
    within_tolerance: null,
    surface: "in_project",
    user_action: a.userAction,
    gate_reason: a.gateReason ?? null,
  };
}

/** Insert the evidence row (service-role client; RLS-gated table). */
export async function logCollision(
  supabase: SupabaseClient,
  args: CollisionRowArgs,
): Promise<void> {
  const { error } = await supabase.from("data_readiness_alerts").insert(buildCollisionRow(args));
  if (error) console.error("[log-collision] insert error:", error.message);
}
