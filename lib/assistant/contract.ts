// THE one request shape for POST /api/assistant — the single contract both
// presentations (the report dock and the conversation panel) speak. The engine
// dispatches on it. Phase 1 of the one-assistant unification; see
// docs/superpowers/specs/2026-06-21-one-assistant-unification-RECONCILED-SCOPE.md
//
// Naming is honest on purpose: PROJECT AI and OUTSIDE AI are two CONTEXTS of one
// assistant, not two bots. "public" is OUTSIDE AI's degenerate, no-auth state on
// the /welcome cold-lead landing page — the ONLY place the funnel voice is honest.

export type AssistantContext = "project" | "outside" | "public";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantRequest {
  /** Which assistant is talking. project = PROJECT AI (inside a project); outside =
   *  OUTSIDE AI (whole site); public = the /welcome cold-lead funnel (OUTSIDE AI, no auth). */
  context: AssistantContext;

  /** Multi-turn history; the report/dock path sends a single user turn. Last must be "user". */
  messages: AssistantMessage[];

  /** A /r/* report-grounding surface id: a bare brain slug, or kind-namespaced
   *  (zip:33931 | corridor:us-41-… | method:… | source:…). Its presence selects the
   *  report-grounding path (see isReportRequest). */
  report_id?: string;

  /** The open project's id (context=project) — drives the cross-project (TIER-B) read. */
  project_id?: string;

  /** Highlighted fact text (report/dock path). */
  fact?: string;

  /** Client-supplied situational context: where the user is. Untrusted; bounded + data-framed. */
  pageContext?: unknown;
  /** Digest of the user's briefcase. Untrusted; bounded + data-framed. */
  briefcase?: unknown;

  /** An ACTION within outside/project (not a context): condense the session into one filed item. */
  action?: "summarize";
  /** Q&A already filed this session (summarize dedup). */
  alreadyFiled?: { question?: string; answer?: string }[];

  // --- report/dock path extras (carried from the dock) ---
  /** Metric slug of the highlighted figure (popup path). */
  slug?: string;
  /** What was selected (popup | dock | email) — gates the follow-ups tail. */
  selection_type?: string;
  is_realtime?: boolean;
  from_chip?: boolean;
}

/** True when the request takes the report-grounding path (a /r/* surface), false for
 *  the conversation path. The single dispatch predicate the engine keys on. */
export function isReportRequest(req: Pick<AssistantRequest, "report_id">): boolean {
  return typeof req.report_id === "string" && req.report_id.length > 0;
}
