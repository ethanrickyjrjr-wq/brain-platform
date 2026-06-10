import { NextResponse, type NextRequest } from "next/server";
import { recordUse } from "@/lib/highlighter/meter";

const ALLOWED = new Set([
  "ask",
  "chart_save",
  "project_create",
  "item_add",
  "draft_import_failed",
  "build",
  "export_print",
  "deliver_email",
  "deliver_share",
  "upload",
]);

export async function POST(req: NextRequest) {
  let body: { action?: string; report_id?: string; reach?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const action = body.action ?? "";
  if (!ALLOWED.has(action)) return NextResponse.json({ ok: false }, { status: 400 });
  await recordUse(req, {
    report_id: body.report_id ?? "",
    reach: Array.isArray(body.reach) ? body.reach : [],
    action,
  });
  return NextResponse.json({ ok: true });
}
