import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/utils/supabase/server";
import { computeNextRunAt } from "@/lib/email/schedule-cadence";
import {
  SCHEDULE_COMMAND_TOOL,
  buildSystemPrompt,
  validateToolInput,
  summarizeCommand,
  describeExisting,
  hourClarifyCandidates,
  type ExistingSchedule,
  type ParsedCommand,
} from "@/lib/email/schedule-command";
import { issueProposalNonce, verifyProposalNonce } from "@/lib/email/proposal-nonce";
import { claimOnce } from "@/lib/email/idempotency";
import { createOrTouchSchedule, type ScheduleUpsertDb } from "@/lib/email/schedule-upsert";
import { deliverableToScheduleRecipe } from "@/lib/deliverable/schedule-recipe";

export const runtime = "nodejs";

/**
 * POST /api/email/schedule-command — natural-language → email-schedule mutation.
 *
 * Two-step, NO silent mutations:
 *   1. PROPOSE  { projectId, command }            → Claude (forced tool_use, Haiku)
 *                                                    parses one action; the route
 *                                                    validates + summarizes and
 *                                                    returns it. NO write.
 *   2. CONFIRM  { projectId, confirm:true,        → the route re-validates the
 *                 proposal:{...} }                   agreed action and writes the row.
 *
 * Auth: cookie/RLS client (auth.uid() = user_id is the authorization), never
 * service-role — same pattern as app/api/projects/route.ts and the sibling email
 * routes. The Anthropic client is instantiated locally (the refinery agents live in
 * a Bun module tree we don't pull into the Next runtime); the forced-tool_use +
 * tool_use-extraction pattern mirrors refinery/agents/synthesis-agent.mts. Haiku 4.5
 * verified (live, in-session) to support forced tool_choice + the standard tool_use
 * block shape { type, id, name, input }.
 */

const COMMAND_MODEL = "claude-haiku-4-5";

type Db = ReturnType<typeof createClient>;

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

const SCHEDULE_COLUMNS =
  "id,status,cadence,day_of_week,day_of_month,send_hour_et,audience_slug,template_id";

/** First send instant (ISO) for a proposal that carries a schedule time — `create` /
 *  `change-cadence` with a cadence + hour. `null` for the other actions or an incomplete
 *  spec, so the confirm card simply omits the concrete "first email" line. */
function proposalNextRunAt(c: ParsedCommand): string | null {
  if (
    (c.action !== "create" && c.action !== "change-cadence") ||
    !c.cadence ||
    c.send_hour_et == null
  ) {
    return null;
  }
  const next = computeNextRunAt({
    cadence: c.cadence,
    day_of_week: c.day_of_week ?? null,
    day_of_month: c.day_of_month ?? null,
    send_hour_et: c.send_hour_et,
  });
  return next ? next.toISOString() : null;
}

