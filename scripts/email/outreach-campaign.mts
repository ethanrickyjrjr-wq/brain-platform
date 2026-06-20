// scripts/email/outreach-campaign.mts
//
// The operator's bulk cold-outreach DRIP entry point. Reads a CSV target list,
// scrapes each recipient's brand, and renders a per-recipient branded email — ONE
// chart + a brief explanation + a "create your own" click-back that auto-populates
// THEIR colors on arrival. Models on enroll-prospect.mts (single → bulk).
//
// SAFE BY DEFAULT — DRY_RUN unless DRY_RUN=false. In DRY_RUN it parses, scrapes,
// assembles each ZIP's content, renders every email, writes a timestamped run-report
// (the tracking artifact) + per-recipient HTML previews under outreach-runs/, and
// prints a summary + each branded arrival URL. It NEVER sends and NEVER mutates.
//
// LIVE SEND (DRY_RUN=false) — Increment 2, now WIRED. For each ready message it:
//   1. Upserts an outreach_recipients row (the per-recipient unsubscribe id AND the
//      drip cursor); the row id rides the email as a `rid` tag + the unsub URL.
//   2. Sends via Resend batch (chunks of 100, CAN-SPAM List-Unsubscribe headers).
//   3. Records a `sent` event and advances the drip cursor (step/next_send_at).
// Suppression (click → 'engaged', unsubscribe, bounce) is handled by the Resend
// webhook + /api/unsubscribe; the daily drip runner (outreach-drip-run.mts) then
// only re-sends to still-active recipients. Requires OUTREACH_FROM_EMAIL (a verified
// CAN-SPAM sender) + RESEND_AUDIENCES_KEY + the SUPABASE_* creds.
//
// Usage:
//   bun scripts/email/outreach-campaign.mts --csv targets.csv [--campaign <label>]
//   env: SITE_ORIGIN (default https://www.swfldatagulf.com), DRY_RUN (default true),
//        CONFIDENCE_THRESHOLD (default 0.5), OUTREACH_INTERVAL_DAYS (default 3),
//        OUTREACH_FROM_NAME / OUTREACH_FROM_EMAIL (live send only)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseTargetsCsv } from "@/lib/email/outreach/targets";
import { composeCampaign, type ComposedMessage } from "@/lib/email/outreach/campaign";
import { buildContent } from "@/lib/email/outreach/build-content";
import { enrichBrand } from "@/lib/prospects/enrich-brand";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { getMarketingResend } from "@/lib/email/marketing-client";
import { buildBatchMessages, sendBatches, type BatchSender } from "@/lib/email/outreach/send";
import { nextStep } from "@/lib/email/outreach/lifecycle";
import { buildRecipientRow } from "@/lib/email/outreach/recipients";

const DRY_RUN = process.env.DRY_RUN !== "false"; // default true — must opt OUT to send
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://www.swfldatagulf.com";
const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD ?? "0.5");
const INTERVAL_DAYS = Number(process.env.OUTREACH_INTERVAL_DAYS ?? "3");
const POSTAL_ADDRESS = process.env.OUTREACH_POSTAL_ADDRESS; // CAN-SPAM physical address (required for live send)

/** Parse `--key value` and `--key=value` from argv. */
function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
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

/**
 * Select-or-insert the recipient by (campaign_id, lower(email)); return its id. The
 * unique index is on the functional (campaign_id, lower(email)), so we match on the
 * already-normalized email rather than PostgREST onConflict over an expression. A
 * re-run of the same campaign updates the row in place (idempotent).
 */
