import { NextResponse, type NextRequest } from "next/server";
import { lintChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { recordUse } from "@/lib/highlighter/meter";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.block) return NextResponse.json({ error: "no block" }, { status: 400 });

  const lint = lintChartBlock(body.block);
  if (!lint.ok) {
    return NextResponse.json({ error: "invalid chart", detail: lint.errors }, { status: 422 });
  }

  const id = crypto.randomUUID().slice(0, 8);
  const db = createServiceRoleClient();
  const { error } = await db.from("saved_charts").insert({
    id,
    chart_block: body.block,
    source_meta: body.source_meta ?? null,
    freshness_token: body.freshness_token ?? null,
  });
  if (error) return NextResponse.json({ error: "save failed" }, { status: 500 });

  await recordUse(req, {
    report_id: (body.source_meta as { report_id?: string } | null)?.report_id ?? "",
    reach: [],
    action: "chart_save",
  });

  return NextResponse.json({ id });
}
