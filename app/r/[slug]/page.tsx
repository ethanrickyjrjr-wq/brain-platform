import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  parseBrainMarkdown,
  toDisplayBrain,
  type DisplayBrain,
} from "../../../refinery/render/speaker.mts";
import { fetchVerifiedCorridorRows } from "../cre-swfl/corridors";
import { corridorKey, displayNameFor } from "../../../refinery/lib/corridor-display.mts";
import { normalizeCorridor } from "../../../refinery/sources/cre-source.mts";
import { brainJsonLd } from "../../../lib/jsonld.ts";
import type { BrainOutputDirection } from "../../../refinery/types/brain-output.mts";
import {
  ReportShell,
  ReportHeader,
  ReportFooter,
  SectionTitle,
  Meta,
  Stat,
} from "../_components/report-shell";
import { MetricsTable } from "../_components/metrics-table";
import { ColorLegend } from "../_components/color-legend";
import { ReportChart } from "../../../components/charts/ReportChart";
import { HighlighterLayer } from "../../../components/highlighter/HighlighterLayer";
import { HighlighterProvider } from "../../../lib/highlighter/context";
import { highlighterUiEnabled } from "../../../lib/highlighter/flag";
import { PrintButton } from "../../../components/PrintButton";
import { CRESummaryBoxes, CRECorridorBreakdown } from "../cre-swfl/CREMetricsExplorer";
import { CREMarketBeatChart } from "../cre-swfl/CREMarketBeatChart";
import {
  parseMBCityLabel,
  parseDisplayNumeric,
  shortenSummaryLabel,
  type CountyNode,
  type CorridorNode,
  type MBCityMetric,
  type MetricBox,
} from "../cre-swfl/cre-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRAINS_DIR = path.join(process.cwd(), "brains");
const VALID_SLUG = /^[a-z0-9-]+$/;

