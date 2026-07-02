// scripts/email/outreach-demo-scorecard.mts
//
// The cycle-1 scorecard — ONE SQL read off the outreach_demo_funnel view:
// delivered → opened → clicked → arrived → claimed, per track/variant, plus the
// hard cycle-2 verdict: ZERO complaints or the gate stays closed (spec §7).
//
// Usage: bun scripts/email/outreach-demo-scorecard.mts --campaign demo-2026-07

import { createServiceRoleClient } from "@/utils/supabase/service-role";

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
}

interface FunnelRow {
  campaign_id: string;
  track: string;
  subject_variant: string | null;
  recipients: number;
  delivered: number;
  opened: number;
  clicked: number;
  arrived: number;
  claimed: number;
  complaints: number;
  unsubscribed: number;
}

async function main(): Promise<void> {
  const campaignId = arg("campaign");
  if (!campaignId) {
    console.error("usage: --campaign <id>");
    process.exit(1);
  }
  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("outreach_demo_funnel")
    .select("*")
    .eq("campaign_id", campaignId);
  if (error) throw new Error(`read outreach_demo_funnel: ${error.message}`);
  const rows = (data ?? []) as unknown as FunnelRow[];

  console.log(`\nDEMO SCORECARD · campaign=${campaignId}`);
  console.log("=".repeat(88));
  console.log("track  var  recip  deliv  open  click  arrive  claim  unsub  complaints");
  console.log("-".repeat(88));
  for (const r of rows.sort((a, b) =>
    `${a.track}${a.subject_variant}`.localeCompare(`${b.track}${b.subject_variant}`),
  )) {
    console.log(
      `${r.track.padEnd(6)} ${(r.subject_variant ?? "-").padEnd(4)} ${String(r.recipients).padStart(5)} ` +
        `${String(r.delivered).padStart(6)} ${String(r.opened).padStart(5)} ${String(r.clicked).padStart(6)} ` +
        `${String(r.arrived).padStart(7)} ${String(r.claimed).padStart(6)} ${String(r.unsubscribed).padStart(6)} ` +
        `${String(r.complaints).padStart(11)}`,
    );
  }
  console.log("=".repeat(88));
  const complaints = rows.reduce((n, r) => n + r.complaints, 0);
  console.log(
    complaints === 0
      ? "VERDICT: complaints = 0 → cycle-2 gate OPEN"
      : `VERDICT: complaints = ${complaints} → cycle-2 gate CLOSED (spec §7: scale gate is ZERO complaints)`,
  );
}

main().catch((err) => {
  console.error(`[demo-scorecard] FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
