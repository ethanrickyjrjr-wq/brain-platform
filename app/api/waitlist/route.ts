import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_INTERESTS = 10;
const MAX_INTEREST_LEN = 64;

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

  const email =
    typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const interests = sanitizeInterests(payload.interests);

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("waitlist")
    .insert({ email, source: "landing", interests });

  if (error && error.code !== "23505") {
    // 23505 = unique_violation — treat duplicate as success
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
