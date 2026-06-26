import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { parseBrainMarkdown, toDisplayBrain } from "../../../refinery/render/speaker.mts";
import type { BrainOutputMetric } from "../../../refinery/types/brain-output.mts";
import type { BrainOutputDirection } from "../../../refinery/types/brain-output.mts";
import {
  ReportShell,
  ReportHeader,
  ReportFooter,
  SectionTitle,
  Meta,
  Stat,
} from "../_components/report-shell";
import { CRESummaryBoxes } from "../cre-swfl/CREMetricsExplorer";
import type { MetricBox } from "../cre-swfl/cre-metrics";
import { ColorLegend } from "../_components/color-legend";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { reportTrail } from "@/lib/nav/breadcrumbs";
import { ReportChart } from "../../../components/charts/ReportChart";
import DigestSubscribe from "../../../components/email/DigestSubscribe";
import { asOfFromToken, asOfFromIso } from "@/lib/project/as-of";
import { PrintButton } from "../../../components/PrintButton";
import { ReportHighlightBridge } from "../../../components/highlighter/ReportHighlightBridge";
import { highlighterUiEnabled } from "../../../lib/highlighter/flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRAINS_DIR = path.join(process.cwd(), "brains");

// ── Short labels for StatBox cards ────────────────────────────────────────────

const HOUSING_SHORT: Record<string, string> = {
  housing_median_sale_price_swfl: "Median Sale Price",
  housing_median_dom_swfl: "Median DOM",
  housing_months_of_supply_swfl: "Months of Supply",
  housing_avg_sale_to_list_swfl: "Sale-to-List",
  housing_sold_above_list_pct_swfl: "Sold Above Ask",
  housing_off_market_in_two_weeks_pct_swfl: "Off-Market ≤2 Weeks",
};

const STRESS_SHORT: Record<string, string> = {
  seller_stress_score_swfl: "Stress Score",
  seller_stress_delistings_rate_swfl: "Delistings Rate",
  seller_stress_price_drops_rate_swfl: "Price Drop Rate",
  seller_stress_cancellation_rate_swfl: "Cancellation Rate",
  seller_stress_avg_drop_depth_swfl: "Avg Drop Depth",
};

// ── Metric value formatter ────────────────────────────────────────────────────

function fmtMetric(m: BrainOutputMetric): string {
  const v = m.value;
  if (typeof v !== "number") return String(v);
  switch (m.display_format) {
    case "currency":
      return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    case "percent":
      return `${v.toFixed(1)}%`;
    case "count":
      return String(Math.round(v));
    default:
      // Stress score gets "/100" suffix; other raw values get 1dp
      return m.metric === "seller_stress_score_swfl" ? `${v.toFixed(0)}/100` : v.toFixed(1);
  }
}

function toBoxes(rawMetrics: BrainOutputMetric[], labelMap: Record<string, string>): MetricBox[] {
  return rawMetrics
    .filter((m) => labelMap[m.metric])
    .map((m) => ({
      label: labelMap[m.metric]!,
      value: fmtMetric(m),
      direction: m.direction ?? null,
    }));
}

// ── Direction badge ───────────────────────────────────────────────────────────

const DIRECTION_BADGE: Record<BrainOutputDirection, string> = {
  bullish: "bg-[#5bc97a]/10 text-[#5bc97a] border border-[#5bc97a]/25",
  bearish: "bg-[#e08158]/10 text-[#e08158] border border-[#e08158]/25",
  mixed: "bg-[#d4b370]/10 text-[#d4b370] border border-[#d4b370]/25",
  neutral: "bg-white/[0.06] text-gray-400 border border-white/10",
};

