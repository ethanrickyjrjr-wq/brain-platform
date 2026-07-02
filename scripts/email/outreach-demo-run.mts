// scripts/email/outreach-demo-run.mts
//
// The funnel-demo cadence runner — the send half of the two-track prospect
// sequence (spec: docs/superpowers/specs/2026-07-02-funnel-demo-email-design.md).
// A standalone Bun process (GHA-dispatchable, cron commented until the cycle-1
// zero-complaint gate opens). It selects due demo recipients (track NOT null —
// legacy drip rows are the other runner's), builds the stage's touch via the pure
// cores, renders, runs the mechanical pre-send gates, ALWAYS writes per-recipient
// previews + a run report, and — only under the operator's approval env — sends.
//
// SAFETY LADDER (spec §8):
//   1. DRY_RUN default true (opt OUT with DRY_RUN=false).
//   2. Previews written unconditionally BEFORE any live block: no preview, no send.
//   3. Gate failures SKIP the recipient (reported, never auto-fixed).
//   4. Live additionally requires OUTREACH_DEMO_APPROVED=1 + OUTREACH_POSTAL_ADDRESS
//      + a verified From. The agent never sends; live runs are operator commands.
//
// Usage:
//   bun scripts/email/outreach-demo-run.mts --campaign demo-2026-07
//   env: DRY_RUN (default true), OUTREACH_DEMO_APPROVED (must be "1" for live),
//        OUTREACH_POSTAL_ADDRESS, OUTREACH_FROM_NAME/OUTREACH_FROM_EMAIL,
//        OUTREACH_DEMO_BATCH_LIMIT (default 30), SITE_ORIGIN

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActivationBrand, ActivationSnapshot } from "@/lib/email/activation/types";
import {
  afterSend,
  retireIfStale,
  touchForStage,
  type DemoStage,
  type DemoTouch,
} from "@/lib/email/outreach/demo-cadence";
import { buildDemoTouch, type DemoRecipientRow } from "@/lib/email/outreach/demo-content";
import { preSendGates } from "@/lib/email/outreach/demo-gates";
import { renderDripEmail } from "@/lib/email/outreach/drip-email";
import { shouldSend, type RecipientStatus } from "@/lib/email/outreach/lifecycle";
import { buildBatchMessages, sendBatches, type BatchSender } from "@/lib/email/outreach/send";
import type { ComposedMessage } from "@/lib/email/outreach/campaign";
import { getMarketingResend } from "@/lib/email/marketing-client";
import { createServiceRoleClient } from "@/utils/supabase/service-role";

const DRY_RUN = process.env.DRY_RUN !== "false"; // default true — must opt OUT to send
const APPROVED = process.env.OUTREACH_DEMO_APPROVED === "1";
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://www.swfldatagulf.com";
const BATCH_LIMIT = Number(process.env.OUTREACH_DEMO_BATCH_LIMIT ?? "30");
const POSTAL_ADDRESS = process.env.OUTREACH_POSTAL_ADDRESS;

const SENDABLE: DemoStage[] = [
  "cold_t1",
  "cold_t2",
  "cold_t3",
  "cold_t4",
  "trial_active",
  "cooldown",
];

interface DueRow {
  id: string;
  campaign_id: string;
  email: string;
  name: string | null;
  zip: string | null;
  status: string;
  track: string;
  stage: string;
  subject_variant: string | null;
  brand: ActivationBrand | null;
  snapshot: ActivationSnapshot | null;
  next_send_at: string | null;
  trial_sends: number;
  updated_at: string;
}

interface RunRow {
  email: string;
  touch: DemoTouch | null;
  stage: string;
  outcome: "would_send" | "sent" | "skipped";
  reason?: string;
  subject?: string;
  preview?: string;
}

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
}

function outreachFrom(): string {
  const name = process.env.OUTREACH_FROM_NAME ?? process.env.DIGEST_SENDER_NAME ?? "SWFL Data Gulf";
  const email = process.env.OUTREACH_FROM_EMAIL ?? process.env.DIGEST_SENDER_ADDRESS;
  if (!email) {
    throw new Error("OUTREACH_FROM_EMAIL (or DIGEST_SENDER_ADDRESS) required for a live send.");
  }
  return `${name} <${email}>`;
}

