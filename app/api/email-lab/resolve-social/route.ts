import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { domainFromUrl } from "@/lib/email/social/platforms";
import { logoUrlForDomain } from "@/lib/email/social/resolve-logo";

export const runtime = "nodejs";

/**
 * POST /api/email-lab/resolve-social — resolve a logo for a pasted "custom"
 * social URL and log the unknown domain.
 *
 * Body: { url: string }. Returns { domain, logoUrl }. Always 200 with a logoUrl
 * (Logo.dev when LOGODEV_API_KEY is set, else the keyless Google favicon); 400
 * only when the URL has no parseable host. Logging to brand_custom_socials is
 * best-effort (service-role write) and never blocks the response.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const url = body && typeof body.url === "string" ? body.url.trim() : "";
  const domain = domainFromUrl(url);
  if (!domain) return NextResponse.json({ error: "unparseable url" }, { status: 400 });

  const logoUrl = logoUrlForDomain(domain, process.env.LOGODEV_API_KEY);

  // Who pasted it (optional — the email lab is authed, but don't hard-require it).
  let userId: string | null = null;
  try {
    const supabase = createClient(await cookies());
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* unauth — still resolve, just don't attribute the log */
  }

  // Best-effort log of the unknown platform (drives future "promote to pre-baked").
  try {
    await createServiceRoleClient()
      .from("brand_custom_socials")
      .insert({ domain, url, user_id: userId, logo_url: logoUrl });
  } catch {
    /* logging is non-critical — the resolved logo is what the caller needs */
  }

  return NextResponse.json({ domain, logoUrl });
}
