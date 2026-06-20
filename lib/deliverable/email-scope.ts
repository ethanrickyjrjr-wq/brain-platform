import { inferScopeFromItems } from "@/lib/project/derive-name";
import type { ProjectItem } from "@/lib/project/items";

/**
 * The scope to build an `"email"` deliverable with, derived from the project's own items.
 *
 * An email is ZIP-only: `buildEmailDeliverableModel` calls `resolveReportZip`, which
 * rejects place/county scopes — without a ZIP it renders empty. So we ground the email on
 * the project's inferred ZIP (the SAME `inferScopeFromItems` root the digest uses). When
 * the project names no ZIP, return `null` so the caller can ask the user for one instead
 * of silently building an empty email. Pure — no I/O.
 */
export function emailDeliverableScope(
  items: ProjectItem[],
): { scope_kind: "zip"; scope_value: string } | null {
  const zip = inferScopeFromItems(items).zip;
  return zip ? { scope_kind: "zip", scope_value: zip } : null;
}
