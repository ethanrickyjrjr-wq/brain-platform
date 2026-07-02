// lib/email/outreach/demo-content.ts
//
// Per-touch payload assembly for the funnel demo cadence — DI, no LLM, no network
// in tests. Every figure comes from the activation report / market figures / the
// computed delta; copy is fixed template strings with escaped interpolations.
// The raw freshness token NEVER reaches an output field — dates render MM/DD/YYYY
// via asOfFromToken (the legacy drip's token line is a known leak; not copied here).
// Spec: docs/superpowers/specs/2026-07-02-funnel-demo-email-design.md §3–§6.

import { assembleActivationReport } from "@/lib/email/activation/snapshot";
import { computeReportDelta } from "@/lib/email/activation/delta";
import type {
  ActivationBrand,
  ActivationSnapshot,
  MetricChange,
} from "@/lib/email/activation/types";
import { loadMarketFigures } from "@/lib/email/market-context";
import type { EmailChartSpec } from "@/lib/email/templates/charts/chart-types";
import { asOfFromToken } from "@/lib/project/as-of";
import { buildArrivalUrl } from "@/lib/prospects/build-arrival-url";
import type { BrandEnrichment } from "@/lib/prospects/enrich-brand";
import { chartFromReport } from "./build-content";
import type { DemoTouch } from "./demo-cadence";
import { demoSubject } from "./demo-subjects";

export interface DemoStat {
  label: string;
  value: string;
  source: string;
}

export interface DemoButton {
  label: string;
  url: string;
}

export interface DemoTouchContent {
  subject: string;
  preheader: string;
  kicker: string;
  title: string;
  chart: EmailChartSpec | null;
  bodyHtml: string;
  deltaLine: string | null;
  stats: DemoStat[];
  promptButtons: DemoButton[];
  ctaLabel: string;
  ctaUrl: string;
  asOf: string | null;
  freshnessLine: string;
  sources: string[];
  snapshot: ActivationSnapshot | null;
  anchors: Array<string | number>;
}

export interface DemoRecipientRow {
  id: string;
  email: string;
  name: string | null;
  zip: string | null;
  track: "agent" | "broker";
  subject_variant: "a" | "b";
  brand: ActivationBrand | null;
  snapshot: ActivationSnapshot | null;
}

export interface DemoContentDeps {
  assembleReport?: typeof assembleActivationReport;
  loadFigures?: typeof loadMarketFigures;
}

const STAT_KEYS = ["active", "median_list", "dom"] as const;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Format a snapshot metric value by its unit (display only — never re-computed). */
function fmtMetric(value: number, unit: string | undefined): string {
  switch (unit) {
    case "$":
      return `$${value.toLocaleString("en-US")}`;
    case "%":
      return `${value}%`;
    case " days":
      return `${value} days`;
    default:
      return value.toLocaleString("en-US");
  }
}

function weekdayUtc(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(d);
}

/** ActivationBrand → the BrandEnrichment shape buildArrivalUrl reads (values only). */
function toEnrichment(brand: ActivationBrand | null): BrandEnrichment {
  return {
    primary: brand?.primary ?? null,
    secondary: brand?.accent ?? null,
    logo_url: brand?.logoUrl ?? null,
    company_name: brand?.companyName ?? null,
    confidence: 1,
    source: "fallback",
  };
}

const NO_CHANGE_LINE = "We re-checked every number we showed you — where it stands today:";

function deltaLineFrom(changes: MetricChange[]): string | null {
  const concrete = changes.filter((c) => c.from !== null && c.to !== null).slice(0, 2);
  if (concrete.length === 0) return null;
  return concrete
    .map(
      (c) =>
        `${c.label}: ${fmtMetric(c.from as number, c.unit)} → ${fmtMetric(c.to as number, c.unit)}`,
    )
    .join("; ");
}

