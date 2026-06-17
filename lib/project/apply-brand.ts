import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveUserBrand } from "@/lib/email/templates/resolve-brand";

/**
 * Copy the user's saved brand profile onto a freshly-created project so it starts
 * branded — REGARDLESS of creation path (direct create, draft import, MCP claim).
 *
 * "Branding follows EVERY project" is a hard Piece-1 requirement (FINAL BOSS
 * 00 → J1/G2, 01 §G): a filled brand must auto-apply, or projects made from
 * outside the workspace arrive unbranded — the most common path silently breaks
 * the "already lined up" promise. Routing all three creation routes through this
 * ONE helper guarantees they brand identically.
 *
 * Best-effort + never throws — branding is a presentation nicety, never a gate on
 * project birth. The `resolve` dependency is injectable for tests.
 */
export async function applyUserBrandToProject(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  resolve: typeof resolveUserBrand = resolveUserBrand,
): Promise<void> {
  try {
    const brand = await resolve(supabase, userId);
    if (!brand) return;
    await supabase
      .from("projects")
      .update({
        branding: {
          primary_color: brand.primary,
          accent_color: brand.accent,
          logo_url: brand.logoUrl,
        },
      })
      .eq("id", projectId);
  } catch {
    /* best-effort — a brand-copy failure must never fail project creation */
  }
}
