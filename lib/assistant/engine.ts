// THE one assistant engine. One contract in, one SSE Response out. It dispatches to
// the report-grounding path (a /r/* surface) or the conversation path (PROJECT AI /
// OUTSIDE AI / public funnel). This is the single seam later phases extend: Phase 2
// makes the report path degrade-never-throw; Phase 3 lifts charts + highlighter onto
// both paths. Fix the AI's behavior anywhere → you fix it here, once.
import { type AssistantRequest, isReportRequest } from "@/lib/assistant/contract";
import { runReportPath } from "@/lib/assistant/report-path";
import { runConversationPath } from "@/lib/assistant/conversation-path";

export function handleAssistant(request: Request, req: AssistantRequest): Promise<Response> {
  return isReportRequest(req) ? runReportPath(request, req) : runConversationPath(request, req);
}