export async function POST(req: NextRequest) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId : null;
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // ── CONFIRM: write the already-agreed action. No model, no re-parse. ──
  if (body?.confirm === true) {
    const v = validateToolInput(body?.proposal);
    if (!v.ok) {
      return NextResponse.json({ error: "invalid_proposal", detail: v.errors }, { status: 422 });
    }
    // Signed, single-use proposal-nonce gate: a double-submitted confirm creates ONE
    // schedule, not two (idempotency), plus anti-forgery. Enforced whenever a signing
    // secret is configured; absent secret → legacy path (PROPOSE issued no nonce, so
    // the client has nothing to echo). See lib/email/proposal-nonce.ts.
    if (process.env.SDG_COOKIE_SECRET) {
      const token = typeof body?.proposal_nonce === "string" ? body.proposal_nonce : null;
      if (!token) {
        return NextResponse.json({ error: "nonce_required" }, { status: 400 });
      }
      const vr = verifyProposalNonce(token, { uid: user.id, pid: projectId, proposal: v.command });
      if (!vr.ok) {
        return NextResponse.json({ error: "invalid_nonce", reason: vr.reason }, { status: 401 });
      }
      // Single-use: a DB-level UNIQUE claim (no TOCTOU). A replayed confirm loses the
      // claim → 409. Cookie/RLS client — the ledger row is the user's own.
      let won: boolean;
      try {
        won = await claimOnce(supabase, `nonce:${vr.nid}`, { userId: user.id, kind: "nonce" });
      } catch (e) {
        console.error("[schedule-command] nonce claim failed:", e);
        return NextResponse.json({ error: "nonce_claim_failed" }, { status: 500 });
      }
      if (!won) {
        return NextResponse.json({ error: "already_confirmed" }, { status: 409 });
      }
    }
    return writeAction(supabase, user.id, projectId, v.command);
  }

  // ── PROPOSE from a built deliverable (the build→schedule bridge, Task 7). ──
  // No LLM: load the deliverable (public SELECT, ownership verified in code — the
  // restyle/revoke pattern), derive the recurring RECIPE (never the frozen snapshot),
  // and return the SAME proposal shape. The confirm path below writes it unchanged.
  if (body?.fromDeliverable && typeof body.fromDeliverable === "object") {
    const fd = body.fromDeliverable as Record<string, unknown>;
    const deliverableId = typeof fd.deliverableId === "string" ? fd.deliverableId : null;
    if (!deliverableId) {
      return NextResponse.json({ error: "deliverableId required" }, { status: 400 });
    }
    const { data: deliv, error: dErr } = await supabase
      .from("deliverables")
      .select("user_id, template, scope_kind, scope_value")
      .eq("id", deliverableId)
      .maybeSingle();
    if (dErr) {
      console.error("[schedule-command] deliverable lookup failed:", dErr);
      return NextResponse.json({ error: "deliverable_lookup_failed" }, { status: 500 });
    }
    if (!deliv) return NextResponse.json({ error: "deliverable_not_found" }, { status: 404 });
    if (deliv.user_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const recipe = deliverableToScheduleRecipe(
      {
        template: deliv.template as string,
        scope_kind: (deliv.scope_kind as string | null) ?? null,
        scope_value: (deliv.scope_value as string | null) ?? null,
      },
      {
        audience_slug: typeof fd.audience_slug === "string" ? fd.audience_slug : undefined,
        cadence: fd.cadence as never,
        day_of_week: typeof fd.day_of_week === "number" ? fd.day_of_week : undefined,
        day_of_month: typeof fd.day_of_month === "number" ? fd.day_of_month : undefined,
        send_hour_et: fd.send_hour_et as never,
      },
    );
    if (!recipe.ok) {
      return NextResponse.json(
        { needsClarification: true, message: recipe.error },
        { status: 200 },
      );
    }
    const dNonce = issueProposalNonce({ uid: user.id, pid: projectId, proposal: recipe.command });
    return NextResponse.json({
      action: recipe.command.action,
      proposal: recipe.command,
      summary: summarizeCommand(recipe.command),
      next_run_at: proposalNextRunAt(recipe.command),
      confirmationRequired: true,
      ...(dNonce ? { proposal_nonce: dNonce } : {}),
    });
  }

  // ── PROPOSE from a raw scope (the in-chat "Send weekly" card, Task 5). ──
  // The pill chat has a ZIP it grounded an answer on, but no deliverable. Derive the
  // SAME grounded-report recipe directly from the scope (no LLM, no deliverable lookup)
  // and return the identical proposal shape. `deliverableToScheduleRecipe` reads only
  // the scope off its row, so a scope-only synthetic row reuses the Task-7 recipe lane
  // verbatim — the two in-chat lanes (built deliverable vs. raw scope) can't diverge.
  if (body?.fromScope && typeof body.fromScope === "object") {
    const fs = body.fromScope as Record<string, unknown>;
    const recipe = deliverableToScheduleRecipe(
      {
        template: "report",
        scope_kind: typeof fs.scope_kind === "string" ? fs.scope_kind : null,
        scope_value: typeof fs.scope_value === "string" ? fs.scope_value : null,
      },
      {
        audience_slug: typeof fs.audience_slug === "string" ? fs.audience_slug : undefined,
        cadence: fs.cadence as never,
        day_of_week: typeof fs.day_of_week === "number" ? fs.day_of_week : undefined,
        day_of_month: typeof fs.day_of_month === "number" ? fs.day_of_month : undefined,
        send_hour_et: fs.send_hour_et as never,
      },
    );
    if (!recipe.ok) {
      return NextResponse.json(
        { needsClarification: true, message: recipe.error },
        { status: 200 },
      );
    }
    const sNonce = issueProposalNonce({ uid: user.id, pid: projectId, proposal: recipe.command });
    return NextResponse.json({
      action: recipe.command.action,
      proposal: recipe.command,
      summary: summarizeCommand(recipe.command),
      next_run_at: proposalNextRunAt(recipe.command),
      confirmationRequired: true,
      ...(sNonce ? { proposal_nonce: sNonce } : {}),
    });
  }

  // ── PROPOSE: parse the NL command into one structured action. No write. ──
  const command = typeof body?.command === "string" ? body.command.trim() : "";
  if (!command) return NextResponse.json({ error: "command required" }, { status: 400 });

  const { data: existingRows } = await supabase
    .from("email_schedules")
    .select(SCHEDULE_COLUMNS)
    .eq("project_id", projectId);
  const existing = (existingRows ?? []) as ExistingSchedule[];

  let toolInput: unknown;
  try {
    const resp = await getAnthropic().messages.create({
      model: COMMAND_MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(existing),
      tools: [SCHEDULE_COMMAND_TOOL] as Anthropic.Tool[],
      tool_choice: { type: "tool", name: SCHEDULE_COMMAND_TOOL.name },
      messages: [{ role: "user", content: command }],
    });
    const block = resp.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      return NextResponse.json({ error: "parse_failed" }, { status: 502 });
    }
    toolInput = block.input;
  } catch (e) {
    console.error("[schedule-command] anthropic error:", e);
    return NextResponse.json({ error: "parser_unavailable" }, { status: 503 });
  }

  // Bare-hour disambiguation (defensive — see hourClarifyCandidates). The model emits
  // action "clarify" + ambiguous_hour when the user gave a meridian-less hour; surface the
  // two explicit choices instead of guessing 6am vs 6pm. Intercepted BEFORE validate —
  // "clarify" is a tool-boundary signal, not a ScheduleAction. No current UI feeds free
  // text here (every hour today is picked); wired for the planned inbound-reply parser.
  if ((toolInput as { action?: string } | null)?.action === "clarify") {
    const cand = hourClarifyCandidates((toolInput as { ambiguous_hour?: number }).ambiguous_hour);
    return NextResponse.json(
      cand
        ? {
            needsClarification: true,
            message: `Did you mean ${cand[0].label} or ${cand[1].label}?`,
            hourCandidates: cand,
          }
        : {
            needsClarification: true,
            message: "What time should it send — for example 9am or 5pm?",
          },
      { status: 200 },
    );
  }

  // Resolve the mutation target + merge existing-row defaults so the proposal is
  // complete, THEN validate the merged command (send_hour_et is required by then).
  const resolved = resolveAndMerge(toolInput as ParsedCommand, existing);
  if ("needsClarification" in resolved) {
    return NextResponse.json(resolved, { status: 200 });
  }

  const v = validateToolInput(resolved.command);
  if (!v.ok) {
    return NextResponse.json(
      {
        needsClarification: true,
        message: "I couldn't fully read that request.",
        errors: v.errors,
      },
      { status: 200 },
    );
  }

  // Issue a signed proposal nonce CONFIRM must echo (null when no secret is set →
  // legacy non-nonce confirm). Binds this user + project + the exact proposal, 15-min TTL.
  const proposalNonce = issueProposalNonce({ uid: user.id, pid: projectId, proposal: v.command });
  return NextResponse.json({
    action: v.command.action,
    proposal: v.command,
    summary: summarizeCommand(v.command),
    next_run_at: proposalNextRunAt(v.command),
    confirmationRequired: true,
    ...(proposalNonce ? { proposal_nonce: proposalNonce } : {}),
  });
}

