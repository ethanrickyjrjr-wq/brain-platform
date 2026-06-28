// lib/email/outreach/lifecycle.ts
//
// The recipient state machine + Resend-event mapping for the drip — pure, no I/O.
// "Click → stop" lives here: an email.clicked maps to status 'engaged', which
// shouldSend() then excludes from the next cycle. The runner + webhook route apply
// these decisions against the DB; this module just decides.

export type RecipientStatus = "active" | "engaged" | "unsubscribed" | "bounced";

export interface DripRecipient {
  status: RecipientStatus;
  /** ISO timestamp, or null = never sent (due immediately). */
  next_send_at: string | null;
}

/** Only ACTIVE recipients whose next send is due (or unset) get the next drip email. */
export function shouldSend(r: DripRecipient, now: Date): boolean {
  if (r.status !== "active") return false;
  if (r.next_send_at == null) return true;
  return new Date(r.next_send_at).getTime() <= now.getTime();
}

export type OutreachEvent =
  "sent" | "delivered" | "opened" | "clicked" | "bounced" | "unsubscribed";

export interface MappedEvent {
  /** Our normalized event to log, or null to ignore the Resend type. */
  event: OutreachEvent | null;
  /** New recipient status to apply (suppresses future sends), or null to leave as-is. */
  suppressTo: RecipientStatus | null;
}

/**
 * Map a Resend outbound webhook `type` to our event + any status transition.
 * - clicked    → log 'clicked'      + status 'engaged'      (the "click → stop")
 * - bounced    → log 'bounced'      + status 'bounced'      (stop; bad address)
 * - complained → log 'unsubscribed' + status 'unsubscribed' (spam report = opt-out)
 * - delivered/opened → log only, no status change
 * - anything else (incl. inbound email.received) → ignore here
 */
export function mapResendOutbound(type: string): MappedEvent {
  switch (type) {
    case "email.delivered":
      return { event: "delivered", suppressTo: null };
    case "email.opened":
      return { event: "opened", suppressTo: null };
    case "email.clicked":
      return { event: "clicked", suppressTo: "engaged" };
    case "email.bounced":
      return { event: "bounced", suppressTo: "bounced" };
    case "email.complained":
      return { event: "unsubscribed", suppressTo: "unsubscribed" };
    default:
      return { event: null, suppressTo: null };
  }
}

/** The slice of a Resend webhook payload we read (outbound email.* events).
 *  NOTE: Resend delivers tags as a plain object {"key":"value"} in the webhook
 *  payload even though the send API accepts [{name,value}] arrays. */
export interface ResendWebhookPayload {
  type?: string;
  data?: { email_id?: string; tags?: Record<string, string> };
}

export interface OutreachWebhookAction {
  /** outreach_recipients.id, from the `rid` tag we set at send time. */
  rid: string;
  /** Resend's message id, for idempotent event dedupe. */
  emailId: string | null;
  event: OutreachEvent;
  suppressTo: RecipientStatus | null;
}

/**
 * Decide what an inbound Resend webhook means for outreach tracking. Returns null when
 * the event isn't a tracked outbound type OR carries no `rid` tag (i.e. it's not one of
 * our outreach sends — e.g. the inbound reply-sensor's email.received). Pure.
 */
export function extractOutreachAction(payload: ResendWebhookPayload): OutreachWebhookAction | null {
  const mapped = mapResendOutbound(payload.type ?? "");
  if (!mapped.event) return null;
  const rid = payload.data?.tags?.["rid"];
  if (!rid) return null;
  return {
    rid,
    emailId: payload.data?.email_id ?? null,
    event: mapped.event,
    suppressTo: mapped.suppressTo,
  };
}

export interface DripCursor {
  step: number;
  next_send_at: string;
}

/** Advance the drip cursor after a send: bump step, schedule the next at +intervalDays. */
export function nextStep(current: { step: number }, intervalDays: number, now: Date): DripCursor {
  const next = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  return { step: current.step + 1, next_send_at: next.toISOString() };
}