function displayName(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!VALID_SLUG.test(slug)) return {};
  try {
    const content = await readFile(path.join(BRAINS_DIR, `${slug}.md`), "utf-8");
    const display = toDisplayBrain(parseBrainMarkdown(content));
    return {
      title: `${display.title} — SWFL Data Gulf`,
      description: display.scope,
    };
  } catch {
    return { title: `${displayName(slug)} — SWFL Data Gulf` };
  }
}

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

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function ReportPage({ params }: PageProps) {
  const { slug } = await params;
  if (!VALID_SLUG.test(slug)) notFound();

  let content: string;
  try {
    content = await readFile(path.join(BRAINS_DIR, `${slug}.md`), "utf-8");
  } catch {
    notFound();
  }

  let parsed: ReturnType<typeof parseBrainMarkdown>;
  let display: DisplayBrain;
  try {
    parsed = parseBrainMarkdown(content);
    display = toDisplayBrain(parsed);
  } catch {
    return <RawFallback slug={slug} content={content} />;
  }

  const hasDetail = display.detailCaveats.length > 0 || display.metrics.length > 0;
  const ld = brainJsonLd(display, slug);

  // ── CRE Key-metrics split (server-safe: plain strings + audited numbers) ──
  // The display metrics are 1:1 with the raw key_metrics, so we zip them to
  // recover each metric's audited numeric value for the Market Beat chart.
  const rawMetrics = parsed.output.key_metrics ?? [];
  const serializedMetrics = display.metrics.map((m, i) => {
    const raw = rawMetrics[i];
    const valueStr = typeof m.value === "string" ? m.value : String(m.value);
    return {
      label: m.label,
      value: valueStr,
      direction: m.direction,
      valueNum: raw && typeof raw.value === "number" ? raw.value : parseDisplayNumeric(valueStr),
    };
  });

  // Per-city MarketBeat datapoints (retail/office/industrial × the 3 inputs) —
  // feed both the sector chart and the expanded-city boxes.
  const mbCityMetrics: MBCityMetric[] = [];
  for (const m of serializedMetrics) {
    const p = parseMBCityLabel(m.label);
    if (!p) continue;
    mbCityMetrics.push({
      city: p.city,
      sector: p.sector,
      metricType: p.metricType,
      value: m.value,
      valueNum: m.valueNum,
      direction: m.direction,
    });
  }

  // Combined Lee + Collier boxes shown on load — the SWFL medians, the
  // MarketBeat SWFL medians, and the composite reads. Drops per-city submarket
  // metrics (they live in the drill-down) and the area/county rollups + the
  // current-events signal list (not box-shaped).
  const isMBRollup = (label: string) =>
    label.startsWith("MarketBeat ") && (/\barea\b/i.test(label) || /\bcounty\b/i.test(label));
  const summaryMetrics: MetricBox[] = serializedMetrics
    .filter(
      (m) =>
        slug === "cre-swfl" &&
        !parseMBCityLabel(m.label) &&
        !isMBRollup(m.label) &&
        !/current-events signals/i.test(m.label),
    )
    .map((m) => ({
      label: shortenSummaryLabel(m.label),
      value: m.value,
      direction: m.direction,
    }));

  const highlighterEnabled = highlighterUiEnabled();

  const pageContent = (
    <>
      <ReportHeader title={display.title}>
        <p className="mt-3 max-w-3xl text-base leading-7 text-gray-300">{display.scope}</p>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Meta
            label="Freshness"
            value={<code className="text-xs text-[#00d4aa]">{display.freshnessToken}</code>}
          />
          <Meta label="Updated" value={formatDate(display.refinedAt)} />
          <Meta label="Confidence" value={`${display.confidencePct}%`} />
        </dl>
      </ReportHeader>

      <section className="mt-8">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${DIRECTION_BADGE[display.direction]}`}
          >
            {DIRECTION_LABEL[display.direction]}
          </span>
          <Stat label="Strength" value={`${display.magnitudePct}%`} />
          <PrintButton reportId={slug} />
        </div>
        <p className="mt-6 text-lg leading-8 text-gray-200">{display.conclusion}</p>
      </section>

      {/* The at-a-glance chart. For cre-swfl this is the sector-clickable
          "Market Beat" chart (six city totals); every other report keeps the
          auto-computed chart derived from the data it holds. */}
      {slug === "cre-swfl"
        ? mbCityMetrics.length > 0 && <CREMarketBeatChart metrics={mbCityMetrics} />
        : display.chart && <ReportChart block={display.chart} />}

      {slug === "cre-swfl" ? (
        <>
          {summaryMetrics.length > 0 && (
            <section className="mt-10">
              <SectionTitle>Key metrics</SectionTitle>
              <CRESummaryBoxes boxes={summaryMetrics} />
            </section>
          )}
          {/* Per-corridor breakdown — its own section, BELOW Key metrics. */}
          <section className="mt-12">
            <SectionTitle>Corridor breakdown</SectionTitle>
            <CRESection mbMetrics={mbCityMetrics} />
          </section>
        </>
      ) : (
        display.metrics.length > 0 && (
          <section className="mt-10">
            <SectionTitle>Key metrics</SectionTitle>
            <MetricsTable
              metrics={display.metrics.map((m) => ({
                label: m.label,
                value: m.value,
                direction: m.direction,
                sourceUrl: m.sourceUrl,
                sourceLabel: m.sourceLabel,
                methodHref: m.methodHref,
              }))}
            />
          </section>
        )
      )}

      {display.summaryCaveats.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Worth knowing</SectionTitle>
          <ul className="mt-3 list-disc space-y-2 pl-6 text-gray-300">
            {display.summaryCaveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {hasDetail && <SourcesGate sourceCount={display.metrics.length} />}

      <ColorLegend />

      <ReportFooter freshnessToken={display.freshnessToken} />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />

      {/* The Highlighter — an additive client sibling. It overlays the popup /
          coachmark and listens for text selection. It is rendered LAST and is
          not a wrapper, so a throw inside it cannot blank the report above.
          Gated behind HIGHLIGHTER_UI (default OFF): the verified server engine
          ships regardless; the popup stays dark on prod until browser-verified. */}
      {highlighterEnabled && (
        <HighlighterLayer
          reportId={slug}
          conclusion={display.conclusion}
          freshnessToken={display.freshnessToken}
          metricSuggestions={display.metrics
            .filter((m) => m.suggestions.length > 0)
            .map((m) => ({
              label: m.label,
              value: typeof m.value === "string" ? m.value : String(m.value),
              suggestions: m.suggestions,
              sourceUrl: m.sourceUrl,
              sourceLabel: m.sourceLabel,
              freshnessToken: display.freshnessToken,
            }))}
        />
      )}
    </>
  );

  return (
    <ReportShell>
      {/* HighlighterProvider owns chipFact state and exposes onActivate via
          context so MetricsTable's FactChips and HighlighterLayer share state
          without prop-threading through this server component. Only rendered
          when the Highlighter flag is on — when off, MetricsTable falls back to
          plain <span> values with no chip affordance. */}
      {highlighterEnabled ? <HighlighterProvider>{pageContent}</HighlighterProvider> : pageContent}
    </ReportShell>
  );
}

/** Title-case a corridor_type slug ("power-center" → "Power Center"). */
function formatCorridorType(t: string): string {
  return t
    .replace(/[-_]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** The four corridor-level stat boxes (cap / vacancy / absorption / NNN). */
function corridorBoxes(c: ReturnType<typeof normalizeCorridor>): MetricBox[] {
  const boxes: MetricBox[] = [];
  if (c.cap_rate_pct !== null) {
    boxes.push({
      label: "Cap Rate",
      value: `${c.cap_rate_pct.toFixed(1)}%`,
      direction: c.cap_rate_direction,
    });
  }
  if (c.vacancy_rate_pct !== null) {
    boxes.push({
      label: "Vacancy",
      value: `${c.vacancy_rate_pct.toFixed(1)}%`,
      direction: c.vacancy_rate_direction,
    });
  }
  if (c.absorption_sqft !== null) {
    boxes.push({
      label: "Net Absorption",
      value: `${c.absorption_sqft >= 0 ? "+" : ""}${c.absorption_sqft.toLocaleString()} sf`,
      direction: c.absorption_sqft_direction,
    });
  }
  if (c.asking_rent_psf !== null) {
    boxes.push({
      label: "Asking Rent NNN",
      value: `$${c.asking_rent_psf.toFixed(2)}/sf`,
      direction: c.asking_rent_psf_direction,
    });
  }
  return boxes;
}

/** County → City → Corridor hierarchy, each corridor carrying its own boxes. */
async function buildCounties(): Promise<CountyNode[]> {
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await fetchVerifiedCorridorRows();
  } catch {
    // Missing Supabase creds (e.g. a preview deploy) must NOT crash the page —
    // degrade to an empty breakdown instead.
    return [];
  }
  const countyMap = new Map<string, Map<string, CorridorNode[]>>();
  for (const r of rows) {
    const c = normalizeCorridor(r);
    const slug = corridorKey(String(r.corridor_name ?? ""));
    if (!slug) continue;
    const county = c.county;
    const city = c.city || "Other";
    if (!countyMap.has(county)) countyMap.set(county, new Map());
    const cityMap = countyMap.get(county)!;
    if (!cityMap.has(city)) cityMap.set(city, []);
    cityMap.get(city)!.push({
      slug,
      name: c.display_name ?? displayNameFor(c.name),
      subtitle: c.corridor_type ? formatCorridorType(c.corridor_type) : null,
      metrics: corridorBoxes(c),
    });
  }

  const rank = (county: string) => {
    const order = ["Lee", "Collier"];
    const i = order.indexOf(county);
    return i === -1 ? order.length : i;
  };

  return [...countyMap.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([county, cityMap]) => ({
      county,
      cities: [...cityMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([city, corridors]) => ({
          city,
          county,
          corridors: corridors.sort((a, b) => a.name.localeCompare(b.name)),
        })),
    }));
}

/** Server wrapper: fetches the corridor hierarchy, then hands it to the client
 *  drill-down breakdown. */
async function CRESection({ mbMetrics }: { mbMetrics: MBCityMetric[] }) {
  const counties = await buildCounties();
  return <CRECorridorBreakdown mbMetrics={mbMetrics} counties={counties} />;
}

function RawFallback({ slug, content }: { slug: string; content: string }) {
  return (
    <ReportShell>
      <ReportHeader title={displayName(slug)}>
        <p className="mt-3 text-sm text-gray-400">
          This read does not expose a structured summary yet. Showing the raw artifact.
        </p>
      </ReportHeader>
      <pre className="mt-6 overflow-x-auto rounded-xl glass-card-modern border border-white/10 p-4 text-xs leading-5 text-gray-300">
        {content}
      </pre>
    </ReportShell>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function SourcesGate({ sourceCount }: { sourceCount: number }) {
  return (
    <div className="mt-10 rounded-xl glass-card-modern border border-white/10 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-medium text-gray-300">
          Full detail — every source and note
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-[#00d4aa]/10 px-2.5 py-0.5 text-xs font-medium text-[#00d4aa]">
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4 4.5V3a2 2 0 114 0v1.5h.5A1.5 1.5 0 0110 6v4a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 012 10V6a1.5 1.5 0 011.5-1.5H4zm2-3a.5.5 0 00-.5.5V4.5h1V2a.5.5 0 00-.5-.5z"
              clipRule="evenodd"
            />
          </svg>
          Members only
        </span>
      </div>
      <div className="px-4 pt-3 pb-1 select-none pointer-events-none">
        <p className="text-xs uppercase tracking-wider text-gray-600 mb-2">Sources</p>
        {Array.from({ length: Math.min(sourceCount, 3) }).map((_, i) => (
          <div
            key={i}
            className="mb-2 h-3 rounded bg-white/[0.04]"
            style={{ width: `${65 + (i % 3) * 12}%` }}
          />
        ))}
      </div>
      <div className="px-4 pb-4 pt-2">
        <Link
          href="/#waitlist"
          className="inline-flex items-center gap-2 btn-gradient text-navy-dark px-5 py-2 rounded-lg text-sm font-semibold"
        >
          Get access to unlock sources
        </Link>
        <p className="mt-2 text-xs text-gray-600">
          {sourceCount} source{sourceCount !== 1 ? "s" : ""} + full provenance behind this read.
        </p>
      </div>
    </div>
  );
}
