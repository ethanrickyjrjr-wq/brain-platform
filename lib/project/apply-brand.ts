import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveUserBrand } from "@/lib/email/templates/resolve-brand";

type AgentBrand = {
  agent_name: string | null;
  photo_url: string | null;
  license: string | null;
  brokerage: string | null;
};

async function defaultAgentLookup(
  supabase: SupabaseClient,
  userId: string,
): Promise<AgentBrand | null> {
  const { data } = await supabase
    .from("user_brand_profiles")
    .select("agent_name, photo_url, license, brokerage")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as AgentBrand | null) ?? null;
}

/**
 * Copy the user's saved brand profile onto a freshly-created project so it starts
 * branded — REGARDLESS of creation path (direct create, draft import, MCP claim).
 *
 * Writes both theme fields (primary_color, accent_color, logo_url from user_brand_profiles
 * via resolveUserBrand) AND agent identity fields (agent_name, photo_url, license,
 * brokerage). The agentLookup param is injectable for tests.
 *
 * Best-effort + never throws — branding is a presentation nicety, never a gate on
 * project birth.
 */
export async function applyUserBrandToProject(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  resolve: typeof resolveUserBrand = resolveUserBrand,
  agentLookup: (
    supabase: SupabaseClient,
    userId: string,
  ) => Promise<AgentBrand | null> = defaultAgentLookup,
): Promise<void> {
  try {
    const brand = await resolve(supabase, userId).catch(() => null);
    const agent = await agentLookup(supabase, userId).catch(() => null);

    const branding: Record<string, string> = {};

    if (brand?.primary) branding.primary_color = brand.primary;
    if (brand?.accent) branding.accent_color = brand.accent;
    if (brand?.logoUrl) branding.logo_url = brand.logoUrl;
    if (agent?.agent_name) branding.agent_name = agent.agent_name;
    if (agent?.photo_url) branding.photo_url = agent.photo_url;
    if (agent?.license) branding.license = agent.license;
    if (agent?.brokerage) branding.brokerage = agent.brokerage;

    if (Object.keys(branding).length === 0) return;

    await supabase.from("projects").update({ branding }).eq("id", projectId);
  } catch {
    /* best-effort — a brand-copy failure must never fail project creation */
  }
}
