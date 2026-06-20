/**
 * GET /api/email/contacts/google/callback
 *
 * Google redirects here with `code` + `state`. We verify `state` against the
 * httpOnly cookie set by /start, exchange the code for an access token
 * (server-side), read the user's contacts via the People API, apply the
 * work-email filter, and upsert into email_contacts through the shared core.
 * The token is never stored. On every outcome we redirect back to
 * /contacts/upload with a status query so the UI can render a banner.
 */
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { exchangeCodeForToken, fetchAllConnections, googleRedirectUri } from "@/lib/email/google-oauth";
import { peopleConnectionsToContactRows } from "@/lib/email/google-people";
import { partitionContacts } from "@/lib/email/work-email-filter";
import { upsertContacts } from "@/lib/email/upsert-contacts";
import { OAUTH_STATE_COOKIE } from "../start/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/contacts/upload", req.url));
  }

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/contacts/upload?google_error=${reason}`, req.url));

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return finish(fail("denied"));

  const code = params.get("code");
  const stateParam = params.get("state");
  const [cookieState, workOnlyFlag] = (cookieStore.get(OAUTH_STATE_COOKIE)?.value ?? "").split(".");

  // CSRF: the echoed state must match the one we stashed (constant work — fine here).
  if (!code || !stateParam || !cookieState || stateParam !== cookieState) {
    return finish(fail("state"));
  }
  const workOnly = workOnlyFlag === "1";

  let rows;
  try {
    const token = await exchangeCodeForToken({ code, redirectUri: googleRedirectUri(req.url) });
    const connections = await fetchAllConnections(token);
    rows = peopleConnectionsToContactRows(connections, ["google"]);
  } catch {
    return finish(fail("fetch"));
  }

  const { kept, skippedPersonal } = partitionContacts(rows, { workOnly });
  const result = await upsertContacts(supabase, user.id, kept);

  const imported = result.inserted + result.updated;
  const url = new URL("/contacts/upload", req.url);
  url.searchParams.set("source", "google");
  url.searchParams.set("imported", String(imported));
  url.searchParams.set("skipped", String(result.skipped));
  url.searchParams.set("personal", String(skippedPersonal));
  return finish(NextResponse.redirect(url));
}

/** Drop the single-use state cookie on the way out, whatever the outcome. */
function finish(res: NextResponse): NextResponse {
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}
