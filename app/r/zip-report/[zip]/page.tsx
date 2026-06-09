import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { parseBrainMarkdown } from "../../../../refinery/render/speaker.mts";
import { resolveGradeConfig, type DirectionPolarity } from "../../../../refinery/vocab/loader.mts";
import { ReportShell, ReportHeader, ReportFooter, Meta } from "../../_components/report-shell";
import { HighlighterLayer } from "../../../../components/highlighter/HighlighterLayer";
import { HighlighterProvider } from "../../../../lib/highlighter/context";
import { highlighterUiEnabled } from "../../../../lib/highlighter/flag";
import { DataRow } from "../../_components/metrics-table";
import { ColorLegend } from "../../_components/color-legend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRAINS_DIR = path.join(process.cwd(), "brains");
const VALID_ZIP = /^\d{5}$/;

interface PageProps {
  params: Promise<{ zip: string }>;
}

async function loadBrain(slug: string) {
  const raw = await readFile(path.join(BRAINS_DIR, `${slug}.md`), "utf-8");
  return parseBrainMarkdown(raw);
}

function deltaForSlug(
  deltaSlug: string,
  delta: number | null | undefined,
  unitLabel: string,
): { text: string; polarity: DirectionPolarity; isUp: boolean } | null {
  if (delta == null || delta === 0) return null;
  const { direction_polarity } = resolveGradeConfig(deltaSlug);
  return {
    text: `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)}${unitLabel}`,
    polarity: direction_polarity,
    isUp: delta > 0,
  };
}