type ResolveResult =
  | { command: ParsedCommand }
  | {
      needsClarification: true;
      message: string;
      candidates: { id: number; summary: string }[];
    };

/** Resolve the target schedule for a mutation + merge existing-row defaults. */
function resolveAndMerge(input: ParsedCommand, existing: ExistingSchedule[]): ResolveResult {
  if (!input || input.action === "create") return { command: input };

  // Resolve schedule_id: explicit match, else the sole non-stopped schedule.
  let target = input.schedule_id ? existing.find((s) => s.id === input.schedule_id) : undefined;
  if (!target) {
    const active = existing.filter((s) => s.status !== "stopped");
    if (active.length === 1) target = active[0];
  }
  if (!target) {
    return {
      needsClarification: true,
      message: existing.length
        ? "Which schedule did you mean?"
        : "There are no schedules for this project yet — create one first.",
      candidates: existing.map((s) => ({ id: s.id, summary: describeExisting(s) })),
    };
  }

  const merged: ParsedCommand = { ...input, schedule_id: target.id };
  // change-cadence may omit the hour ("just move it to Tuesdays") — inherit it.
  if (
    merged.action === "change-cadence" &&
    merged.send_hour_et == null &&
    target.send_hour_et != null
  ) {
    merged.send_hour_et = target.send_hour_et;
  }
  return { command: merged };
}