async function upsertRecipient(
  db: ReturnType<typeof createServiceRoleClient>,
  campaignId: string,
  m: ComposedMessage,
): Promise<string> {
  const row = buildRecipientRow(campaignId, m);
  const { data: existing, error: selErr } = await db
    .from("outreach_recipients")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("email", row.email)
    .maybeSingle();
  if (selErr) throw new Error(`select recipient ${row.email}: ${selErr.message}`);
  if (existing?.id) {
    const { error: upErr } = await db
      .from("outreach_recipients")
      .update({
        name: row.name,
        domain: row.domain,
        zip: row.zip,
        brand: row.brand,
        brand_source: row.brand_source,
        brand_confidence: row.brand_confidence,
        arrival_url: row.arrival_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id as string);
    if (upErr) throw new Error(`update recipient ${row.email}: ${upErr.message}`);
    return existing.id as string;
  }
  const { data: inserted, error: insErr } = await db
    .from("outreach_recipients")
    .insert(row)
    .select("id")
    .single();
  if (insErr || !inserted) {
    throw new Error(`insert recipient ${row.email}: ${insErr?.message ?? "no row returned"}`);
  }
  return inserted.id as string;
}

/** Live send the ready messages: persist recipients → batch send → events + cursor. */
async function liveSend(messages: ComposedMessage[], campaignId: string): Promise<void> {
  const ready = messages.filter((m) => m.status === "ready" && !!m.html);
  if (ready.length === 0) {
    console.log("[outreach] live send: 0 ready messages — nothing to send.");
    return;
  }
  const from = outreachFrom();
  const db = createServiceRoleClient();
  const resend = getMarketingResend();
  const now = new Date();

  // 1. Persist each recipient (unsub id + drip cursor) and map email → id.
  const idByEmail = new Map<string, string>();
  for (const m of ready) idByEmail.set(m.email, await upsertRecipient(db, campaignId, m));

  // 2. Build per-recipient Resend batches — unsub URL + rid tag injected, chunked 100.
  const batches = buildBatchMessages({
    messages: ready,
    from,
    unsubBase: SITE_ORIGIN,
    recipientId: (m) => idByEmail.get(m.email) ?? "",
  });

  // 3. Send.
  const result = await sendBatches(resend as unknown as BatchSender, batches);
  console.log(`[outreach] live send: sent=${result.sent} failed=${result.failed}`);
  for (const e of result.errors) console.error(`  send error: ${e}`);

  // 4. Record a `sent` event + advance the drip cursor (step 0 → 1, next due +interval).
  for (const m of ready) {
    const rid = idByEmail.get(m.email);
    if (!rid) continue;
    const cursor = nextStep({ step: 0 }, INTERVAL_DAYS, now);
    await db
      .from("outreach_events")
      .insert({ recipient_id: rid, campaign_id: campaignId, event: "sent" });
    await db
      .from("outreach_recipients")
      .update({
        step: cursor.step,
        next_send_at: cursor.next_send_at,
        updated_at: now.toISOString(),
      })
      .eq("id", rid);
  }
  console.log(
    `[outreach] recorded ${ready.length} sent event(s); drip cursor advanced (+${INTERVAL_DAYS}d).`,
  );
}

async function main(): Promise<void> {
  const csvPath = arg("csv");
  if (!csvPath) {
    console.error("usage: --csv <path-to-targets.csv>  (columns: email,name,domain,zip)");
    process.exit(1);
  }
  const campaignId = arg("campaign") || "cold-outreach";

  // CAN-SPAM: a live send MUST carry a physical postal address. Refuse before composing
  // so a non-compliant blast can't go out (structural guarantee, not aspirational).
  if (!DRY_RUN && !POSTAL_ADDRESS) {
    console.error(
      "[outreach] LIVE SEND REFUSED — set OUTREACH_POSTAL_ADDRESS (a physical mailing address; CAN-SPAM requires it in every commercial email).",
    );
    process.exit(1);
  }

  const text = await readFile(csvPath, "utf8");
  const { rows, errors } = parseTargetsCsv(text);
  if (errors.length) {
    console.error(`[outreach] ${errors.length} target row(s) skipped:`);
    for (const e of errors) console.error(`  line ${e.line}: ${e.reason}`);
  }
  if (rows.length === 0) {
    console.error("[outreach] no valid targets — nothing to do.");
    process.exit(1);
  }

  console.log(
    `[outreach] composing ${rows.length} target(s) · campaign=${campaignId} · DRY_RUN=${DRY_RUN} · origin=${SITE_ORIGIN}`,
  );

  const { messages, summary } = await composeCampaign(rows, {
    enrich: enrichBrand,
    buildContent,
    siteOrigin: SITE_ORIGIN,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    ...(POSTAL_ADDRESS ? { postalAddress: POSTAL_ADDRESS } : {}),
  });

  // Write the tracking run-report + per-recipient previews.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join("outreach-runs", stamp);
  await mkdir(outDir, { recursive: true });
  const reportRows = messages.map(({ html, ...rest }: ComposedMessage) => ({
    ...rest,
    preview: html ? `${rest.email.replace(/[^a-z0-9]/gi, "_")}.html` : null,
  }));
  await writeFile(
    join(outDir, "run-report.json"),
    JSON.stringify(
      { generated_at: new Date().toISOString(), campaign: campaignId, summary, rows: reportRows },
      null,
      2,
    ),
  );
  for (const m of messages) {
    if (m.html) {
      await writeFile(join(outDir, `${m.email.replace(/[^a-z0-9]/gi, "_")}.html`), m.html);
    }
  }

  console.log("\n========================================================================");
  console.log(`RUN REPORT: ${join(outDir, "run-report.json")}`);
  console.log(`SUMMARY: ${JSON.stringify(summary)}`);
  console.log("------------------------------------------------------------------------");
  for (const m of messages) {
    const tag =
      m.status === "ready" ? (m.usedHouseBrand ? "READY(house)" : "READY") : m.status.toUpperCase();
    console.log(`  ${tag.padEnd(14)} ${m.email}`);
    if (m.status === "ready") console.log(`    arrival: ${m.arrivalUrl}`);
    if (m.reason) console.log(`    reason: ${m.reason}`);
  }
  console.log("========================================================================\n");

  if (!DRY_RUN) await liveSend(messages, campaignId);
}

main().catch((err) => {
  console.error(`[outreach] FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
