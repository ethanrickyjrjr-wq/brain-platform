import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isSafeReturnPath } from "@/lib/safe-return";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next");
  // Same-origin guard: a bare startsWith("/") lets `//evil.com` through, and
  // new URL("//evil.com", origin) escapes to evil.com (open redirect).
  const next = isSafeReturnPath(nextParam) ? nextParam : "/";

  if (code) {
    const supabase = createClient(await cookies());
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // 4D: if the user had a branded prospecting email, carry their brand forward
      const newUser = data.session?.user;
      if (newUser?.email) {
        const { data: sub } = await supabase
          .from("email_subscribers")
          .select("prospect_brand")
          .eq("email", newUser.email)
          .maybeSingle();
        if (sub?.prospect_brand) {
          const pb = sub.prospect_brand as Record<string, string | null>;
          await supabase.from("user_brand_profiles").upsert(
            {
              user_id: newUser.id,
              primary_color: pb.primary_color ?? null,
              accent_color: pb.accent_color ?? null,
              logo_url: pb.logo_url ?? null,
              source: "email_signup",
            },
            { onConflict: "user_id" },
          );
        }
      }
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(new URL("/auth/auth-code-error", url.origin));
}
