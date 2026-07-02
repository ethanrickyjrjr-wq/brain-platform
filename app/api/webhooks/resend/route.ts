/**
 * Resend inbound webhook — the return path of the Buyer-Intent Reply Sensor.
 *
 * When a client replies to a branded market-data email, Resend POSTs an
 * `email.received` event here. We verify the Svix signature, then hand the event
 * to the DI orchestrator (`processInboundReply`) which identifies the agent (via
 * the reply token → `email_sends`) and the client (via `from` → `email_contacts`),
 * runs the auto-reply gates, fires the grounded auto-reply, and alerts the agent.
 *
 * This route is the ADAPTER: it builds the real seams (Resend body fetch +
 * transactional send, Supabase lookups + writes, the grounded engine). All
 * decision logic lives in lib/email/process-inbound.ts (unit-tested with mocks).
 */
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { getMarketingResend } from "@/lib/email/marketing-client";
import { resolveSender } from "@/lib/email/sender-config";
import { verifySvixSignature } from "@/lib/email/svix-verify";
import { replyDomain } from "@/lib/email/reply-token";
import { generateGroundedAnswer } from "@/lib/grounded-answer";
import { buildAlertContent } from "@/lib/email/agent-alert";
import {
  processInboundReply,
  type InboundDeps,
  type InboundEvent,
} from "@/lib/email/process-inbound";
import { extractOutreachAction, type ResendWebhookPayload } from "@/lib/email/outreach/lifecycle";
import { onDemoEvent, type DemoStage } from "@/lib/email/outreach/demo-cadence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM = {
  fromName: process.env.DIGEST_SENDER_NAME ?? "SWFL Data Gulf",
  fromEmail: process.env.DIGEST_SENDER_ADDRESS ?? "hello@swfldatagulf.com",
};