function toDemoRecipient(r: DueRow): DemoRecipientRow {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    zip: r.zip,
    track: r.track as "agent" | "broker",
    subject_variant: (r.subject_variant === "b" ? "b" : "a") as "a" | "b",
    brand: r.brand,
    snapshot: r.snapshot,
  };
}

async function main(): Promise<void> {
  const campaignId = arg("campaign");
  if (!campaignId) {
    console.error("usage: --campaign <id>");
    process.exit(1);
  }

  const db = createServiceRoleClient();
  const now = new Date();

  // Stale-reengage sweep: reengaged + 30 quiet days → retired (spec: no second cycle).
  const { data: reengaged } = await db
    .from("outreach_recipients")
    .select("id, stage, updated_at")
    .eq("campaign_id", campaignId)
    .eq("stage", "reengaged");
  const stale = (reengaged ?? []).filter((r) =>
    retireIfStale(r.stage as DemoStage, r.updated_at as string, now),
  );
  if (stale.length > 0 && !DRY_RUN) {
    for (const r of stale) {
      await db
        .from("outreach_recipients")
        .update({ stage: "retired", updated_at: now.toISOString() })
        .eq("id", r.id as string);
    }
  }
  if (stale.length > 0) {
    console.log(
      `[demo-run] ${DRY_RUN ? "would retire" : "retired"} ${stale.length} stale reengaged.`,
    );
  }

  // Due demo recipients — status is the suppression axis (webhook-owned), stage the
  // cadence axis (ours). Both must agree before a send.
  const { data, error } = await db
    .from("outreach_recipients")
    .select(
      "id, campaign_id, email, name, zip, status, track, stage, subject_variant, brand, snapshot, next_send_at, trial_sends, updated_at",
    )
    .eq("campaign_id", campaignId)
    .not("track", "is", null)
    .eq("status", "active")
    .in("stage", SENDABLE)
    .order("next_send_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT);
  if (error) throw new Error(`select due demo recipients: ${error.message}`);

  const due = ((data ?? []) as unknown as DueRow[]).filter((r) =>
    shouldSend({ status: r.status as RecipientStatus, next_send_at: r.next_send_at }, now),
  );
  console.log(
    `[demo-run] ${DRY_RUN ? "DRY_RUN " : ""}${due.length} due · campaign=${campaignId} · limit=${BATCH_LIMIT}`,
  );

  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const outDir = join("outreach-runs", stamp);
  await mkdir(outDir, { recursive: true });

  const rows: RunRow[] = [];
  const sendable: Array<{
    rec: DueRow;
    touch: DemoTouch;
    msg: ComposedMessage;
    snapshot: ActivationSnapshot | null;
  }> = [];

  for (const rec of due) {
    const touch = touchForStage(rec.stage as DemoStage);
    if (!touch) {
      rows.push({
        email: rec.email,
        touch: null,
        stage: rec.stage,
        outcome: "skipped",
        reason: "terminal stage",
      });
      continue;
    }
    const content = await buildDemoTouch(toDemoRecipient(rec), touch, SITE_ORIGIN);
    if (!content) {
      rows.push({
        email: rec.email,
        touch,
        stage: rec.stage,
        outcome: "skipped",
        reason: "out_of_scope",
      });
      continue;
    }
    if (!content.chart) {
      // An honest demo needs the chart; a chartless send is never improvised.
      rows.push({
        email: rec.email,
        touch,
        stage: rec.stage,
        outcome: "skipped",
        reason: "no_chart",
      });
      continue;
    }

    const brand = rec.brand ?? {};
    const { html, subject } = await renderDripEmail({
      brand,
      kicker: content.kicker,
      title: content.title,
      chart: content.chart,
      explanation: content.bodyHtml,
      deltaLine: content.deltaLine,
      stats: content.stats.map((s) => ({ label: s.label, value: s.value })),
      promptButtons: content.promptButtons,
      preheader: content.preheader,
      ctaLabel: content.ctaLabel,
      ctaUrl: content.ctaUrl,
      sources: content.sources,
      freshness: content.freshnessLine,
      subject: content.subject,
      ...(POSTAL_ADDRESS ? { postalAddress: POSTAL_ADDRESS } : {}),
    });

    // Preview FIRST — unconditionally. No preview, no send.
    const previewName = `${rec.email.replace(/[^a-z0-9]/gi, "_")}-${touch}.html`;
    await writeFile(join(outDir, previewName), html);

    const gate = await preSendGates(html, content, brand, {
      extraAnchors: POSTAL_ADDRESS ? [POSTAL_ADDRESS] : [],
    });
    if (!gate.ok) {
      rows.push({
        email: rec.email,
        touch,
        stage: rec.stage,
        outcome: "skipped",
        reason: `gates: ${gate.failures.join(" | ")}`,
        subject,
        preview: previewName,
      });
      continue;
    }

    rows.push({
      email: rec.email,
      touch,
      stage: rec.stage,
      outcome: DRY_RUN ? "would_send" : "sent",
      subject,
      preview: previewName,
    });
    sendable.push({
      rec,
      touch,
      snapshot: content.snapshot,
      msg: {
        email: rec.email,
        status: "ready",
        brandSource: "demo",
        brandConfidence: 1,
        usedHouseBrand: false,
        primary: brand.primary ?? null,
        arrivalUrl: content.ctaUrl,
        subject,
        html,
      },
    });
  }

  const summary = {
    due: due.length,
    sendable: sendable.length,
    skipped: rows.filter((r) => r.outcome === "skipped").length,
    stale_retired: stale.length,
  };
  await writeFile(
    join(outDir, "run-report.json"),
    JSON.stringify(
      { generated_at: now.toISOString(), campaign: campaignId, dry_run: DRY_RUN, summary, rows },
      null,
      2,
    ),
  );

  console.log("\n========================================================================");
  console.log(`RUN REPORT: ${join(outDir, "run-report.json")}`);
  console.log(`SUMMARY: ${JSON.stringify(summary)}`);
  for (const r of rows) {
    console.log(`  ${r.outcome.toUpperCase().padEnd(11)} ${(r.touch ?? "-").padEnd(9)} ${r.email}`);
    if (r.subject) console.log(`    subject: ${r.subject}`);
    if (r.reason) console.log(`    reason: ${r.reason}`);
  }
  console.log("========================================================================\n");

  if (DRY_RUN) {
    console.log("[demo-run] DRY_RUN — previews written, nothing sent, nothing mutated.");
    return;
  }

  // ── live send: the operator's approval ladder, refused loudly when incomplete ──
  if (!APPROVED) {
    console.error(
      "[demo-run] LIVE SEND REFUSED — operator approval required: review the previews, then set OUTREACH_DEMO_APPROVED=1.",
    );
    process.exit(1);
  }
  if (!POSTAL_ADDRESS) {
    console.error("[demo-run] LIVE SEND REFUSED — set OUTREACH_POSTAL_ADDRESS (CAN-SPAM).");
    process.exit(1);
  }
  const from = outreachFrom();
  const resend = getMarketingResend();

  const batches = buildBatchMessages({
    messages: sendable.map((s) => s.msg),
    from,
    unsubBase: SITE_ORIGIN,
    recipientId: (m) => sendable.find((s) => s.msg.email === m.email)?.rec.id ?? "",
  });
  const result = await sendBatches(resend as unknown as BatchSender, batches);
  console.log(`[demo-run] sent=${result.sent} failed=${result.failed}`);
  for (const e of result.errors) console.error(`  send error: ${e}`);

  // Advance each recipient: freeze the T1 snapshot, then the cadence cursor + event.
  for (const s of sendable) {
    const cursor = afterSend(
      {
        stage: s.rec.stage as DemoStage,
        next_send_at: s.rec.next_send_at,
        trial_sends: s.rec.trial_sends,
      },
      s.rec.id,
      now,
    );
    await db.from("outreach_events").insert({
      recipient_id: s.rec.id,
      campaign_id: s.rec.campaign_id,
      event: "sent",
      meta: { touch: s.touch },
    });
    await db
      .from("outreach_recipients")
      .update({
        stage: cursor.stage,
        next_send_at: cursor.next_send_at,
        trial_sends: cursor.trial_sends,
        ...(s.touch === "t1" && s.snapshot
          ? { snapshot: s.snapshot as unknown as Record<string, unknown> }
          : {}),
        updated_at: now.toISOString(),
      })
      .eq("id", s.rec.id);
  }
  console.log(`[demo-run] advanced ${sendable.length} cadence cursor(s).`);
}

main().catch((err) => {
  console.error(`[demo-run] FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
