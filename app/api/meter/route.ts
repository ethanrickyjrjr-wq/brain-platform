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
  // A-8.5: no userId is stamped here. These client-fired actions are anonymous or,
  // for deliver_email/deliver_share, fire from the PUBLIC /p/[id] page under the
  // VIEWER's cookie — which is often NOT the deliverable owner. Attributing sends to
  // the viewer's auth.uid would be wrong. Correct owner-attribution (resolve
  // deliverables.user_id by the deliverable id) is a SEND-PAYWALL (Tier-2) follow-on,
  // out of Plan A; the usage_events.user_id column is laid so it's a later wiring, not
  // a refactor. BUILD attribution (the trial spine) is stamped server-side at its own
  // routes (web build route + MCP build tool), where the owner is proven.
  await recordUse(req, {
    report_id: body.report_id ?? "",
    reach: Array.isArray(body.reach) ? body.reach : [],
    action,
  });
  return NextResponse.json({ ok: true });
}