function siteOrigin(req: Request): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? new URL(req.url).origin;
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET unset — refusing to process.");
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  // Raw body is required for signature verification (must not be re-serialized).
  const raw = await request.text();
  const ok = verifySvixSignature(secret, raw, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  });
  if (!ok) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let event: InboundEvent;
  try {
    event = JSON.parse(raw) as InboundEvent;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // ── Outreach Increment 2: outbound tracking ───────────────────────────────
  // A tagged outreach event (delivered/opened/clicked/bounced/complained) → record it
  // for our internal numbers + apply suppression (click → 'engaged' stops the drip),
  // then ack. Non-outreach events (e.g. the reply sensor's email.received) fall through.
  const outreachAction = extractOutreachAction(event as unknown as ResendWebhookPayload);
  if (outreachAction) {
    try {
      const odb = createServiceRoleClient();
      // General event log — all tracked emails (upsert; dedupe index prevents duplicates).
      await odb.from("email_events").upsert(
        {
          resend_email_id: outreachAction.emailId,
          rid: outreachAction.rid,
          event: outreachAction.event,
        },
        { onConflict: "resend_email_id,event", ignoreDuplicates: true },
      );
      // Outreach-specific: recipient ledger + suppression.
      await odb.from("outreach_events").insert({
        recipient_id: outreachAction.rid,
        event: outreachAction.event,
        resend_email_id: outreachAction.emailId,
      });
      if (outreachAction.suppressTo) {
        await odb
          .from("outreach_recipients")
          .update({ status: outreachAction.suppressTo, updated_at: new Date().toISOString() })
          .eq("id", outreachAction.rid);
      }
      // Demo cadence: the same rid drives stage transitions (a click EARNS the
      // daily trial; complaint/bounce/unsub retire; claimed → converted arrives
      // via /api/claim, not here). Legacy drip rows have track NULL and skip this.
      const { data: demoRec } = await odb
        .from("outreach_recipients")
        .select("stage, track")
        .eq("id", outreachAction.rid)
        .maybeSingle();
      if (demoRec?.track && demoRec.stage) {
        const evt =
          outreachAction.event === "clicked" ||
          outreachAction.event === "bounced" ||
          outreachAction.event === "complained" ||
          outreachAction.event === "unsubscribed"
            ? outreachAction.event
            : null;
        const change = evt ? onDemoEvent(demoRec.stage as DemoStage, evt, new Date()) : null;
        if (change) {
          await odb
            .from("outreach_recipients")
            .update({
              stage: change.stage,
              next_send_at: change.next_send_at,
              updated_at: new Date().toISOString(),
            })
            .eq("id", outreachAction.rid);
        }
      }
    } catch (err) {
      console.error(
        `[resend-webhook] outreach tracking failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return NextResponse.json(
      { ok: true, kind: "outreach", event: outreachAction.event },
      { status: 200 },
    );
  }

  const db = createServiceRoleClient();
  const resend = getMarketingResend();
  const origin = siteOrigin(request);

  const deps: InboundDeps = {
    replyDomain: replyDomain(),
    now: new Date(),
    log: (line) => console.log(line),

    async fetchBody(emailId) {
      const { data, error } = await resend.emails.receiving.get(emailId);
      if (error || !data)
        throw new Error(`receiving.get ${emailId}: ${error?.message ?? "no data"}`);
      return {
        from: data.from ?? "",
        subject: data.subject ?? "",
        // Prefer plain text; fall back to a crude HTML strip so a text-less reply
        // (some clients send HTML only) still yields a question for the model.
        text:
          data.text ??
          (data.html
            ? data.html
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
            : ""),
        headers: (data.headers as Record<string, string | undefined>) ?? {},
      };
    },

    async lookupSend(token) {
      const { data: send, error } = await db
        .from("email_sends")
        .select("user_id, schedule_id")
        .eq("reply_token", token)
        .maybeSingle();
      if (error) throw new Error(`lookup email_sends: ${error.message}`);
      if (!send) return null;
      // Resolve the agent's branded sender the SAME way the cron does (Unit D
      // verified-gating), so the auto-reply goes out as the agent, not platform.
      const { data: cfg } = await db
        .from("email_sender_config")
        .select("domain, resend_domain_id, from_name, from_email, reply_to, domain_verified")
        .eq("user_id", send.user_id)
        .maybeSingle();
      const sender = resolveSender(cfg ?? null, PLATFORM);
      return {
        userId: send.user_id as string,
        scheduleId: (send.schedule_id as number | null) ?? null,
        fromName: sender.fromName,
        fromEmail: sender.fromEmail,
      };
    },

    async lookupContact(userId, email) {
      const { data, error } = await db
        .from("email_contacts")
        .select("name, tags")
        .eq("user_id", userId)
        .eq("email", email)
        .maybeSingle();
      if (error) throw new Error(`lookup email_contacts: ${error.message}`);
      if (!data) return null;
      return { name: (data.name as string | null) ?? null, tags: (data.tags as string[]) ?? [] };
    },

    async countSenderRecent(userId, email, sinceIso) {
      const { count } = await db
        .from("buyer_intent_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("contact_email", email)
        .eq("answer_sent", true)
        .gte("created_at", sinceIso);
      return count ?? 0;
    },

    async countThread(token, email) {
      const { count } = await db
        .from("buyer_intent_events")
        .select("id", { count: "exact", head: true })
        .eq("reply_token", token)
        .eq("contact_email", email)
        .eq("answer_sent", true);
      return count ?? 0;
    },

    async countAgentDay(userId, sinceIso) {
      const { count } = await db
        .from("buyer_intent_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("answer_sent", true)
        .gte("created_at", sinceIso);
      return count ?? 0;
    },

    async generateAnswer(message) {
      return generateGroundedAnswer({ message, reportId: "master", origin });
    },

    async sendAutoReply(args) {
      const res = await resend.emails.send({
        from: `${args.fromName} <${args.fromEmail}>`,
        to: args.to,
        replyTo: args.replyTo,
        subject: args.subject || "Re: your question",
        text: args.text,
      });
      if (res.error) throw new Error(`auto-reply send: ${res.error.message}`);
    },

    async recordEvent(row) {
      const { data, error } = await db
        .from("buyer_intent_events")
        .insert({
          user_id: row.userId,
          reply_token: row.replyToken,
          schedule_id: row.scheduleId,
          contact_email: row.contactEmail,
          contact_name: row.contactName,
          contact_tags: row.contactTags,
          parsed_zip: row.intent.zip,
          parsed_place: row.intent.place,
          parsed_topic: row.intent.topic,
          raw_reply: row.rawReply,
          answer_sent: row.answerSent,
        })
        .select("id")
        .single();
      if (error) {
        console.error(`[resend-webhook] recordEvent failed: ${error.message}`);
        return null;
      }
      return (data?.id as number) ?? null;
    },

    async sendAgentAlert(args) {
      // The alert goes to the agent's REAL inbox (auth.users.email), never the
      // newsletter sender_address.
      const { data: userRes } = await db.auth.admin.getUserById(args.userId);
      const agentEmail = userRes?.user?.email;
      if (!agentEmail) {
        console.error(`[resend-webhook] no auth email for agent ${args.userId}; alert skipped.`);
        return;
      }
      const content = buildAlertContent({
        contactEmail: args.contactEmail,
        contactName: args.contactName,
        intent: args.intent,
        rawReply: args.rawReply,
        answerText: args.answerText,
        knownContact: args.knownContact,
        blockedReason: args.blockedReason,
        alertUrl: args.eventId ? `${origin}/alerts/${args.eventId}` : null,
      });
      const res = await resend.emails.send({
        from: `SWFL Data Gulf Alerts <${PLATFORM.fromEmail}>`,
        to: agentEmail,
        subject: content.subject,
        text: content.text,
      });
      if (res.error) {
        console.error(`[resend-webhook] agent alert send failed: ${res.error.message}`);
      }
    },
  };

  try {
    const outcome = await processInboundReply(event, deps);
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    // Never 500 a webhook on a per-reply failure (Resend would retry the same
    // event into the same error). Log + 200 so the event is acked; the alert/
    // event row is the durable record of what we did.
    console.error(
      `[resend-webhook] processing error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json({ ok: false, error: "processing_error" }, { status: 200 });
  }
}
