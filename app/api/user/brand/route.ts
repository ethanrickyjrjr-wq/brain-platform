import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { logActivity } from "@/lib/project/activity";
import { sanitizePalettes } from "@/lib/brand/palette";

export const runtime = "nodejs";

const AGENT_FIELDS = ["agent_name", "photo_url", "license", "brokerage"] as const;
type AgentField = (typeof AGENT_FIELDS)[number];

// Theme fields persisted at the account level so saved colors carry to NEW
// projects (pre-fill). primary_color/accent_color also feed legacy consumers
// (resolve-brand.ts). logo_url rides along when present.
const COLOR_FIELDS = ["primary_color", "accent_color", "logo_url"] as const;
type ColorField = (typeof COLOR_FIELDS)[number];

// Social + unsubscribe URLs persisted at the account level (like colors) so they
// carry to NEW projects. Columns added by docs/sql/20260625_user_brand_socials.sql.
const SOCIAL_FIELDS = [
  "instagram_url",
  "facebook_url",
  "linkedin_url",
  "x_url",
  "tiktok_url",
  "youtube_url",
  "pinterest_url",
  "threads_url",
  "unsubscribe_url",
] as const;
type SocialField = (typeof SOCIAL_FIELDS)[number];

const BASE_SELECT =
  "agent_name, photo_url, license, brokerage, primary_color, accent_color, logo_url, " +
  SOCIAL_FIELDS.join(", ");

async function authed() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * GET /api/user/brand — returns the signed-in user's brand profile, including
 * the saved color-palette library. Used to pre-fill BrandingBlock when a
 * project has no branding yet (funnel arrivals + new projects land here).
 *
 * Degrades if the `color_palettes` column hasn't been migrated yet: retries
 * the select without it so the route never 500s pre-migration.
 */
export async function GET(_req: NextRequest) {
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let { data } = await supabase
    .from("user_brand_profiles")
    .select(`${BASE_SELECT}, color_palettes`)
    .eq("user_id", user.id)
    .maybeSingle();

  // Column missing (pre-migration) → the select above errors and data is null;
  // fall back to the base columns so the rest of the profile still loads.
  if (!data) {
    ({ data } = await supabase
      .from("user_brand_profiles")
      .select(BASE_SELECT)
      .eq("user_id", user.id)
      .maybeSingle());
  }

  const profile = data ?? {};
  return NextResponse.json({
    ...profile,
    color_palettes: sanitizePalettes((profile as Record<string, unknown>).color_palettes),
  });
}

/**
 * PATCH /api/user/brand — upserts the user's account-level brand default:
 * agent identity fields, theme colors (so they seed new projects), and the
 * saved color-palette library.
 *
 * The `color_palettes` write is best-effort + isolated: if that column hasn't
 * been migrated, the agent/color upsert still succeeds and only the library
 * write is skipped.
 */
export async function PATCH(req: NextRequest) {
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of AGENT_FIELDS) {
    if (key in body) {
      const v = body[key as AgentField];
      update[key] = typeof v === "string" && v.trim() ? v : null;
    }
  }
  for (const key of COLOR_FIELDS) {
    if (key in body) {
      const v = body[key as ColorField];
      update[key] = typeof v === "string" && v.trim() ? v : null;
    }
  }
  for (const key of SOCIAL_FIELDS) {
    if (key in body) {
      const v = body[key as SocialField];
      update[key] = typeof v === "string" && v.trim() ? v : null;
    }
  }

  const { error } = await supabase
    .from("user_brand_profiles")
    .upsert({ user_id: user.id, ...update }, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: "update failed" }, { status: 500 });

  // Palette library — isolated so a missing column (pre-migration) doesn't fail
  // the whole save. Validated/clamped server-side before it lands.
  if ("color_palettes" in body) {
    const palettes = sanitizePalettes(body.color_palettes);
    const { error: palErr } = await supabase
      .from("user_brand_profiles")
      .update({ color_palettes: palettes })
      .eq("user_id", user.id);
    if (palErr) {
      console.warn("[user/brand] color_palettes write skipped:", palErr.message);
    }
  }

  // If the client passes a project_id, log branding_changed for that project so the AI
  // knows the agent identity updated. Global-only saves (no project_id) don't log here —
  // per-project branding is live-read from projects.branding on every context build.
  const projectId = typeof body?.project_id === "string" ? body.project_id : null;
  if (projectId) {
    const agentName = typeof update.agent_name === "string" ? update.agent_name : null;
    const brokerage = typeof update.brokerage === "string" ? update.brokerage : null;
    await logActivity(supabase, {
      projectId,
      type: "branding_changed",
      actor: "user",
      summary: [
        "Branding updated",
        agentName ? `agent: ${agentName}` : null,
        brokerage ? `brokerage: ${brokerage}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      detail: { agent_name: agentName, brokerage },
    });
  }

  return NextResponse.json({ ok: true });
}
