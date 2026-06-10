import { notFound } from "next/navigation";
import { resolveZip } from "../../../../refinery/lib/zip-resolver.mts";
import type { LocationInput } from "../../../../refinery/lib/location-resolver.mts";
import { resolveGradeConfig, type DirectionPolarity } from "../../../../refinery/vocab/loader.mts";
import { loadParsedBrain } from "../../../../lib/fetch-brain";
import { assembleLocationDossier, selectDossierLines } from "../../../../lib/zip-dossier";
import { identityForZip, distinctChips, didYouMeanBanner } from "../../../../lib/location-surface";
import { ReportShell, ReportHeader, ReportFooter, Meta } from "../../_components/report-shell";
import { HighlighterLayer } from "../../../../components/highlighter/HighlighterLayer";
import { HighlighterProvider } from "../../../../lib/highlighter/context";
import { highlighterUiEnabled } from "../../../../lib/highlighter/flag";
import { DataRow } from "../../_components/metrics-table";
import { ColorLegend } from "../../_components/color-legend";
import {
  LocationSearchBox,
  IdentityCard,
  GrainChips,
  DidYouMeanBanner,
  DossierCards,
  OutOfScopePanel,
} from "../../_components/location-ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ZIP = /^\d{5}$/;

interface PageProps {
  params: Promise<{ zip: string }>;
  searchParams: Promise<{ q?: string; matched?: string }>;
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

export default async function ZipReportPage({ params, searchParams }: PageProps) {
  const { zip } = await params;
  if (!VALID_ZIP.test(zip)) notFound();
  const sp = await searchParams;

  // Resolve the ZIP's geography. Out of the 6-county footprint → a friendly
  // page, never a bare 404 (notFound() is reserved for a non-ZIP-shaped URL).
  const res = resolveZip(zip);
  if (!res.in_scope) {
    return (
      <ReportShell width="2xl">
        <ReportHeader title={`ZIP ${zip}`}>
          <div className="mt-5">
            <LocationSearchBox defaultValue={zip} />
          </div>
        </ReportHeader>
        <OutOfScopePanel query={zip} />
        <ReportFooter />
      </ReportShell>
    );
  }

  // The full fan-out — every dataset covering this ZIP, at the grain we hold it.
  const loc: LocationInput = { kind: "zip", resolution: res };
  const dossier = await assembleLocationDossier(loc);

  // The bespoke headline reads housing + flood structured, for the trend-badged
  // tables. Resilient: a missing brain hides its section, never 500s the page.
  const housing = await loadParsedBrain("housing-swfl");
  const env = await loadParsedBrain("env-swfl");

  const housingTable = housing?.output.detail_tables?.find((t) => t.id === "housing_by_zip");
  const housingRow = housingTable?.rows.find((r) => r.key === zip);

  const price = housingRow?.cells["median_sale_price"] as number | undefined;
  const priceYoy = housingRow?.cells["median_sale_price_yoy_pct"] as number | null | undefined;
  const dom = housingRow?.cells["median_dom"] as number | undefined;
  const domYoy = housingRow?.cells["median_dom_yoy_days"] as number | null | undefined;
  const saleToList = housingRow?.cells["avg_sale_to_list_pct"] as number | null | undefined;
  const mos = housingRow?.cells["months_of_supply"] as number | null | undefined;
  const homesSold = housingRow?.cells["homes_sold"] as number | null | undefined;
  const inventory = housingRow?.cells["inventory"] as number | null | undefined;

  const floodMetric = env?.output.key_metrics.find(
    (m) => m.metric === `swfl_zip_${zip}_flood_aal_usd_per_insured_property`,
  );
  const rankMetric = env?.output.key_metrics.find(
    (m) => m.metric === `swfl_zip_${zip}_flood_aal_pct_swfl_rank`,
  );
  const hasFlood = floodMetric !== undefined && rankMetric !== undefined;
  const hasHousing = housingRow !== undefined && price !== undefined && dom !== undefined;

  const priceBadge = deltaForSlug("median_sale_price_yoy_pct", priceYoy, "% YoY");
  const domBadge = deltaForSlug("median_dom_yoy_days", domYoy, " days");
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

  // Identity, chips, did-you-mean (G6 + human language live in location-surface).
  const identity = identityForZip(res);
  const chips = distinctChips(dossier.lines);
  const didYouMean = didYouMeanBanner(sp.q, sp.matched);

  // County / metro / region rollups — every labeled "covers {zip}" read BELOW
  // the true-ZIP headline. `!is_true_zip` already excludes the housing/flood
  // lines shown bespoke above. (Future per-ZIP rentals/permits rows render via
  // §F; until then the only true-ZIP reads are housing + flood, both headlined.)
  const rollupLines = selectDossierLines(dossier.lines, 2).filter((l) => !l.is_true_zip);

  // Freshness token — quoted once, in the header.
  const freshnessToken =
    housing?.freshness_token ?? env?.freshness_token ?? Object.values(dossier.freshness_tokens)[0];
  const updatedAt = housing?.refined_at ?? env?.refined_at;

  const highlighterEnabled = highlighterUiEnabled();

  const pageContent = (
    <>
      <ReportHeader title={`ZIP ${zip}`}>
        <dl className="mt-4 flex flex-wrap gap-5 text-sm">
          {freshnessToken && (
            <Meta
              label="Freshness"
              value={<code className="text-xs text-[#00d4aa]">{freshnessToken}</code>}
            />
          )}
          {updatedAt && <Meta label="Updated" value={formatDate(updatedAt)} />}
        </dl>
        <div className="mt-5">
          <LocationSearchBox defaultValue={zip} />
        </div>
      </ReportHeader>

      {/* Identity — confirm WHERE before any number. */}
      <IdentityCard identity={identity} />
      {didYouMean && <DidYouMeanBanner message={didYouMean} />}
      <GrainChips chips={chips} />

      {/* True-ZIP headline: real estate + flood. */}
      {hasHousing && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            Housing Market
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">90-day window</p>
          <dl className="mt-4 divide-y divide-white/[0.06] rounded-xl glass-card-modern border border-white/10">
            <DataRow
              label="Median sale price"
              value={`$${(price as number).toLocaleString()}`}
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
      )}

      {hasFlood && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            Flood Risk
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">NFIP 10-yr average annual loss</p>
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

      {/* County / metro / region rollups — labeled, never read as a ZIP figure. */}
      <DossierCards lines={rollupLines} />

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

      <ReportFooter freshnessToken={freshnessToken} />

      {highlighterEnabled && (
        <HighlighterLayer reportId={`zip-${zip}`} freshnessToken={freshnessToken} />
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
