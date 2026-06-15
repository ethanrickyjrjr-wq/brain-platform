import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { projectItemsSchema } from "@/lib/project/items";
import { recordUse } from "@/lib/highlighter/meter";
import {
  consumeClaimToken,
  fetchRawClaimItems,
  attachProjectId,
  deterministicProjectId,
} from "@/lib/claim/claim-store";

export const runtime = "nodejs";

/**
 * POST /api/claim { token } — turn a valid carry-back token + a logged-in user
 * into an owned project (Plan B). Runs ONLY when already authenticated: the OTP
 * login happened in a prior request and bounced back to /claim. We NEVER
 * exchangeCodeForSession here.
 *
 * Race-proofing (load-bearing): the project id is DETERMINISTIC from the token, so
 * two simultaneous claims compute the same PK → the insert is idempotent (PK
 * conflict = no-op) and both responses carry the same id. The loser computes the id
 * directly (step 2) — it NEVER reads claim_tokens.project_id (that column is written
 * AFTER the winner's insert and a concurrent loser may read it null).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });

  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // (2) Deterministic id — winner AND loser navigate to this exact value.
  const id = deterministicProjectId(token);

  // (2.5) Pre-validate items BEFORE consuming — if schema parse fails the token stays
  //       unclaimed and the user gets a clean 422 they can retry or report. null means
  //       the token is already gone/consumed; the consume below handles that path.
  const rawItems = await fetchRawClaimItems(token);
  if (rawItems !== null && !projectItemsSchema.safeParse(rawItems).success) {
    return NextResponse.json({ error: "invalid items" }, { status: 422 });
  }

  // (3) The atomic UPDATE-guarded consume.
  const res = await consumeClaimToken(token);

  if (res.status === "expired" || res.status === "missing") {
    return NextResponse.json({ error: "claim_link_expired" }, { status: 410 });
  }

  if (res.status === "consumed") {
    // A loser (concurrent or sequential replay). The winner inserted — or is about
    // to insert — the row at this SAME deterministic id. Land there; do NOT read
    // row.project_id (may be null for a concurrent loser).
    return NextResponse.json({ id });
  }

  // res.status === "won" — items pre-validated above before consume.
  const items = projectItemsSchema.safeParse(res.items);
  if (!items.success) {
    // Unreachable: pre-validated and token is single-use so schema can't change.
    return NextResponse.json({ error: "invalid items" }, { status: 500 });
  }

  // Cookie client + RLS WITH CHECK binds the row to auth.uid() — the DATABASE is the
  // thing that binds it, never a hand-set user_id on a service-role write.
  const { error } = await supabase.from("projects").insert({
    id,
    user_id: user.id,
    title: res.title ?? null,
    items: items.data,
  });
  // 23505 = unique_violation: a racing winner already inserted this exact id →
  // idempotent success. Any other error is a real failure.
  if (error && (error as { code?: string }).code !== "23505") {
    return NextResponse.json({ error: "claim failed" }, { status: 500 });
  }

  await attachProjectId(token, id); // best-effort, winner-side observability/cleanup
  await recordUse(req, { report_id: id, reach: [], action: "claim" }, user.id);
  return NextResponse.json({ id });
}