async function writeAction(
  supabase: Db,
  userId: string,
  projectId: string,
  command: ParsedCommand,
): Promise<NextResponse> {
  const now = new Date().toISOString();

  if (command.action === "create") {
    const next = computeNextRunAt({
      cadence: command.cadence!,
      day_of_week: command.day_of_week ?? null,
      day_of_month: command.day_of_month ?? null,
      send_hour_et: command.send_hour_et!,
    });
    const nextIso = next ? next.toISOString() : null;
    // Idempotent create (Task 7, D2): re-issuing the SAME recipe reactivates/updates the
    // existing schedule rather than inserting a duplicate. NULL-equal matching lives in
    // createOrTouchSchedule (IS NOT DISTINCT FROM, never `=` against null). One create
    // path for both the NL `create` and the build→schedule bridge.
    try {
      const { id, created } = await createOrTouchSchedule(supabase as unknown as ScheduleUpsertDb, {
        userId,
        projectId,
        command,
        nowIso: now,
        nextRunAtIso: nextIso,
      });
      return NextResponse.json({
        ok: true,
        action: "create",
        schedule_id: id,
        created,
        next_run_at: nextIso,
      });
    } catch (e) {
      console.error("[schedule-command] create failed:", e);
      return NextResponse.json({ error: "create_failed" }, { status: 500 });
    }
  }

  // All other actions mutate an existing row, scoped to this user's project (RLS
  // also enforces ownership). schedule_id is guaranteed present post-resolve.
  if (command.schedule_id == null) {
    return NextResponse.json({ error: "schedule_id required" }, { status: 422 });
  }

  let patch: Record<string, unknown>;
  switch (command.action) {
    case "pause":
      patch = { status: "paused", updated_at: now };
      break;
    case "stop":
      patch = { status: "stopped", next_run_at: null, updated_at: now };
      break;
    case "change-template":
      patch = { template_id: command.template_id, updated_at: now };
      break;
    case "change-audience":
      patch = { audience_slug: command.audience_slug, updated_at: now };
      break;
    case "change-cadence": {
      const next = computeNextRunAt({
        cadence: command.cadence!,
        day_of_week: command.day_of_week ?? null,
        day_of_month: command.day_of_month ?? null,
        send_hour_et: command.send_hour_et!,
      });
      patch = {
        cadence: command.cadence,
        day_of_week: command.day_of_week ?? null,
        day_of_month: command.day_of_month ?? null,
        send_hour_et: command.send_hour_et,
        next_run_at: next ? next.toISOString() : null,
        updated_at: now,
      };
      break;
    }
    default:
      return NextResponse.json({ error: "unsupported_action" }, { status: 422 });
  }

  const { error } = await supabase
    .from("email_schedules")
    .update(patch)
    .eq("id", command.schedule_id)
    .eq("project_id", projectId);
  if (error) {
    console.error(`[schedule-command] ${command.action} failed:`, error);
    return NextResponse.json({ error: `${command.action}_failed` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, action: command.action, schedule_id: command.schedule_id });
}
