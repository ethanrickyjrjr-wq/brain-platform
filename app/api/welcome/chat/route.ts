// DEPRECATED ALIAS — was the "welcome chat" funnel route. It is NOT a welcome chat: it's
// OUTSIDE AI / PROJECT AI's conversation path, which only wears the funnel voice in its
// public (no-auth /welcome) state. The one assistant engine lives at POST /api/assistant
// now; this shim maps the legacy {messages, mode, currentProjectId} body onto the
// assistant contract and forwards. Delete once its clients point at /api/assistant
// (unification Phase 1C / 3). Kept so no caller 404s mid-switch.
import { runConversationPath } from "@/lib/assistant/conversation-path";
import type { AssistantRequest, AssistantContext } from "@/lib/assistant/contract";

// Back-compat re-exports: the legacy name WELCOME_SYSTEM (= the honest PUBLIC_SYSTEM) and
// buildClientContextBlock are imported by app/api/welcome/chat/route.test.ts.
export {
  PUBLIC_SYSTEM as WELCOME_SYSTEM,
  buildClientContextBlock,
} from "@/lib/assistant/conversation-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: {
    messages?: { role?: string; content?: string }[];
    mode?: string;
    alreadyFiled?: { question?: string; answer?: string }[];
    pageContext?: unknown;
    briefcase?: unknown;
    currentProjectId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  // Legacy mode → honest context/action. analyst = OUTSIDE AI (or PROJECT AI when a
  // project is open); summarize = an action; everything else = the public funnel.
  const projectId = typeof body.currentProjectId === "string" ? body.currentProjectId : undefined;
  const context: AssistantContext =
    body.mode === "analyst" ? (projectId ? "project" : "outside") : "public";
  const action = body.mode === "summarize" ? ("summarize" as const) : undefined;
  const req: AssistantRequest = {
    context,
    action,
    messages: (Array.isArray(body.messages) ? body.messages : []) as AssistantRequest["messages"],
    project_id: projectId,
    alreadyFiled: body.alreadyFiled,
    pageContext: body.pageContext,
    briefcase: body.briefcase,
  };
  return runConversationPath(request, req);
}
