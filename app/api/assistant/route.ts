// POST /api/assistant — THE one assistant endpoint. New callers (the unified client)
// speak the AssistantRequest contract directly; the engine dispatches by context +
// report_id. The legacy /api/converse and /api/welcome/chat routes are thin deprecated
// forwarders into the same engine (deleted once their clients point here).
import { handleAssistant } from "@/lib/assistant/engine";
import type { AssistantRequest, AssistantContext } from "@/lib/assistant/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTEXTS: ReadonlySet<string> = new Set(["project", "outside", "public"]);

export async function POST(request: Request): Promise<Response> {
  let body: Partial<AssistantRequest> & { context?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  // Default to OUTSIDE AI when context is absent/unknown — the safe, whole-site voice.
  const context: AssistantContext =
    typeof body.context === "string" && CONTEXTS.has(body.context)
      ? (body.context as AssistantContext)
      : "outside";
  return handleAssistant(request, {
    ...body,
    context,
    messages: Array.isArray(body.messages) ? body.messages : [],
  });
}
