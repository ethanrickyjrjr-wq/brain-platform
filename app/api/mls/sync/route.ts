import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { NextResponse } from "next/server";
import { syncConnection, type Connection } from "@/lib/reso/sync";

// User-triggered sync
export async function POST(req: Request) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const serviceSupabase = createServiceRoleClient();
  const { connection_id } = (await req.json()) as { connection_id: string };
  const { data: conn, error } = await serviceSupabase
    .from("user_mls_connections")
    .select()
    .eq("id", connection_id)
    .eq("user_id", user.id)
    .single();
  if (error || !conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  try {
    const result = await syncConnection(serviceSupabase, conn as Connection);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    await serviceSupabase
      .from("user_mls_connections")
      .update({ status: "error", error_message: String(err) })
      .eq("id", conn.id);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Vercel cron fan-out
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const serviceSupabase = createServiceRoleClient();
  const { data: connections, error } = await serviceSupabase
    .from("user_mls_connections")
    .select()
    .eq("status", "active");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const conn of connections ?? []) {
    try {
      await syncConnection(serviceSupabase, conn as Connection);
      results.push({ id: conn.id, ok: true });
    } catch (err) {
      results.push({ id: conn.id, ok: false, error: String(err) });
      await serviceSupabase
        .from("user_mls_connections")
        .update({ status: "error", error_message: String(err) })
        .eq("id", conn.id);
    }
  }
  return NextResponse.json({ synced: results.length, results });
}