const DIRECTION_LABEL: Record<BrainOutputDirection, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  mixed: "Mixed",
  neutral: "Neutral",
};

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata(): Promise<Metadata> {
  try {
    const content = await readFile(path.join(BRAINS_DIR, "housing-swfl.md"), "utf-8");
    const display = toDisplayBrain(parseBrainMarkdown(content));
    return {
      title: `${display.title} — SWFL Data Gulf`,
      description: display.scope,
    };
  } catch {
    return { title: "Housing Market — SWFL Data Gulf" };
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function HousingPage() {
  let housingContent: string;
  try {
    housingContent = await readFile(path.join(BRAINS_DIR, "housing-swfl.md"), "utf-8");
  } catch {
    notFound();
  }

  const housingParsed = parseBrainMarkdown(housingContent);
  const housing = toDisplayBrain(housingParsed);

  // Seller-stress brain is optional — degrade gracefully if not yet built.
  let stressParsed: ReturnType<typeof parseBrainMarkdown> | null = null;
  let stressDisplay: ReturnType<typeof toDisplayBrain> | null = null;
  try {
    const stressContent = await readFile(path.join(BRAINS_DIR, "seller-stress-swfl.md"), "utf-8");
    stressParsed = parseBrainMarkdown(stressContent);
    stressDisplay = toDisplayBrain(stressParsed);
  } catch {
    // not yet built — housing-only render
  }

  const housingBoxes = toBoxes(housingParsed.output.key_metrics ?? [], HOUSING_SHORT);
  const stressBoxes = toBoxes(stressParsed?.output.key_metrics ?? [], STRESS_SHORT);

  const highlighterEnabled = highlighterUiEnabled();

  return (
    <ReportShell>
      <Breadcrumbs trail={reportTrail(housing.title)} />

      <ReportHeader title={housing.title}>
        <p className="mt-3 max-w-3xl text-base leading-7 text-gray-300">{housing.scope}</p>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Meta
            label="As of"
            value={
              <span className="text-xs text-gulf-teal">
                {asOfFromToken(housing.freshnessToken) ?? asOfFromIso(housing.refinedAt)}
              </span>
            }
          />
          <Meta label="Confidence" value={`${housing.confidencePct}%`} />
        </dl>
      </ReportHeader>

      <section className="mt-8">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${DIRECTION_BADGE[housing.direction]}`}
          >
            {DIRECTION_LABEL[housing.direction]}
          </span>
          <Stat label="Strength" value={`${housing.magnitudePct}%`} />
          <PrintButton reportId="housing-swfl" />
        </div>
        <p className="mt-6 text-lg leading-8 text-gray-200">{housing.conclusion}</p>
      </section>

      {housing.chart && <ReportChart block={housing.chart} />}

      {/* ── Market conditions (housing key metrics) ── */}
      {housingBoxes.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Market conditions</SectionTitle>
          <CRESummaryBoxes boxes={housingBoxes} />
        </section>
      )}

      {/* ── Seller stress signals (cross-brain, thin-pipe from seller-stress-swfl) ── */}
      {stressBoxes.length > 0 && stressDisplay && (
        <section className="mt-10">
          <SectionTitle>Seller stress signals</SectionTitle>
          <p className="mb-4 text-sm leading-6 text-gray-400">{stressDisplay.conclusion}</p>
          <CRESummaryBoxes boxes={stressBoxes} />
        </section>
      )}

      {/* ── Caveats ── */}
      {housing.summaryCaveats.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Worth knowing</SectionTitle>
          <ul className="mt-3 list-disc space-y-2 pl-6 text-gray-300">
            {housing.summaryCaveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      <ColorLegend />

      <div className="mt-12">
        <DigestSubscribe source="r-page" />
      </div>

      <ReportFooter freshnessToken={housing.freshnessToken} />

      {highlighterEnabled && (
        <ReportHighlightBridge
          reportId="housing-swfl"
          conclusion={housing.conclusion}
          freshnessToken={housing.freshnessToken}
          metricSuggestions={housing.metrics
            .filter((m) => m.suggestions.length > 0)
            .map((m) => ({
              label: m.label,
              value: typeof m.value === "string" ? m.value : String(m.value),
              suggestions: m.suggestions,
              sourceUrl: m.sourceUrl,
              sourceLabel: m.sourceLabel,
              freshnessToken: housing.freshnessToken,
            }))}
        />
      )}
    </ReportShell>
  );
}
