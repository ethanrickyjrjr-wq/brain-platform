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
// LIVE SEND IS NOT WIRED (same posture as enroll-prospect's Phase D). A bulk cold
// send is not CAN-SPAM-compliant until three things are decided/built (Increment 2):
//   1. Per-recipient unsubscribe identity (a stored id → /api/unsubscribe URL), since
//      resend.batch.send to raw addresses has no managed-contact unsubscribe.
//   2. Click → suppress: first click from a recipient stops their drip (Resend webhook).
//   3. Secrets + a verified CAN-SPAM sender address in the send env.
// A DRY_RUN=false invocation refuses with that checklist — but still writes the run
// report so the preview/tracking works now.
//
// Usage:
//   bun scripts/email/outreach-campaign.mts --csv targets.csv
//   env: SITE_ORIGIN (default https://www.swfldatagulf.com), DRY_RUN (default true),
//        CONFIDENCE_THRESHOLD (default 0.5)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseTargetsCsv, type OutreachTarget } from "@/lib/email/outreach/targets";
import {
  composeCampaign,
  type CampaignContent,
  type ComposedMessage,
} from "@/lib/email/outreach/campaign";
import { enrichBrand } from "@/lib/prospects/enrich-brand";
import { assembleActivationReport } from "@/lib/email/activation/snapshot";
import type { EmailChartSpec } from "@/lib/email/templates/charts/chart-types";

const DRY_RUN = process.env.DRY_RUN !== "false"; // default true — must opt OUT to send
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://www.swfldatagulf.com";
const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD ?? "0.5");

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

/**
 * Build the per-recipient content from their ZIP's grounded report. The scope MOAT
 * gate (resolveZip) lives inside assembleActivationReport — out-of-scope → in_scope:false
 * → we return null (the recipient is skipped, never sent an empty report).
 *
 * v1 chart: a bar of the report's largest same-unit metric group (honest comparison;
 * never mixes $/%/days in one bar). v2 upgrade is a trend sparkline off lib/charts
 * series — left as a clear seam; needs lake access this CLI runs against in the
 * operator's env.
 */
async function buildContent(target: OutreachTarget): Promise<CampaignContent | null> {
  if (!target.zip) return null;
  const report = await assembleActivationReport({ zip: target.zip });
  if (!report.in_scope) return null;

  const finite = report.metrics.filter((m) => m.value !== null && Number.isFinite(m.value));
  if (finite.length === 0) return null;

  // Largest group of metrics sharing one unit → a comparable bar.
  const byUnit = new Map<string, typeof finite>();
  for (const m of finite) {
    const u = m.unit ?? "";
    byUnit.set(u, [...(byUnit.get(u) ?? []), m]);
  }
  const group = [...byUnit.values()].sort((a, b) => b.length - a.length)[0].slice(0, 5);

  const chart: EmailChartSpec = {
    type: "bar",
    title: `${report.primaryPlace ?? `ZIP ${report.zip}`} — key figures`,
    subtitle: report.freshness_token ? `as of token ${report.freshness_token}` : undefined,
    unit: group[0].unit || undefined,
    data: group.map((m) => ({ label: m.label, value: m.value as number })),
  };

  const place = report.primaryPlace ?? `ZIP ${report.zip}`;
  const explanation =
    report.lines
      .slice(0, 2)
      .map((l) => l.text)
      .join(" ") || `The latest Southwest Florida market read for ${place}.`;

  return {
    kicker: `${place} · Market Pulse`,
    title: `Your ${place} market snapshot`,
    chart,
    explanation,
    subject: `${place}: your latest Southwest Florida market read`,
    freshness: report.freshness_token
      ? `Live data token: ${report.freshness_token}`
      : "Live Southwest Florida market data",
  };
}

function refuseLiveSend(summary: unknown): never {
  console.error(
    "\n[outreach] LIVE SEND REFUSED — not wired (Increment 2). Before a compliant cold send:\n" +
      "  1. Per-recipient unsubscribe identity (stored id → /api/unsubscribe URL).\n" +
      "  2. Click → suppress (Resend webhook stops a recipient's drip on first click).\n" +
      "  3. Secrets + a verified CAN-SPAM sender address in the send env.\n" +
      `Run report was still written. Summary: ${JSON.stringify(summary)}\n`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const csvPath = arg("csv");
  if (!csvPath) {
    console.error("usage: --csv <path-to-targets.csv>  (columns: email,name,domain,zip)");
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
    `[outreach] composing ${rows.length} target(s) · DRY_RUN=${DRY_RUN} · origin=${SITE_ORIGIN}`,
  );

  const { messages, summary } = await composeCampaign(rows, {
    enrich: enrichBrand,
    buildContent,
    siteOrigin: SITE_ORIGIN,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
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
    JSON.stringify({ generated_at: new Date().toISOString(), summary, rows: reportRows }, null, 2),
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

  if (!DRY_RUN) refuseLiveSend(summary);
}

main().catch((err) => {
  console.error(`[outreach] FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
