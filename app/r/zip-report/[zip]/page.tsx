import { notFound } from "next/navigation";
import { resolveZip } from "../../../../refinery/lib/zip-resolver.mts";
import type { LocationInput } from "../../../../refinery/lib/location-resolver.mts";
import type { Grain } from "../../../../refinery/lib/zip-resolver.mts";
import { resolveGradeConfig, type DirectionPolarity } from "../../../../refinery/vocab/loader.mts";
import { loadParsedBrain } from "../../../../lib/fetch-brain";
import { assembleLocationDossier, selectDossierLines } from "../../../../lib/zip-dossier";
import type { LocationDossierLine } from "../../../../lib/zip-dossier";
import { identityForZip, didYouMeanBanner } from "../../../../lib/location-surface";
import {
  ReportShell,
  ReportHeader,
  ReportFooter,
  SectionTitle,
  Meta,
} from "../../_components/report-shell";
import { HighlighterLayer } from "../../../../components/highlighter/HighlighterLayer";
import { HighlighterProvider } from "../../../../lib/highlighter/context";
import { highlighterUiEnabled } from "../../../../lib/highlighter/flag";
import { DataRow } from "../../_components/metrics-table";
import { ColorLegend } from "../../_components/color-legend";
import {
  LocationSearchBox,
  IdentityCard,
  DidYouMeanBanner,
  OutOfScopePanel,
} from "../../_components/location-ui";
import { SourcesAccordion } from "../../_components/sources-accordion";
import type { SourceEntry } from "../../_components/sources-accordion";
import DigestSubscribe from "../../../../components/email/DigestSubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ZIP = /^\d{5}$/;

interface PageProps {
  params: Promise<{ zip: string }>;
  searchParams: Promise<{ q?: string; matched?: string }>;
}

type SectionBucket = "city" | "county" | "swfl";

