// scripts/email/outreach-drip-run.mts
//
// The recurring cold-outreach DRIP runner (the cadence half of Increment 2). A
// standalone Bun process the GHA cron invokes daily — NOT a Next route. It selects
// the recipients whose next drip email is due, RE-COMPOSES fresh per-recipient
// content (the chart updates with each send), sends through Resend, records a `sent`
// event, and advances each recipient's cursor. Click → 'engaged' (the webhook flips
// it) drops them from the next cycle; unsubscribe / bounce do the same.
//
// SAFE BY DEFAULT — DRY_RUN unless DRY_RUN=false. A dry run does a READ-ONLY select +
// compose, logs what it WOULD send, and never sends or mutates a row.
//
// ARCHITECTURE mirrors run-schedules.mts: all decisions are the pure cores
// (lib/email/outreach/{lifecycle,send,campaign,build-content}); this file is the
// adapter that wires the real seams (service-role client, Resend, the brand scrape +
// lake report) and owns the exit code. Per-recipient failures never change the exit.
//
// EXIT: clean run (incl. zero due) → 0. A top-level fatal (missing env/creds, can't
// build the client) → process.exit(1) so a GHA failure is visible.

import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { getMarketingResend } from "@/lib/email/marketing-client";
import { composeCampaign, type ComposedMessage } from "@/lib/email/outreach/campaign";
import { buildContent } from "@/lib/email/outreach/build-content";
import { buildBatchMessages, sendBatches, type BatchSender } from "@/lib/email/outreach/send";
import { nextStep, shouldSend, type RecipientStatus } from "@/lib/email/outreach/lifecycle";
import { enrichBrand } from "@/lib/prospects/enrich-brand";
import type { OutreachTarget } from "@/lib/email/outreach/targets";

const DRY_RUN = process.env.DRY_RUN !== "false"; // default true — must opt OUT to send
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://www.swfldatagulf.com";
const INTERVAL_DAYS = Number(process.env.OUTREACH_INTERVAL_DAYS ?? "3");
const BATCH_LIMIT = Number(process.env.OUTREACH_BATCH_LIMIT ?? "200");
const MAX_STEPS = Number(process.env.OUTREACH_MAX_STEPS ?? "4"); // cap the drip — don't email forever
const POSTAL_ADDRESS = process.env.OUTREACH_POSTAL_ADDRESS; // CAN-SPAM physical address (required for live send)

interface DueRow {
  id: string;
  campaign_id: string;
  email: string;
  name: string | null;
  domain: string | null;
  zip: string | null;
  status: string;
  step: number;
  next_send_at: string | null;
}

/** "Name <email>" sender — a verified CAN-SPAM address is required for a live send. */
function outreachFrom(): string {
  const name = process.env.OUTREACH_FROM_NAME ?? process.env.DIGEST_SENDER_NAME ?? "SWFL Data Gulf";
  const email = process.env.OUTREACH_FROM_EMAIL ?? process.env.DIGEST_SENDER_ADDRESS;
  if (!email) {
    throw new Error(
      "OUTREACH_FROM_EMAIL (or DIGEST_SENDER_ADDRESS) is required for a live send — a verified CAN-SPAM sender address.",
    );
  }
  return `${name} <${email}>`;
}

