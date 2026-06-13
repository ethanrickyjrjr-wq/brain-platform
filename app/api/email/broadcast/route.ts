import { NextResponse } from "next/server";
import { getMarketingResend, getDigestSegmentId } from "@/lib/email/marketing-client";
import { resolveSegmentId, resolveSender, resolveReplyTo } from "@/lib/email/broadcast-overrides";

/**
 * Server-side digest broadcast trigger (Email Marketing Phase 2).
 *
 * Why this exists: Resend Broadcasts (the only way to send to a Segment, with
 * managed unsubscribe) require a full_access key, which must NOT live in the GHA
 * cron. So the cron renders the digest HTML/subject and POSTs it here; this
 * route — running in the Vercel app where full_access lives — fires the
 * broadcast. Bearer-protected with DIGEST_BROADCAST_SECRET.
 *
 * Safe by default: creates a Resend DRAFT (operator reviews + sends in the
 * dashboard) unless the caller passes `send: true` for an immediate send.
 *
 * Multi-tenant (Unit B): the body accepts OPTIONAL `segmentId` / `fromName` /
 * `fromEmail` / `replyTo` overrides so the cron worker (Unit F) can send
 * per-tenant. Omit them and the send is byte-for-byte the single-tenant SWFL
 * digest (env defaults DIGEST_SENDER_NAME / DIGEST_SENDER_ADDRESS +
 * getDigestSegmentId(), no reply-to). `replyTo` is required by F's
 * unverified-sender path (platform default sender + tenant reply-to).
 *
 * Compliance guard: the HTML MUST contain Resend's managed-unsubscribe token
 * `{{{RESEND_UNSUBSCRIBE_URL}}}`. Without it a broadcast ships with no working
 * per-recipient unsubscribe — a CAN-SPAM violation — so we reject it.
 */
const UNSUBSCRIBE_TOKEN = "{{{RESEND_UNSUBSCRIBE_URL}}}";

export async function POST(request: Request) {
  const secret = process.env.DIGEST_BROADCAST_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    subject?: unknown;
    html?: unknown;
    send?: unknown;
    previewText?: unknown;
    // Optional per-tenant overrides (Unit B). Absent → digest env defaults.
    segmentId?: unknown;
    fromName?: unknown;
    fromEmail?: unknown;
    replyTo?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const html = typeof body.html === "string" ? body.html : "";
  if (!subject || !html) {
    return NextResponse.json({ error: "subject_and_html_required" }, { status: 400 });
  }
  if (!html.includes(UNSUBSCRIBE_TOKEN)) {
    return NextResponse.json({ error: "missing_unsubscribe_token" }, { status: 400 });
  }

  // Sender: per-tenant fromName/fromEmail override the digest env defaults
  // (DIGEST_SENDER_NAME / DIGEST_SENDER_ADDRESS — never RESEND_FROM_EMAIL).
  const sender = resolveSender(
    { fromName: body.fromName, fromEmail: body.fromEmail },
    { name: process.env.DIGEST_SENDER_NAME, address: process.env.DIGEST_SENDER_ADDRESS },
  );
  if (!sender) {
    return NextResponse.json({ error: "sender_not_configured" }, { status: 503 });
  }
  const from = `${sender.name} <${sender.address}>`;

  // Segment: per-tenant override wins; else the digest default. The default is
  // only evaluated when no override is present, so a tenant send doesn't require
  // RESEND_DIGEST_SEGMENT_ID. getDigestSegmentId() still throws → 503 for the
  // digest path when unset.
  let segmentId: string;
  try {
    segmentId = resolveSegmentId(body.segmentId, getDigestSegmentId);
  } catch {
    return NextResponse.json({ error: "segment_not_configured" }, { status: 503 });
  }

  // Per-tenant reply-to (SDK field `replyTo`). Absent → omitted → today's send.
  const replyTo = resolveReplyTo(body.replyTo);

  const sendNow = body.send === true;
  try {
    const resend = getMarketingResend();
    // `send` is a discriminated union in the SDK ({send:true,…} | {send?:false}),
    // so build the two shapes as distinct concrete calls rather than spreading.
    const base = {
      segmentId,
      from,
      subject,
      html,
      ...(typeof body.previewText === "string" ? { previewText: body.previewText } : {}),
      ...(replyTo ? { replyTo } : {}),
    };
    const { data, error } = sendNow
      ? await resend.broadcasts.create({ ...base, send: true })
      : await resend.broadcasts.create(base);
    if (error || !data) {
      console.error("[email/broadcast] resend error:", error);
      return NextResponse.json({ error: "broadcast_failed" }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      broadcast_id: data.id,
      status: sendNow ? "sent" : "draft",
    });
  } catch (e) {
    console.error("[email/broadcast] unavailable:", e);
    return NextResponse.json({ error: "broadcast_failed" }, { status: 502 });
  }
}