export default async function ZipReportPage({ params }: PageProps) {
  const { zip } = await params;
  if (!VALID_ZIP.test(zip)) notFound();

  let housing: Awaited<ReturnType<typeof loadBrain>>;
  try {
    housing = await loadBrain("housing-swfl");
  } catch {
    notFound();
  }

  let env: Awaited<ReturnType<typeof loadBrain>> | null = null;
  try {
    env = await loadBrain("env-swfl");
  } catch {
    // env brain unavailable — flood section will be hidden via hasFlood
  }

  const housingTable = housing.output.detail_tables?.find((t) => t.id === "housing_by_zip");
  const housingRow = housingTable?.rows.find((r) => r.key === zip);
  if (!housingRow) notFound();

  const price = housingRow.cells["median_sale_price"] as number;
  const priceYoy = housingRow.cells["median_sale_price_yoy_pct"] as number | null;
  const dom = housingRow.cells["median_dom"] as number;
  const domYoy = housingRow.cells["median_dom_yoy_days"] as number | null;
  const saleToList = housingRow.cells["avg_sale_to_list_pct"] as number | null;
  const mos = housingRow.cells["months_of_supply"] as number | null;
  const homesSold = housingRow.cells["homes_sold"] as number | null;
  const inventory = housingRow.cells["inventory"] as number | null;

  const floodMetric = env?.output.key_metrics.find(
    (m) => m.metric === `swfl_zip_${zip}_flood_aal_usd_per_insured_property`,
  );
  const rankMetric = env?.output.key_metrics.find(
    (m) => m.metric === `swfl_zip_${zip}_flood_aal_pct_swfl_rank`,
  );
  const hasFlood = floodMetric !== undefined && rankMetric !== undefined;

  const priceBadge = deltaForSlug("median_sale_price_yoy_pct", priceYoy, "% YoY");
  const domBadge = deltaForSlug("median_dom_yoy_days", domYoy, " days");

  // Value wears the same color as its trend badge (operator rule). No badge →
  // no signal → default teal (handled by DataRow's valueClassName default).
  const priceColor = priceBadge ? badgeColor(priceBadge.polarity, priceBadge.isUp) : undefined;
  const domColor = domBadge ? badgeColor(domBadge.polarity, domBadge.isUp) : undefined;

  const aal = hasFlood ? ((floodMetric as NonNullable<typeof floodMetric>).value as number) : 0;
  const rank = hasFlood
    ? Math.round((rankMetric as NonNullable<typeof rankMetric>).value as number)
    : 0;
  const floodSourceUrl = hasFlood
    ? (floodMetric as NonNullable<typeof floodMetric>).source.url
    : "";
  const floodSourceCitation = hasFlood
    ? (floodMetric as NonNullable<typeof floodMetric>).source.citation
    : "";

  const highlighterEnabled = highlighterUiEnabled();

  const pageContent = (
    <>
      <ReportHeader title={`ZIP ${zip} — Housing & Flood Risk Report`}>
        <dl className="mt-4 flex flex-wrap gap-5 text-sm">
          <Meta
            label="Freshness"
            value={<code className="text-xs text-[#00d4aa]">{housing.freshness_token}</code>}
          />
          <Meta label="Updated" value={formatDate(housing.refined_at)} />
        </dl>
      </ReportHeader>

      {/* Housing Market */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
          Housing Market
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">housing-swfl · 90-day window</p>
        <dl className="mt-4 divide-y divide-white/[0.06] rounded-xl glass-card-modern border border-white/10">
          <DataRow
            label="Median sale price"
            value={`$${price.toLocaleString()}`}
            badge={trendBadge(priceBadge)}
            valueClassName={priceColor}
          />
          <DataRow
            label="Days on market"
            value={String(dom)}
            badge={trendBadge(domBadge)}
            valueClassName={domColor}
          />
          {saleToList != null && <DataRow label="Sale-to-list ratio" value={`${saleToList}%`} />}
          {mos != null && <DataRow label="Months of supply" value={String(mos)} />}
          {homesSold != null && <DataRow label="Homes sold (90d)" value={String(homesSold)} />}
          {inventory != null && <DataRow label="Active inventory" value={String(inventory)} />}
        </dl>
      </section>

      {/* Flood Risk */}
      {hasFlood && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            Flood Risk
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">env-swfl · NFIP 10-yr average annual loss</p>
          <dl className="mt-4 divide-y divide-white/[0.06] rounded-xl glass-card-modern border border-white/10">
            <DataRow
              label="Avg Annual Loss"
              value={`$${aal.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })} / yr per insured property`}
            />
            <DataRow label="SWFL percentile rank" value={`${rank}th`} />
            <div className="flex items-start justify-between px-4 py-3 text-sm">
              <dt className="text-gray-400">Source</dt>
              <dd className="ml-4 text-right text-xs text-gray-400">
                <a
                  href={floodSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00d4aa] underline decoration-[#00d4aa]/40 underline-offset-2 hover:decoration-[#00d4aa]"
                >
                  {floodSourceCitation}
                </a>
              </dd>
            </div>
          </dl>
        </section>
      )}

      {/* CTA */}
      <div className="mt-10 rounded-xl glass-card-modern border border-white/10 px-6 py-6">
        <p className="text-center text-sm font-medium text-white">Get this for any SWFL ZIP</p>
        <div className="mt-3 flex flex-wrap justify-center gap-6 text-sm text-gray-300">
          <span>
            One-time report <span className="font-semibold text-white">$39</span>
          </span>
          <span>
            Weekly updates <span className="font-semibold text-white">$79/mo</span>
          </span>
        </div>
        <div className="mt-4 flex justify-center">
          <a
            href={`mailto:support@swfldatagulf.com?subject=ZIP%20Report%20${zip}`}
            className="btn-gradient inline-flex items-center rounded-lg px-6 py-2.5 text-sm font-semibold text-navy-dark transition-all hover:opacity-90"
          >
            Order this report
          </a>
        </div>
      </div>

      <ColorLegend />

      <ReportFooter freshnessToken={housing.freshness_token} />

      {highlighterEnabled && (
        <HighlighterLayer reportId={`zip-${zip}`} freshnessToken={housing.freshness_token} />
      )}
    </>
  );

  return (
    <ReportShell width="2xl">
      {highlighterEnabled ? <HighlighterProvider>{pageContent}</HighlighterProvider> : pageContent}
    </ReportShell>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function badgeColor(polarity: DirectionPolarity, isUp: boolean): string {
  if (polarity === "none") return "text-gray-400";
  if (polarity === "higher_is_bullish") {
    return isUp ? "text-[#5bc97a]" : "text-[#e08158]";
  }
  return isUp ? "text-[#e08158]" : "text-[#5bc97a]";
}

function trendBadge(b: { text: string; polarity: DirectionPolarity; isUp: boolean } | null) {
  if (!b) return null;
  return <span className={`font-sans text-xs ${badgeColor(b.polarity, b.isUp)}`}>{b.text}</span>;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