function grainBucket(grain: Grain): SectionBucket {
  if (grain === "city" || grain === "corridor") return "city";
  if (grain === "county") return "county";
  return "swfl"; // region, msa, national, state
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

  const loc: LocationInput = { kind: "zip", resolution: res };
  const dossier = await assembleLocationDossier(loc);

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

  // Identity and did-you-mean
  const identity = identityForZip(res);
  const didYouMean = didYouMeanBanner(sp.q, sp.matched);

  // Section titles derived from resolved geography
  const primaryPlace =
    (res.places.find((p) => p.match === "primary") ?? res.places[0])?.place ?? null;
  const headerTitle = primaryPlace ? `${primaryPlace} (ZIP ${zip})` : `ZIP ${zip}`;
  const cityAreaTitle = primaryPlace ? `${primaryPlace} Area` : "Local Area";
  const countyTitle = res.county_names[0] ? `${res.county_names[0]} County` : "County";

  // All rollup lines (non-ZIP grains), bucketed into three consolidated sections
  const rollupLines: LocationDossierLine[] = selectDossierLines(dossier.lines, 2).filter(
    (l) => !l.is_true_zip,
  );
  const cityLines = rollupLines.filter((l) => grainBucket(l.grain) === "city");
  const countyLines = rollupLines.filter((l) => grainBucket(l.grain) === "county");
  const swflLines = rollupLines.filter((l) => grainBucket(l.grain) === "swfl");

  // Collect all sources for the bottom accordion — no inline source links anywhere
  const sources: SourceEntry[] = [];
  if (hasFlood && floodSourceUrl) {
    sources.push({ label: floodSourceCitation || "FEMA NFIP", url: floodSourceUrl });
  }
  for (const l of rollupLines) {
    if (l.source_url) {
      sources.push({ label: l.source_citation || l.brain_id, url: l.source_url });
    }
  }

  // Freshness token — quoted once, in the header
  const freshnessToken =
    housing?.freshness_token ?? env?.freshness_token ?? Object.values(dossier.freshness_tokens)[0];
  const updatedAt = housing?.refined_at ?? env?.refined_at;

  const highlighterEnabled = highlighterUiEnabled();

  const pageContent = (
    <>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <ReportHeader title={headerTitle}>
        <dl className="mt-4 flex flex-wrap gap-5 text-sm">
          {freshnessToken && (
            <Meta
              label="Freshness"
              value={<code className="text-xs text-[#0a8078]">{freshnessToken}</code>}
            />
          )}
          {updatedAt && <Meta label="Updated" value={formatDate(updatedAt)} />}
        </dl>
        <div className="mt-5">
          <LocationSearchBox defaultValue={zip} />
        </div>
      </ReportHeader>

      {/* ── Identity — WHERE before any number ──────────────────────────── */}
      <IdentityCard identity={identity} />
      {didYouMean && <DidYouMeanBanner message={didYouMean} />}

      {/* ── ZIP-Level: Housing + Flood ───────────────────────────────────── */}
      {(hasHousing || hasFlood) && (
        <section id="section-zip" className="mt-10">
          <SectionTitle>ZIP-Level Data</SectionTitle>

          {hasHousing && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Housing Market
              </h3>
              <p className="mt-0.5 text-xs text-gray-500">90-day window</p>
              <dl className="mt-3 divide-y divide-white/[0.06] rounded-xl glass-card-modern border border-white/10">
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
                {saleToList != null && (
                  <DataRow label="Sale-to-list ratio" value={`${saleToList}%`} />
                )}
                {mos != null && <DataRow label="Months of supply" value={String(mos)} />}
                {homesSold != null && (
                  <DataRow label="Homes sold (90d)" value={String(homesSold)} />
                )}
                {inventory != null && (
                  <DataRow label="Active inventory" value={String(inventory)} />
                )}
              </dl>
            </div>
          )}

          {hasFlood && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Flood Risk
              </h3>
              <p className="mt-0.5 text-xs text-gray-500">NFIP 10-yr average annual loss</p>
              <dl className="mt-3 divide-y divide-white/[0.06] rounded-xl glass-card-modern border border-white/10">
                <DataRow
                  label="Avg Annual Loss"
                  value={`$${aal.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })} / yr per insured property`}
                />
                <DataRow label="SWFL percentile rank" value={`${rank}th`} />
              </dl>
            </div>
          )}
        </section>
      )}

      {/* ── City / Corridor Area ─────────────────────────────────────────── */}
      {cityLines.length > 0 && (
        <section id="section-city" className="mt-10">
          <SectionTitle>{cityAreaTitle}</SectionTitle>
          <div className="mt-4 space-y-3">
            {cityLines.map((l) => (
              <div
                key={l.brain_id}
                className="rounded-xl glass-card-modern border border-white/10 px-4 py-3"
              >
                <p className="text-sm leading-6 text-gray-200">{stripStatAnnotation(l.text)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── County ──────────────────────────────────────────────────────── */}
      {countyLines.length > 0 && (
        <section id="section-county" className="mt-10">
          <SectionTitle>{countyTitle}</SectionTitle>
          <div className="mt-4 space-y-3">
            {countyLines.map((l) => (
              <div
                key={l.brain_id}
                className="rounded-xl glass-card-modern border border-white/10 px-4 py-3"
              >
                <p className="text-sm leading-6 text-gray-200">{stripStatAnnotation(l.text)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Southwest Florida ───────────────────────────────────────────── */}
      {swflLines.length > 0 && (
        <section id="section-swfl" className="mt-10">
          <SectionTitle>Southwest Florida</SectionTitle>
          <div className="mt-4 space-y-3">
            {swflLines.map((l) => (
              <div
                key={l.brain_id}
                className="rounded-xl glass-card-modern border border-white/10 px-4 py-3"
              >
                <p className="text-sm leading-6 text-gray-200">{stripStatAnnotation(l.text)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Sources accordion (collapsed by default) ────────────────────── */}
      <SourcesAccordion sources={sources} />

      {/* ── Free digest capture (replaces the old $39/$79 paid CTA) ─────── */}
      <div className="mt-10">
        <DigestSubscribe source="zip-report" />
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

function stripStatAnnotation(text: string): string {
  return text.replace(/\s*\([^()]*:\s*[^()]+\)\s*$/, "");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
