// DEPRECATED ALIAS — the Ask-AI dock's legacy endpoint. The one assistant engine lives
// at POST /api/assistant now; this shim translates the dock's single-turn body into the
// assistant contract and forwards to the report-grounding path. It exists only so no
// caller 404s mid-switch; delete it once the dock client points at /api/assistant
// (unification Phase 1C / 3). There is no "converse" engine anymore — only the one engine.
import { runReportPath } from "@/lib/assistant/report-path";
import type { AssistantRequest } from "@/lib/assistant/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: {
    report_id?: string;
    fact?: string;
    slug?: string;
    selection_type?: string;
    is_realtime?: boolean;
    from_chip?: boolean;
    question?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const req: AssistantRequest = {
    context: "outside",
    report_id: body.report_id,
    fact: body.fact,
    slug: body.slug,
    selection_type: body.selection_type,
    is_realtime: body.is_realtime,
    from_chip: body.from_chip,
    // The dock's single question becomes the one user turn; missing → [] so the report
    // path returns the same "question required" 400 the old route did.
    messages: typeof body.question === "string" ? [{ role: "user", content: body.question }] : [],
  };
  return runReportPath(request, req);
}
