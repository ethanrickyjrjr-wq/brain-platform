import type { EmailDeliverableRow } from "@/lib/deliverable/email-deliverable";
// POST /api/deliverables/[id]/blast — send a frozen email deliverable to selected
// contacts via Resend.
//
// SEND is the paywall (build is free): this route enforces the per-user email
// quota (checkUsageLimit) and records usage (recordEmailSent). It renders the
// REAL deliverable HTML (renderGroundedReport — the same render /p/[id] shows),
// not a bare link, and sends from the platform's VERIFIED domain with the agent's
// name + reply-to (sending From: an unverified agent address would fail DKIM and
// land in spam). Each recipient gets a one-click unsubscribe (List-Unsubscribe
// header for Gmail + an in-body footer link as the CAN-SPAM floor).
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getMarketingResend } from "@/lib/email/marketing-client";
import { checkUsageLimit, recordEmailSent } from "@/lib/email/usage";
import { buildEmailDeliverableModel } from "@/lib/deliverable/email-deliverable";
import { renderGroundedReport } from "@/lib/email/grounded-report";
import { renderEmailDocHtml } from "@/lib/email/render-email-doc";
import { EmailDocSchema } from "@/lib/email/doc/schema";
import { renderEmailDocToBuffer, pdfFilename } from "@/lib/pdf";
import { logActivity } from "@/lib/project/activity";
import { lintCompiledHtml, collectAllowedUrls } from "@/lib/deliverable/url-lint";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_CONTACTS = 500;
const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.swfldatagulf.com").replace(
  /\/$/,
  "",
);

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Replace {{merge_tags}} with per-recipient values. Case-insensitive. */
function withMergeTags(html: string, c: { name: string | null; email: string }): string {
  const firstName = (c.name ?? "").split(/\s+/)[0] || "there";
  const fullName = c.name ?? c.email;
  return html
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{full_name\}\}/gi, fullName)
    .replace(/\{\{email\}\}/gi, c.email);
}

/** Per-recipient unsubscribe + view-online footer, injected before </body>. */
function withFooter(html: string, webUrl: string, unsubUrl: string): string {
  const footer =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px">` +
    `<tr><td style="padding:20px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#8a8a8a">` +
    `<a href="${escAttr(webUrl)}" style="color:#8a8a8a">View this report online</a> &middot; ` +
    `<a href="${escAttr(unsubUrl)}" style="color:#8a8a8a">Unsubscribe</a><br>` +
    `SWFL Data Gulf &middot; Fort Myers, FL` +
    `</td></tr></table>`;
  return html.includes("</body>") ? html.replace("</body>", `${footer}</body>`) : html + footer;
}

