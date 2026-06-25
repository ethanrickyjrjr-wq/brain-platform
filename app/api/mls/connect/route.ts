import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { NextResponse } from "next/server";
import { getBoardConfig, type BoardSlug } from "@/lib/reso/boards";
import { syncConnection } from "@/lib/reso/sync";

export async function POST(req: Request) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as { board_slug?: string; member_mls_id?: string };
  const { board_slug, member_mls_id } = body;
  if (!board_slug || !member_mls_id) {
    return NextResponse.json({ error: "board_slug and member_mls_id required" }, { status: 400 });
  }

  const config = getBoardConfig(board_slug as BoardSlug);
  const serviceSupabase = createServiceRoleClient();

  const { data: conn, error: connError } = await serviceSupabase
    .from("user_mls_connections")
    .upsert(
      {
        user_id: user.id,
        board_slug,
        member_mls_id,
        status: "pending",
        last_entity_event_sequence: null,
        error_message: null,
      },
      { onConflict: "user_id,board_slug", ignoreDuplicates: false },
    )
    .select()
    .single();

  if (connError || !conn) {
    return NextResponse.json(
      { error: connError?.message ?? "Failed to create connection" },
      { status: 500 },
    );
  }

  // Board not yet live — save the connection for when env vars land
  if (!config.live) {
    return NextResponse.json({ connection: conn, preview: null, queued: true });
  }

  try {
    const result = await syncConnection(serviceSupabase, {
      id: conn.id,
      user_id: user.id,
      board_slug: board_slug as BoardSlug,
      member_mls_id,
      last_entity_event_sequence: null,
    });
    return NextResponse.json({
      connection: conn,
      preview: { listing_count: result.listings, zips: result.zips },
    });
  } catch (err) {
    await serviceSupabase
      .from("user_mls_connections")
      .update({ status: "error", error_message: String(err) })
      .eq("id", conn.id);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
