// lib/email/outreach/build-content.ts
//
// The per-recipient market content builder for the cold-outreach drip: turn a
// target's ZIP into a grounded ONE-chart + short copy via the activation snapshot.
// Extracted from scripts/email/outreach-campaign.mts so BOTH the one-shot CLI and
// the recurring drip runner (scripts/email/outreach-drip-run.mts) build content the
// SAME way (one MOAT gate, one chart rule). The scope MOAT gate (resolveZip) lives
// inside assembleActivationReport: out-of-scope → in_scope:false → we return null and
// composeCampaign marks the recipient out_of_scope (never sent an empty report).

import type { CampaignContent } from "./campaign";
import type { OutreachTarget } from "./targets";
import { assembleActivationReport } from "@/lib/email/activation/snapshot";
import type { AssembledReport } from "@/lib/email/activation/snapshot";
import type { EmailChartSpec } from "@/lib/email/templates/charts/chart-types";

/**
 * Largest group of finite metrics sharing one unit → an honest comparable bar
 * (never mixes $/%/days in one chart). Subtitle is caller-supplied: the legacy
 * drip passes its token line (unchanged); the demo email passes "as of MM/DD/YYYY".
 */
export function chartFromReport(report: AssembledReport, subtitle?: string): EmailChartSpec | null {
  const finite = report.metrics.filter((m) => m.value !== null && Number.isFinite(m.value));
  if (finite.length === 0) return null;
  const byUnit = new Map<string, typeof finite>();
  for (const m of finite) {
    const u = m.unit ?? "";
    byUnit.set(u, [...(byUnit.get(u) ?? []), m]);
  }
  const group = [...byUnit.values()].sort((a, b) => b.length - a.length)[0].slice(0, 5);
  return {
    type: "bar",
    title: `${report.primaryPlace ?? `ZIP ${report.zip}`} — key figures`,
    subtitle,
    unit: group[0].unit || undefined,
    data: group.map((m) => ({ label: m.label, value: m.value as number })),
  };
}

export async function buildContent(target: OutreachTarget): Promise<CampaignContent | null> {
  if (!target.zip) return null;
  const report = await assembleActivationReport({ zip: target.zip });
  if (!report.in_scope) return null;

  const chart = chartFromReport(
    report,
    report.freshness_token ? `as of token ${report.freshness_token}` : undefined,
  );
  if (!chart) return null;

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