/** A short, clean subject from the deliverable's prose, with a sensible default. */
function deriveSubject(narrative: { exec_summary?: string } | null): string {
  const s = (narrative?.exec_summary ?? "").trim();
  if (!s) return "Your SWFL market report";
  const firstSentence = s.split(/(?<=[.!?])\s/)[0] ?? s;
  return firstSentence.length > 90 ? firstSentence.slice(0, 87) + "…" : firstSentence;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const rawIds: unknown[] = Array.isArray(body?.contact_ids) ? body.contact_ids : [];
  const contactIds = [...new Set(rawIds.filter((v): v is string => typeof v === "string"))];
  if (contactIds.length === 0) {
    return NextResponse.json({ error: "contact_ids required" }, { status: 400 });
  }
  if (contactIds.length > MAX_CONTACTS) {
    return NextResponse.json({ error: `max ${MAX_CONTACTS} contacts per blast` }, { status: 400 });
  }

  // Deliverable (RLS proves ownership → non-owner sees nothing → 404).
  const { data: deliverable } = await supabase
    .from("deliverables")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!deliverable) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Block-canvas (Email Lab) emails are first-class senders alongside the legacy
  // "email" template — both carry frozen, ready content.
  const BLASTABLE = new Set(["email", "block-canvas"]);
  if (!BLASTABLE.has(deliverable.template)) {
    return NextResponse.json({ error: "deliverable is not sendable" }, { status: 400 });
  }
  if (deliverable.status !== "ready") {
    return NextResponse.json({ error: "deliverable is not ready" }, { status: 400 });
  }

  // SEND is the paywall — gate on the user's monthly quota before doing any work.
  const usage = await checkUsageLimit(user.id);
  if (!usage.allowed) {
    return NextResponse.json(
      { error: "quota_reached", tier: usage.tier, sent: usage.sent, limit: usage.limit },
      { status: 402 },
    );
  }

  // Recipients: own, not unsubscribed.
  const { data: contacts, error: contactsErr } = await supabase
    .from("contacts")
    .select("id, email, name")
    .in("id", contactIds)
    .eq("user_id", user.id)
    .eq("unsubscribed", false);
  if (contactsErr) {
    return NextResponse.json({ error: "contacts fetch failed" }, { status: 500 });
  }
  if (!contacts || contacts.length === 0) {
    return NextResponse.json({ error: "no sendable contacts" }, { status: 400 });
  }

  // Render the REAL report once (same engine as /p/[id]); per-recipient we only
  // swap the footer's unsubscribe link. Non-ZIP deliverables (model null) fall
  // back to a minimal wrapper linking to the web version.
  const webUrl = `${BASE_URL}/p/${id}`;
  // Opt-in PDF attachment — block-canvas only (the only template the PDF root
  // renders). Default off: attachments inflate every message.
  const includePdf = body?.include_pdf === true && deliverable.template === "block-canvas";
  let baseHtml: string;
  let pdfBuffer: Buffer | null = null;

  if (deliverable.template === "block-canvas") {
    // Render the SAME block-canvas HTML the Email Lab preview shows — through
    // the ONE EmailDoc→HTML root, so paid grid docs compile here exactly like
    // the render route (a doc must never preview compiled but send stacked) —
    // and, when requested, a real PDF through the single PDF root.
    const parsedDoc = EmailDocSchema.safeParse(deliverable.doc);
    if (!parsedDoc.success) {
      return NextResponse.json({ error: "invalid email document" }, { status: 422 });
    }
    baseHtml = await renderEmailDocHtml(parsedDoc.data);
    if (includePdf) {
      pdfBuffer = await renderEmailDocToBuffer(parsedDoc.data);
    }
  } else {
    // jsonb read: the typed row carries items_snapshot/narrative as Json; the builder
    // reads the concrete EmailDeliverableRow shape (same columns, concrete jsonb).
    const model = buildEmailDeliverableModel(deliverable as unknown as EmailDeliverableRow, {
      siteOrigin: BASE_URL,
    });
    if (model) {
      baseHtml = await renderGroundedReport(model, { skin: "email" });
    } else {
      baseHtml =
        `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px">` +
        `<p style="font-size:16px;color:#111">Your market report is ready.</p>` +
        `<p><a href="${escAttr(webUrl)}" style="display:inline-block;background:#3DC9C0;color:#fff;` +
        `padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">View Report</a></p>` +
        `</body></html>`;
    }
  }

  // Fake-link tripwire (invention-surface-guards §C, unattended send = hard
  // fail): every href/src in the compiled email must be verbatim from the
  // deliverable's own content (doc/snapshot/branding) or a platform link. A
  // minted URL never ships.
  const allowedUrls = collectAllowedUrls(
    deliverable.doc,
    deliverable.items_snapshot,
    deliverable.narrative,
    deliverable.branding,
    webUrl,
  );
  const urlGate = lintCompiledHtml(baseHtml, allowedUrls);
  if (!urlGate.ok) {
    return NextResponse.json(
      { error: "url_violation", violations: urlGate.violations },
      { status: 422 },
    );
  }

  // Deliverability-safe sender: verified platform address, agent's name shown,
  // agent's account email as reply-to.
  const branding = (deliverable.branding ?? {}) as { name?: string };
  const senderName = branding.name?.trim() || process.env.DIGEST_SENDER_NAME || "SWFL Data Gulf";
  const senderAddress = process.env.DIGEST_SENDER_ADDRESS || process.env.RESEND_FROM_EMAIL;
  if (!senderAddress) {
    return NextResponse.json({ error: "sender_not_configured" }, { status: 503 });
  }
  const from = `${senderName} <${senderAddress}>`;
  const replyTo = user.email || undefined;
  const subject =
    typeof body?.subject === "string" && body.subject.trim()
      ? body.subject.trim()
      : deriveSubject(deliverable.narrative as { exec_summary?: string } | null);

  // Audit row.
  const { data: blast } = await supabase
    .from("email_blasts")
    .insert({
      user_id: user.id,
      deliverable_id: id,
      contact_ids: contacts.map((c) => c.id),
      status: "sending",
    })
    .select("id")
    .single();

  const resend = getMarketingResend();
  let sent = 0;
  let failed = 0;

  const messageFor = (c: { id: string; email: string; name: string | null }) => {
    const unsubUrl = `${BASE_URL}/api/unsubscribe?id=${c.id}`;
    const html = withMergeTags(withFooter(baseHtml, webUrl, unsubUrl), c);
    return {
      from,
      to: [c.email],
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  };

  if (pdfBuffer) {
    // Resend's BATCH endpoint strips attachments — its payload type is
    // Omit<CreateEmailOptions, "attachments"> (verified against the installed SDK,
    // index.d.cts:630). So an attached PDF forces per-recipient emails.send().
    const attachments = [{ content: pdfBuffer, filename: pdfFilename() }];
    for (const c of contacts) {
      try {
        const { error } = await resend.emails.send({ ...messageFor(c), attachments });
        if (error) failed += 1;
        else sent += 1;
      } catch {
        failed += 1;
      }
    }
  } else {
    // No attachment → fast path: batch up to 100 per call.
    for (let i = 0; i < contacts.length; i += 100) {
      const batch = contacts.slice(i, i + 100);
      try {
        const { error } = await resend.batch.send(batch.map(messageFor));
        if (error) failed += batch.length;
        else sent += batch.length;
      } catch {
        failed += batch.length;
      }
    }
  }

  if (blast?.id) {
    await supabase
      .from("email_blasts")
      .update({
        status: failed > 0 && sent === 0 ? "failed" : "sent",
        sent_count: sent,
        failed_count: failed,
        sent_at: new Date().toISOString(),
      })
      .eq("id", blast.id);
  }
  if (sent > 0) await recordEmailSent(user.id, sent);

  // Activity log on any successful send so the AI knows "email blast sent to N contacts".
  if (sent > 0 && deliverable.project_id) {
    await logActivity(supabase, {
      projectId: deliverable.project_id,
      type: "email_sent",
      actor: "system",
      summary: `Email blast sent to ${sent} contact${sent === 1 ? "" : "s"}`,
      detail: { sent, failed, deliverable_id: id, subject },
    });
  }

  return NextResponse.json({ sent, failed });
}
