import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { issueProposalNonce, verifyProposalNonce } from "@/lib/email/proposal-nonce";
import { claimOnce } from "@/lib/email/idempotency";
import { createOrTouchSchedule, type ScheduleUpsertDb } from "@/lib/email/schedule-upsert";
import { assembleDeliverable, isTemplateId, DeliverableError } from "@/lib/deliverable/assemble";
import { emailDeliverableScope } from "@/lib/deliverable/email-scope";
import { computeNextRunAt } from "@/lib/email/schedule-cadence";
import type { ProjectItem } from "@/lib/project/items";

export const runtime = "nodejs";

/**
 * POST /api/projects/[id]/action — authenticated free-form project action (G1, Piece 2).
 *
 * Two-step, NO silent mutations (same PROPOSE→CONFIRM pattern as schedule-command):
 *   1. PROPOSE  { intent: string }              → Haiku classify_action forced-tool.
 *                                                  Returns a summary + nonce.
 *   2. CONFIRM  { confirmed: true,              → verifies nonce, claims once,
 *                 proposal: {...},                 routes to the right orchestrator.
 *                 proposal_nonce: string }
 *
 * Supported actions: schedule_send → createOrTouchSchedule; build_deliverable →
 * assembleDeliverable. "unknown" is rejected at Phase 1 (no nonce issued).
 *
 * Auth: cookie/RLS client for ownership; service-role only for the write orchestrators
 * (same pattern as the build route). Never service-role for the ownership check.
 */

const ACTION_MODEL = "claude-haiku-4-5";

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

const CLASSIFY_ACTION_TOOL: Anthropic.Tool = {
  name: "classify_action",
  description:
    "Classify the user's project action request into a structured action the system can execute.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["schedule_send", "build_deliverable", "unknown"],
        description:
          "'schedule_send' = create or modify an email schedule; 'build_deliverable' = build a deliverable from the project; 'unknown' = cannot map to a supported action.",
      },
      summary: {
        type: "string",
        description:
          "1-sentence plain-English summary of what will happen (written for the user to confirm).",
      },
      // ── schedule_send params ──
      cadence: {
        type: "string",
        enum: ["daily", "weekly", "monthly"],
        description: "For schedule_send: the delivery cadence.",
      },
      day_of_week: {
        type: "number",
        description: "For schedule_send + weekly: day 0 (Sun) – 6 (Sat). Omit for non-weekly.",
      },
      day_of_month: {
        type: "number",
        description: "For schedule_send + monthly: day 1–28. Omit for non-monthly.",
      },
      template_id: {
        type: "string",
        description:
          "For schedule_send: the email template (e.g. 'market-overview'). Omit to default.",
      },
      scope_kind: {
        type: "string",
        enum: ["zip", "place", "county"],
        description: "For schedule_send: geographic scope kind — only when the user names a place.",
      },
      scope_value: {
        type: "string",
        description:
          "For schedule_send: the geographic scope value (e.g. '33931', 'Cape Coral'). Lowercase.",
      },
      // ── build_deliverable params ──
      template: {
        type: "string",
        enum: ["market-overview", "bov-lite", "client-email", "one-pager", "email"],
        description:
          "For build_deliverable: the deliverable template. Use 'email' for a send-ready client email (grounded on the project's ZIP).",
      },
    },
    required: ["action", "summary"],
  },
};

const SYSTEM_PROMPT = `You are a project assistant for a SWFL commercial real estate broker.
The user will describe an action they want to take on their project.
Classify it into ONE of: schedule_send (create/modify an email schedule), build_deliverable (build a deliverable from the project's filed items), or unknown (anything else).
For schedule_send: extract cadence (daily/weekly/monthly), day_of_week/day_of_month if clear, and scope if the user names a place or ZIP.
For build_deliverable: pick the closest template (market-overview, bov-lite, client-email, one-pager, email). Use 'email' for a send-ready client email — it is grounded on the project's ZIP.
Write the summary in plain English for the user to confirm — no jargon, no internal IDs.`;

