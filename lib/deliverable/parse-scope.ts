/**
 * Parse + canonicalize a deliverable scope from untrusted input (web build body
 * or MCP tool args) into the shape `assembleDeliverable` persists.
 *
 * Shared by `/api/projects/[id]/build` and the MCP `swfl_project_build` tool so
 * both lanes apply the SAME contract (the email_schedules scope contract, verbatim):
 *   - `scope_kind ∈ {zip, place, county}` — anything else → no scope.
 *   - `scope_value` is canonical **lowercase + trimmed** ("canonical form IS the
 *     contract"). A ZIP is already lowercase; a place/county is normalized here.
 *   - A kind with no value is meaningless → drop both. Omitted scope → `{}` →
 *     `assembleDeliverable` writes NULL/NULL (correct for non-email templates).
 */

const SCOPE_KINDS = new Set(["zip", "place", "county"]);

export interface DeliverableScope {
  scope_kind?: string;
  scope_value?: string;
}

export function parseDeliverableScope(
  kind: string | undefined,
  value: string | undefined,
): DeliverableScope {
  if (typeof kind !== "string" || !SCOPE_KINDS.has(kind)) return {};
  const canonical = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!canonical) return {};
  return { scope_kind: kind, scope_value: canonical };
}