async function main(): Promise<void> {
  // CAN-SPAM: a live send MUST carry a physical postal address (structural guarantee).
  if (!DRY_RUN && !POSTAL_ADDRESS) {
    console.error(
      "[outreach-drip] LIVE SEND REFUSED — set OUTREACH_POSTAL_ADDRESS (CAN-SPAM requires a physical mailing address in every commercial email).",
    );
    process.exit(1);
  }
  const db = createServiceRoleClient(); // throws → fatal (caught below)
  const now = new Date();
  const nowIso = now.toISOString();

  // Candidate rows: active, under the step cap, ordered so never-sent (null) and
  // oldest-due come first (they survive the LIMIT). shouldSend() then applies the
  // exact due/active gate in code (single source of truth, already unit-tested) —
  // this avoids a PostgREST .or() with a timestamp literal.
  const { data, error } = await db
    .from("outreach_recipients")
    .select("id, campaign_id, email, name, domain, zip, status, step, next_send_at")
    .eq("status", "active")
    // Demo-cadence recipients (track set) belong to outreach-demo-run.mts — the
    // legacy drip must never double-send to them.
    .is("track", null)
    .lt("step", MAX_STEPS)
    .order("next_send_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT);
  if (error) throw new Error(`select due recipients: ${error.message}`);

  const due = ((data ?? []) as DueRow[]).filter((r) =>
    shouldSend({ status: r.status as RecipientStatus, next_send_at: r.next_send_at }, now),
  );
  console.log(
    `[outreach-drip] ${DRY_RUN ? "DRY_RUN " : ""}${due.length} recipient(s) due at ${nowIso} ` +
      `(interval=${INTERVAL_DAYS}d, maxSteps=${MAX_STEPS}).`,
  );
  if (due.length === 0) {
    console.log("[outreach-drip] nothing due; exiting clean.");
    return;
  }

  // Re-compose fresh per-recipient content (the same MOAT-gated builder the CLI uses).
  const targets: OutreachTarget[] = due.map((r) => ({
    email: r.email,
    ...(r.name ? { name: r.name } : {}),
    ...(r.domain ? { domain: r.domain } : {}),
    ...(r.zip ? { zip: r.zip } : {}),
  }));
  const { messages, summary } = await composeCampaign(targets, {
    enrich: enrichBrand,
    buildContent,
    siteOrigin: SITE_ORIGIN,
    ...(POSTAL_ADDRESS ? { postalAddress: POSTAL_ADDRESS } : {}),
  });
  console.log(`[outreach-drip] composed: ${JSON.stringify(summary)}`);

  const idByEmail = new Map(due.map((r) => [r.email, r.id]));
  const stepByEmail = new Map(due.map((r) => [r.email, r.step]));
  const campaignByEmail = new Map(due.map((r) => [r.email, r.campaign_id]));
  const readyMsgs: ComposedMessage[] = messages.filter((m) => m.status === "ready" && !!m.html);

  if (DRY_RUN) {
    console.log(
      `[outreach-drip] DRY_RUN — would send ${readyMsgs.length} email(s); no send, no mutate. ` +
        `(${summary.out_of_scope} out-of-scope, ${summary.error} error skipped.)`,
    );
    return;
  }

  // ── live send ──
  const from = outreachFrom();
  const resend = getMarketingResend();
  const batches = buildBatchMessages({
    messages: readyMsgs,
    from,
    unsubBase: SITE_ORIGIN,
    recipientId: (m) => idByEmail.get(m.email) ?? "",
  });
  const result = await sendBatches(resend as unknown as BatchSender, batches);
  console.log(`[outreach-drip] sent=${result.sent} failed=${result.failed}`);
  for (const e of result.errors) console.error(`  send error: ${e}`);

  // Record a `sent` event + advance the cursor for each recipient we composed-ready.
  let advanced = 0;
  for (const m of readyMsgs) {
    const rid = idByEmail.get(m.email);
    if (!rid) continue;
    const cursor = nextStep({ step: stepByEmail.get(m.email) ?? 0 }, INTERVAL_DAYS, now);
    await db.from("outreach_events").insert({
      recipient_id: rid,
      campaign_id: campaignByEmail.get(m.email) ?? null,
      event: "sent",
    });
    await db
      .from("outreach_recipients")
      .update({
        step: cursor.step,
        next_send_at: cursor.next_send_at,
        updated_at: now.toISOString(),
      })
      .eq("id", rid);
    advanced += 1;
  }
  console.log(`[outreach-drip] advanced ${advanced} recipient cursor(s) (+${INTERVAL_DAYS}d).`);
}

main().catch((err) => {
  console.error(`[outreach-drip] FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