export interface ActionProposal {
  action: "schedule_send" | "build_deliverable";
  summary: string;
  cadence?: string;
  day_of_week?: number;
  day_of_month?: number;
  template_id?: string;
  scope_kind?: string;
  scope_value?: string;
  template?: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient(await cookies());

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // RLS proves ownership: a non-owner resolves to no row → 404.
  const { data: project } = await supabase
    .from("projects")
    .select("id, items, branding")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // ── CONFIRM: write the already-agreed action. No model call. ──
  if (body.confirmed === true) {
    const proposal = body.proposal as ActionProposal | null | undefined;
    const nonceToken = typeof body.proposal_nonce === "string" ? body.proposal_nonce : null;

    if (!proposal || !nonceToken) {
      return NextResponse.json({ error: "proposal and proposal_nonce required" }, { status: 400 });
    }

    if (process.env.SDG_COOKIE_SECRET) {
      const vr = verifyProposalNonce(nonceToken, {
        uid: user.id,
        pid: id,
        proposal,
      });
      if (!vr.ok) {
        return NextResponse.json({ error: "invalid_nonce", reason: vr.reason }, { status: 401 });
      }
      let won: boolean;
      try {
        won = await claimOnce(supabase, `nonce:${vr.nid}`, {
          userId: user.id,
          kind: "nonce",
        });
      } catch (e) {
        console.error("[projects/action] nonce claim failed:", e);
        return NextResponse.json({ error: "nonce_claim_failed" }, { status: 500 });
      }
      if (!won) return NextResponse.json({ error: "already_confirmed" }, { status: 409 });
    }

    if (proposal.action === "schedule_send") {
      const nowDate = new Date();
      const nowIso = nowDate.toISOString();
      const command = {
        action: "create" as const,
        cadence: (proposal.cadence as "daily" | "weekly" | "monthly") ?? "weekly",
        day_of_week: proposal.day_of_week,
        day_of_month: proposal.day_of_month,
        send_hour_et: 10, // default 10am ET; G1 MVP doesn't parse time preference
        template_id: proposal.template_id,
        scope_kind: proposal.scope_kind as "zip" | "place" | "county" | undefined,
        scope_value: proposal.scope_value,
      };
      const nextRunAt = computeNextRunAt(command, nowDate);
      const nextRunAtIso = nextRunAt ? nextRunAt.toISOString() : null;
      try {
        const result = await createOrTouchSchedule(supabase as unknown as ScheduleUpsertDb, {
          userId: user.id,
          projectId: id,
          command,
          nowIso,
          nextRunAtIso,
        });
        return NextResponse.json({ type: "CONFIRMED", result });
      } catch (e) {
        console.error("[projects/action] createOrTouchSchedule failed:", e);
        return NextResponse.json({ error: "schedule_failed" }, { status: 500 });
      }
    }

    if (proposal.action === "build_deliverable") {
      const template = proposal.template ?? "market-overview";
      if (!isTemplateId(template)) {
        return NextResponse.json({ error: "invalid_template" }, { status: 422 });
      }
      // An email is ZIP-only — ground it on the project's inferred ZIP. If the project
      // names no ZIP, ask for one instead of building an empty email (the same rule the
      // workspace Build menu enforces). Other templates carry no scope.
      let scope: { scope_kind?: string; scope_value?: string } = {};
      if (template === "email") {
        const s = emailDeliverableScope((project.items ?? []) as ProjectItem[]);
        if (!s) {
          return NextResponse.json(
            {
              type: "NEEDS_SCOPE",
              message:
                "An email needs a single ZIP to ground its numbers. This project isn't scoped to a ZIP yet — open it from a ZIP-level read first, or build a market overview instead.",
            },
            { status: 422 },
          );
        }
        scope = s;
      }
      try {
        const { id: slug } = await assembleDeliverable({
          db: createServiceRoleClient(),
          projectId: id,
          ownerId: user.id,
          items: project.items,
          branding: project.branding,
          template,
          instruction: "",
          ...scope,
        });
        return NextResponse.json({ type: "CONFIRMED", result: { deliverableId: slug } });
      } catch (e) {
        if (e instanceof DeliverableError) {
          return NextResponse.json({ error: e.message }, { status: e.status });
        }
        throw e;
      }
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 422 });
  }

  // ── PROPOSE: classify intent with Haiku, issue nonce. ──
  const intent = typeof body.intent === "string" ? body.intent.trim() : null;
  if (!intent) return NextResponse.json({ error: "intent required" }, { status: 400 });

  const msg = await getAnthropic().messages.create({
    model: ACTION_MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: intent }],
    tools: [CLASSIFY_ACTION_TOOL],
    tool_choice: { type: "tool", name: "classify_action" },
  });

  const toolBlock = msg.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return NextResponse.json({ error: "classify_failed" }, { status: 500 });
  }
  const raw = toolBlock.input as Record<string, unknown>;

  const action = raw.action as string;
  const summary = typeof raw.summary === "string" ? raw.summary : "Action proposed.";

  if (action === "unknown") {
    return NextResponse.json(
      {
        type: "UNKNOWN",
        message: `I can schedule email digests or build deliverables from this project. Try: "Schedule a weekly email" or "Build a market overview."`,
      },
      { status: 422 },
    );
  }

  const proposal: ActionProposal = {
    action: action as ActionProposal["action"],
    summary,
    ...(raw.cadence ? { cadence: raw.cadence as string } : {}),
    ...(typeof raw.day_of_week === "number" ? { day_of_week: raw.day_of_week } : {}),
    ...(typeof raw.day_of_month === "number" ? { day_of_month: raw.day_of_month } : {}),
    ...(raw.template_id ? { template_id: raw.template_id as string } : {}),
    ...(raw.scope_kind ? { scope_kind: raw.scope_kind as string } : {}),
    ...(raw.scope_value ? { scope_value: raw.scope_value as string } : {}),
    ...(raw.template ? { template: raw.template as string } : {}),
  };

  const proposalNonce = issueProposalNonce({ uid: user.id, pid: id, proposal });

  return NextResponse.json({
    type: "PROPOSE",
    action,
    summary,
    proposal,
    ...(proposalNonce ? { proposal_nonce: proposalNonce } : {}),
  });
}
