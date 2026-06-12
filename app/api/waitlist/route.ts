import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceRoleClient } from "@/utils/supabase/service-role";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_INTERESTS = 10;
const MAX_INTEREST_LEN = 64;

/**
 * Lazy Resend client — instantiated on first request, not at module load.
 *
 * Why: Resend's constructor throws `MissingAPIKeyError` when invoked with an
 * undefined API key. Next.js evaluates route modules at build time to
 * collect page data, and Vercel's build environment does not expose runtime
 * env vars to that pass — so a module-scope `new Resend(...)` crashes the
 * build even though RESEND_API_KEY is correctly set for the running app.
 * Defer the construction and the build stays green.
 */
let _resend: Resend | null = null;
function getResend(): Resend {
  if (_resend == null) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

function sanitizeInterests(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v.length <= MAX_INTEREST_LEN)
    .slice(0, MAX_INTERESTS);
}

export async function POST(request: Request) {
  let payload: { email?: unknown; interests?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const interests = sanitizeInterests(payload.interests);

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("waitlist").insert({ email, source: "landing", interests });

  if (error && error.code !== "23505") {
    // 23505 = unique_violation — treat duplicate as success
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  const alreadySubscribed = !!error; // error is only set here for 23505

  // Only send confirmation on first signup, not duplicates
  if (!alreadySubscribed) {
    const emailResult = await getResend().emails.send({
      from: "SWFL Data Gulf <hello@swfldatagulf.com>",
      to: email,
      subject: "You're on the list",
      text: `Hey — you're in.\n\nWe'll reach out when SWFL Data Gulf is ready. No spam, no fluff.\n\n— The SWFL Data Gulf team`,
    });
    if (emailResult.error) {
      console.error("[waitlist] Resend error (user still added to list):", emailResult.error);
    }
  }

  return NextResponse.json({
    ok: true,
    ...(alreadySubscribed && { already_subscribed: true }),
  });
}