export async function buildDemoTouch(
  rec: DemoRecipientRow,
  touch: DemoTouch,
  siteOrigin: string,
  deps: DemoContentDeps = {},
): Promise<DemoTouchContent | null> {
  if (!rec.zip) return null;
  const assemble = deps.assembleReport ?? assembleActivationReport;
  const report = await assemble({ zip: rec.zip });
  if (!report.in_scope) return null;

  const place = report.primaryPlace ?? `ZIP ${report.zip}`;
  const asOf = asOfFromToken(report.freshness_token);
  const chart = chartFromReport(report, asOf ? `as of ${asOf}` : undefined);

  const loadFigures = deps.loadFigures ?? loadMarketFigures;
  const figures = await loadFigures({ kind: "zip", value: rec.zip });
  const stats: DemoStat[] = STAT_KEYS.flatMap((key) => {
    const f = figures.find((x) => x.key === key);
    return f ? [{ label: f.label, value: f.value, source: f.source }] : [];
  });
  const active = figures.find((x) => x.key === "active");
  const headlineFigure = active ? `${active.value} active listings` : null;

  // ── delta (T2) — computed against the frozen T1 snapshot, never invented ──
  let deltaLine: string | null = null;
  let medianDeltaK: number | null = null;
  let sinceLabel: string | null = null;
  if (touch === "t2" && rec.snapshot) {
    sinceLabel = weekdayUtc(rec.snapshot.captured_at);
    const delta = computeReportDelta(rec.snapshot, report.snapshot);
    const line = delta.has_change ? deltaLineFrom(delta.metric_changes) : null;
    deltaLine = line ?? NO_CHANGE_LINE;
    const median = delta.metric_changes.find(
      (c) => c.key === "housing.median_sale_price" && c.delta !== null,
    );
    if (median?.delta) {
      const k = Math.round(median.delta / 1000);
      medianDeltaK = k === 0 ? null : k;
    }
  }

  // ── arrival links: cta carries ref; prompt buttons carry ref + seeded question ──
  const enrich = toEnrichment(rec.brand);
  const ref = `${rec.id}-${touch}`;
  const arrival = (prompt?: string) =>
    buildArrivalUrl({
      name: rec.name ?? undefined,
      brand: enrich,
      zip: rec.zip ?? undefined,
      base: siteOrigin,
      ref,
      ...(prompt ? { prompt } : {}),
    });

  const buttonTouches: DemoTouch[] = ["t1", "t3", "trial", "reengage"];
  const questions =
    rec.track === "agent" && touch === "t3"
      ? [
          `What changed in ${place} this week?`,
          `Which price band is moving in ${place}?`,
          `Draft this week's social posts for ${place}`,
        ]
      : [
          `What changed in ${place} this week?`,
          `Which price band is moving in ${place}?`,
          "Draft my Tuesday client email",
        ];
  const promptButtons: DemoButton[] = buttonTouches.includes(touch)
    ? questions.map((q) => ({ label: q, url: arrival(q) }))
    : [];

  // ── fixed copy per track/touch ──
  const p = escapeHtml(place);
  const brokerage = rec.brand?.companyName ? escapeHtml(rec.brand.companyName) : "your office";
  const COPY: Record<DemoTouch, { agent: string; broker: string }> = {
    t1: {
      agent: `We built this for you from live Southwest Florida data — this is what your clients could get from you every week, in your brand.`,
      broker: `Every agent in your office could have sent this at 9 AM — one data engine, each email in your brand.`,
    },
    t2: {
      agent: `Same ${p} read we sent you — re-run against today's data. The numbers below moved on their own; we just re-checked them.`,
      broker: `Same ${p} read we sent your office — re-run against today's data. This is the part that stays fresh without anyone lifting a finger.`,
    },
    t3: {
      agent: `The email is one piece — the same engine writes your week of ${p} social posts, captions and all, from the same live data.`,
      broker: `Works alongside MoxiWorks, BoldTrail, or Follow Up Boss — we're the data-and-content engine, not a CRM replacement. Send us any export of your data and it's in your agents' emails this week.`,
    },
    t4: {
      agent: `Last one from us — here's everything we built for you in one link. Your setup stays live if you ever want it.`,
      broker: `Last one from us — here's everything we built for ${brokerage} in one link. Your setup stays live if you ever want it.`,
    },
    trial: {
      agent: `Your daily ${p} read — fresh numbers every morning, in your brand.`,
      broker: `Your office's daily ${p} read — fresh numbers every morning, one engine.`,
    },
    reengage: {
      agent: `Here's what changed in ${p} since we last wrote.`,
      broker: `Here's what changed in ${p} since we last wrote.`,
    },
  };
  const framing = COPY[touch][rec.track];
  const bodyHtml = framing;
  const preheader = framing.split(". ")[0].replace(/\.$/, "") + ".";

  const TITLES: Record<DemoTouch, string> = {
    t1:
      rec.track === "broker"
        ? `${brokerage}'s ${p} morning email`
        : `Your ${p} market snapshot — in your brand`,
    t2: deltaLine === NO_CHANGE_LINE ? `${p}, re-checked` : `What moved in ${p}`,
    t3:
      rec.track === "broker"
        ? `One engine under your whole office`
        : `Your week of ${p} content, done`,
    t4: `Everything we built for you — one link`,
    trial: `${p} — today's read`,
    reengage: `${p} since we last wrote`,
  };

  const subject = demoSubject({
    track: rec.track,
    touch,
    variant: rec.subject_variant,
    name: rec.name,
    brokerage: rec.brand?.companyName ?? null,
    place,
    headlineFigure,
    medianDeltaK,
    sinceLabel,
  });

  const sources = [
    ...new Set([...stats.map((s) => s.source), ...(chart ? ["SWFL Data Gulf"] : [])]),
  ];

  // chartFromReport always builds the bar shape; the union narrow keeps tsc honest.
  const chartPoints = chart?.type === "bar" ? chart.data : [];
  const anchors: Array<string | number> = [
    ...stats.map((s) => s.value),
    // Labels are held data too — a brain label like "Homes sold (90d)" carries a
    // digit that must not read as an invented figure at the gate.
    ...stats.map((s) => s.label),
    ...chartPoints.map((d) => d.value),
    ...chartPoints.map((d) => d.label),
    ...(asOf ? [asOf] : []),
    ...(rec.zip ? [rec.zip] : []),
    ...(headlineFigure ? [headlineFigure] : []),
    ...(deltaLine && deltaLine !== NO_CHANGE_LINE ? [deltaLine] : []),
  ];

  return {
    subject,
    preheader,
    kicker: `${place} · Market Pulse`,
    title: TITLES[touch],
    chart,
    bodyHtml,
    deltaLine,
    stats,
    promptButtons,
    ctaLabel:
      touch === "t4" || touch === "reengage"
        ? "Everything we built for you, one link"
        : "See your whole week — already built",
    ctaUrl: arrival(),
    asOf,
    freshnessLine: asOf
      ? `Live Southwest Florida data — as of ${asOf}`
      : "Live Southwest Florida market data",
    sources,
    snapshot: touch === "t1" ? report.snapshot : null,
    anchors,
  };
}
