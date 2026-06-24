import "./zip-report.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveZip } from "../../../../refinery/lib/zip-resolver.mts";
import type { LocationInput } from "../../../../refinery/lib/location-resolver.mts";
import type { Grain } from "../../../../refinery/lib/zip-resolver.mts";
import { resolveGradeConfig, type DirectionPolarity } from "../../../../refinery/vocab/loader.mts";
import { loadParsedBrain } from "../../../../lib/fetch-brain";
import { assembleLocationDossier, selectDossierLines } from "../../../../lib/zip-dossier";
import type { LocationDossierLine } from "../../../../lib/zip-dossier";
import { didYouMeanBanner } from "../../../../lib/location-surface";
import { extractZipShape } from "../../../../lib/map/extract-zip-shape";
import { ReportFooter, SectionTitle } from "../../_components/report-shell";
import { ReportHighlightBridge } from "../../../../components/highlighter/ReportHighlightBridge";
import { buildReportId } from "../../../../lib/highlighter/report-surface";
import { suggestionsForMetric } from "../../../../lib/highlighter/suggestions";
import type { MetricSuggestion } from "../../../../lib/highlighter/report-context-store";
import { highlighterUiEnabled } from "../../../../lib/highlighter/flag";
import { ColorLegend } from "../../_components/color-legend";
import {
  LocationSearchBox,
  DidYouMeanBanner,
  OutOfScopePanel,
} from "../../_components/location-ui";
import { CitationList } from "../../../../components/CitationList";
import type { SourceEntry } from "../../../../components/CitationList";
import { asOfFromToken } from "../../../../lib/project/as-of";
import DigestSubscribe from "../../../../components/email/DigestSubscribe";
import { MetroAreaChart } from "../../../../components/charts";
import { SWFL_METRO_SERIES } from "../../../../lib/charts/series";
import { loadMetroTrend } from "../../../../lib/charts/load-metro-trend";
import { loadZipQuickSummary } from "../../../../lib/zip-summary/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ZIP = /^\d{5}$/;
const TOTAL_SWFL_ZIPS = 57;

interface PageProps {
  params: Promise<{ zip: string }>;
  searchParams: Promise<{ q?: string; matched?: string }>;
}

type SectionBucket = "city" | "county" | "swfl";

function grainBucket(grain: Grain): SectionBucket {
  if (grain === "city" || grain === "corridor") return "city";
  if (grain === "county") return "county";
  return "swfl";
}

// ── Color helpers — exact copy from original /z/[zip]/page.tsx ────────────
function hexToRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
function lerpColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  return `rgb(${Math.round(lerp(r1, r2, t))},${Math.round(lerp(g1, g2, t))},${Math.round(lerp(b1, b2, t))})`;
}
// Flood gradient: low=#1c5c4a → mid=#d4b370 → high=#e08158
// Returns rgb(...) string so the glow replacement trick works
function floodFillColor(pct: number): string {
  const t = Math.max(0, Math.min(1, pct / 100));
  return t < 0.5
    ? lerpColor("#1c5c4a", "#d4b370", t * 2)
    : lerpColor("#d4b370", "#e08158", (t - 0.5) * 2);
}

function fmtCurrency(val: number): string {
  if (val >= 1_000_000) return "$" + (val / 1_000_000).toFixed(1) + "M";
  if (val >= 1_000) return "$" + Math.round(val / 1_000) + "K";
  return "$" + val.toLocaleString();
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
      <div className="min-h-dvh bg-navy-dark font-sans text-white">
        <div className="mx-auto max-w-4xl px-6 py-12">
          <OutOfScopePanel query={zip} />
        </div>
      </div>
    );
  }

  const loc: LocationInput = { kind: "zip", resolution: res };

  const [housing, env, permits, dossier, summary, metroTrend] = await Promise.all([
    loadParsedBrain("housing-swfl"),
    loadParsedBrain("env-swfl"),
    loadParsedBrain("permits-swfl"),
    assembleLocationDossier(loc),
    loadZipQuickSummary(zip),
    loadMetroTrend("zhvi_pivoted"),
  ]);

  // ── ZIP shape ─────────────────────────────────────────────────────────────
  const { svgMarkup, found: shapeFound } = extractZipShape(zip);

  // ── Housing ───────────────────────────────────────────────────────────────
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

  const hasHousing = housingRow !== undefined && price !== undefined && dom !== undefined;

  // ── Flood ──────────────────────────────────────────────────────────────────
  const floodMetric = env?.output.key_metrics.find(
    (m) => m.metric === `swfl_zip_${zip}_flood_aal_usd_per_insured_property`,
  );
  const rankMetric = env?.output.key_metrics.find(
    (m) => m.metric === `swfl_zip_${zip}_flood_aal_pct_swfl_rank`,
  );
  const hasFlood = floodMetric !== undefined && rankMetric !== undefined;

  const aal = hasFlood ? ((floodMetric as NonNullable<typeof floodMetric>).value as number) : 0;
  const floodPct = hasFlood
    ? Math.round((rankMetric as NonNullable<typeof rankMetric>).value as number)
    : 0;
  const floodRankPos = hasFlood
    ? Math.max(1, Math.round((1 - floodPct / 100) * TOTAL_SWFL_ZIPS) + 1)
    : null;
  const floodSourceUrl = hasFlood
    ? (floodMetric as NonNullable<typeof floodMetric>).source.url
    : "";
  const floodSourceCitation = hasFlood
    ? (floodMetric as NonNullable<typeof floodMetric>).source.citation
    : "";

  // ── Home value ranking ────────────────────────────────────────────────────
  const allPrices = (housingTable?.rows ?? [])
    .map((r) => ({ zip: r.key, price: r.cells["median_sale_price"] as number | null }))
    .filter((r): r is { zip: string; price: number } => typeof r.price === "number");
  const priceSortedAsc = [...allPrices].sort((a, b) => a.price - b.price);
  const priceIdx = price !== undefined ? priceSortedAsc.findIndex((r) => r.zip === zip) : -1;
  const valuePct = priceIdx >= 0 ? Math.round((priceIdx / priceSortedAsc.length) * 100) : null;
  const valueRankPos = priceIdx >= 0 ? priceSortedAsc.length - priceIdx : null;
  const totalValueZips = priceSortedAsc.length;

  // ── Permits ───────────────────────────────────────────────────────────────
  const permitsTable = permits?.output.detail_tables?.find((t) => t.id === "permits_by_zip");
  const permitsCountMap = new Map<string, number>();
  for (const r of permitsTable?.rows ?? []) {
    const n = r.cells["n_current"];
    if (typeof n === "number") {
      permitsCountMap.set(r.key, (permitsCountMap.get(r.key) ?? 0) + n);
    }
  }
  const permitsCount = permitsCountMap.get(zip) ?? 0;
  const hasPermits = permitsCount > 0;
  const permitsSourceUrl = hasPermits ? (permitsTable?.source.url ?? "") : "";
  const permitsSourceCitation = hasPermits
    ? (permitsTable?.source.citation ?? "Lee County permits")
    : "";

  const allPermitEntries = [...permitsCountMap.entries()].sort(([, a], [, b]) => a - b);
  const permitsIdx = allPermitEntries.findIndex(([z]) => z === zip);
  const permitsPct =
    permitsIdx >= 0 ? Math.round((permitsIdx / allPermitEntries.length) * 100) : null;
  const permitsRankPos = permitsIdx >= 0 ? allPermitEntries.length - permitsIdx : null;
  const totalPermitsZips = allPermitEntries.length;

  // ── Fill color — rgb() string so glow replace() works ────────────────────
  const fillColor = hasFlood ? floodFillColor(floodPct) : "#0a8078";

  // ── Identity ──────────────────────────────────────────────────────────────
  const didYouMean = didYouMeanBanner(sp.q, sp.matched);
  const primaryPlace =
    (res.places.find((p) => p.match === "primary") ?? res.places[0])?.place ?? null;
  const cityAreaTitle = primaryPlace ? `${primaryPlace} Area` : "Local Area";
  const countyTitle = res.county_names[0] ? `${res.county_names[0]} County` : "County";
  const eyebrow = `SWFL Data Gulf · ${res.county_names.join(" & ")}`;

  // ── Dossier buckets ───────────────────────────────────────────────────────
  const rollupLines: LocationDossierLine[] = selectDossierLines(dossier.lines, 2).filter(
    (l) => !l.is_true_zip,
  );
  const cityLines = rollupLines.filter((l) => grainBucket(l.grain) === "city");
  const countyLines = rollupLines.filter((l) => grainBucket(l.grain) === "county");
  const swflLines = rollupLines.filter((l) => grainBucket(l.grain) === "swfl");

  // ── Delta badges ──────────────────────────────────────────────────────────
  const priceBadge = deltaForSlug("median_sale_price_yoy_pct", priceYoy, "% YoY");
  const domBadge = deltaForSlug("median_dom_yoy_days", domYoy, " days");
  const priceColor = priceBadge ? badgeColor(priceBadge.polarity, priceBadge.isUp) : undefined;
  const domColor = domBadge ? badgeColor(domBadge.polarity, domBadge.isUp) : undefined;

  // ── Citations ─────────────────────────────────────────────────────────────
  const sources: SourceEntry[] = [];
  if (hasFlood && floodSourceUrl)
    sources.push({ label: floodSourceCitation || "FEMA NFIP", url: floodSourceUrl });
  if (hasPermits && permitsSourceUrl)
    sources.push({ label: permitsSourceCitation, url: permitsSourceUrl });
  for (const l of rollupLines) {
    if (l.source_url) sources.push({ label: l.source_citation || l.brain_id, url: l.source_url });
  }
  for (const fig of summary.figures) {
    if (fig.source_url) sources.push({ label: fig.source_label, url: fig.source_url });
  }

  // ── Freshness ─────────────────────────────────────────────────────────────
  const freshnessToken =
    housing?.freshness_token ?? env?.freshness_token ?? Object.values(dossier.freshness_tokens)[0];
  const asOf = asOfFromToken(freshnessToken);

  const highlighterEnabled = highlighterUiEnabled();

  // ── Metric suggestions ────────────────────────────────────────────────────
  const metricSuggestions: MetricSuggestion[] = [];
  if (hasHousing) {
    const hm = (label: string, value: string): MetricSuggestion => ({
      label,
      suggestions: suggestionsForMetric({ metric: label.toLowerCase(), value }, "housing-swfl"),
      value,
      freshnessToken,
    });
    metricSuggestions.push(
      hm("Median sale price", `$${(price as number).toLocaleString()}`),
      hm("Days on market", String(dom)),
    );
    if (saleToList != null) metricSuggestions.push(hm("Sale-to-list ratio", `${saleToList}%`));
    if (mos != null) metricSuggestions.push(hm("Months of supply", String(mos)));
    if (homesSold != null) metricSuggestions.push(hm("Homes sold (90d)", String(homesSold)));
    if (inventory != null) metricSuggestions.push(hm("Active inventory", String(inventory)));
  }
  if (hasFlood) {
    const fp = {
      sourceUrl: floodSourceUrl,
      sourceLabel: floodSourceCitation || "FEMA NFIP",
      freshnessToken,
    };
    metricSuggestions.push(
      {
        label: "Avg Annual Loss",
        suggestions: suggestionsForMetric({ metric: "avg annual loss", value: aal }, "env-swfl"),
        value: `$${aal.toLocaleString(undefined, { maximumFractionDigits: 0 })} / yr`,
        ...fp,
      },
      {
        label: "SWFL percentile rank",
        suggestions: suggestionsForMetric(
          { metric: "SWFL percentile rank", value: floodPct },
          "env-swfl",
        ),
        value: `${floodPct}th`,
        ...fp,
      },
    );
  }

  return (
    <div className="min-h-dvh bg-navy-dark font-sans text-white">
      {/* ── Search bar ───────────────────────────────────────────────────── */}
      <div className="zr-search-bar">
        <LocationSearchBox defaultValue={zip} />
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="zp-hero">
        <div className="zp-hero-inner">
          {shapeFound ? (
            <div
              className="zp-shape-wrap"
              style={
                {
                  "--zip-fill": fillColor,
                  "--zip-glow": fillColor.replace("rgb(", "rgba(").replace(")", ",0.45)"),
                } as React.CSSProperties
              }
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          ) : (
            <div className="zp-shape-placeholder" />
          )}

          <div className="zp-identity">
            <Link href="/" className="zp-nav-back">
              ← Back
            </Link>
            <div className="zp-eyebrow">{eyebrow}</div>
            <div className="zp-number">{zip}</div>
            {primaryPlace && <div className="zp-name">{primaryPlace}</div>}
            {res.county_names[0] && (
              <div className="zp-county">{res.county_names[0]} County, Florida</div>
            )}
            {asOf && <p className="mt-3 text-xs text-gray-500">As of {asOf}</p>}
          </div>
        </div>
      </section>

      {/* ── STATS BAR — 3 cells ──────────────────────────────────────────── */}
      <div className="zp-stats-bar">
        <div className="zp-stat-cell">
          <div className="zp-stat-label">Annual Flood Loss</div>
          <div className="zp-stat-value">{hasFlood ? fmtCurrency(aal) : "—"}</div>
          <div className="zp-stat-sub">FEMA NFIP avg/property</div>
          {floodRankPos !== null && (
            <div className="zp-stat-tag">
              #{floodRankPos} of {TOTAL_SWFL_ZIPS} ZIPs
            </div>
          )}
        </div>
        <div className="zp-stat-cell">
          <div className="zp-stat-label">Median Home Value</div>
          <div className="zp-stat-value">{price !== undefined ? fmtCurrency(price) : "—"}</div>
          <div className="zp-stat-sub">90-day median sale price</div>
          {valueRankPos !== null && (
            <div className="zp-stat-tag">
              #{valueRankPos} of {totalValueZips} ZIPs
            </div>
          )}
        </div>
        <div className="zp-stat-cell">
          <div className="zp-stat-label">New Permits (90d)</div>
          <div className="zp-stat-value">{hasPermits ? permitsCount.toLocaleString() : "—"}</div>
          <div className="zp-stat-sub">Lee County building permits</div>
          {permitsRankPos !== null && (
            <div className="zp-stat-tag">
              #{permitsRankPos} of {totalPermitsZips} ZIPs
            </div>
          )}
        </div>
      </div>

      {/* ── BODY: breakdown (left) + rail (right) ────────────────────────── */}
      <div className="zp-body">
        {/* LEFT — at a glance metric blocks */}
        <div className="zp-breakdown">
          {didYouMean && <DidYouMeanBanner message={didYouMean} />}
          <div className="zp-breakdown-header">
            <h1 className="zp-breakdown-title">{zip} at a glance</h1>
          </div>

          {hasFlood && (
            <div className="zp-metric-block">
              <div className="zp-metric-header">
                <div className="zp-metric-label">Annual Flood Loss</div>
                {floodRankPos !== null && (
                  <div className="zp-metric-rank">
                    #{floodRankPos} of {TOTAL_SWFL_ZIPS} ZIPs
                  </div>
                )}
              </div>
              <div className="zp-metric-value">{fmtCurrency(aal)}</div>
              <div className="zp-metric-sublabel">FEMA NFIP avg annual loss per property</div>
              <div className="zp-bar-track">
                <div className="zp-bar-fill zp-bar-fill--flood" style={{ width: `${floodPct}%` }} />
              </div>
              <div className="zp-percentile">{floodPct}th percentile</div>
            </div>
          )}

          {price !== undefined && (
            <div className="zp-metric-block">
              <div className="zp-metric-header">
                <div className="zp-metric-label">Median Home Value</div>
                {valueRankPos !== null && (
                  <div className="zp-metric-rank">
                    #{valueRankPos} of {totalValueZips} ZIPs
                  </div>
                )}
              </div>
              <div className="zp-metric-value">{fmtCurrency(price)}</div>
              <div className="zp-metric-sublabel">90-day median sale price</div>
              {valuePct !== null && (
                <>
                  <div className="zp-bar-track">
                    <div
                      className="zp-bar-fill zp-bar-fill--value"
                      style={{ width: `${valuePct}%` }}
                    />
                  </div>
                  <div className="zp-percentile">{valuePct}th percentile</div>
                </>
              )}
            </div>
          )}

          {hasPermits && (
            <div className="zp-metric-block">
              <div className="zp-metric-header">
                <div className="zp-metric-label">New Permits (90d)</div>
                {permitsRankPos !== null && (
                  <div className="zp-metric-rank">
                    #{permitsRankPos} of {totalPermitsZips} ZIPs
                  </div>
                )}
              </div>
              <div className="zp-metric-value">{permitsCount.toLocaleString()}</div>
              <div className="zp-metric-sublabel">Lee County building permits</div>
              {permitsPct !== null && (
                <>
                  <div className="zp-bar-track">
                    <div
                      className="zp-bar-fill zp-bar-fill--permits"
                      style={{ width: `${permitsPct}%` }}
                    />
                  </div>
                  <div className="zp-percentile">{permitsPct}th percentile</div>
                </>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — side rail */}
        <aside className="zp-rail">
          <div className="zp-rail-header">
            <div className="zp-rail-metric-name">Data Summary</div>
            <div className="zp-rail-sublabel">All three tracked metrics</div>
          </div>
          <div className="zp-rail-zip-header">
            <div className="zp-rail-zip-code">{zip}</div>
            {primaryPlace && <div className="zp-rail-place">{primaryPlace}</div>}
            {res.county_names[0] && (
              <div className="zp-rail-county">{res.county_names[0]} County</div>
            )}
          </div>

          {hasFlood && (
            <div className="zp-rail-metric-row zp-rail-metric-row--active">
              <div className="zp-rail-row-label">Annual Flood Loss</div>
              <div className="zp-rail-row-value">{fmtCurrency(aal)}</div>
              {floodRankPos !== null && (
                <div className="zp-rail-row-rank">
                  #{floodRankPos} of {TOTAL_SWFL_ZIPS} ZIPs
                </div>
              )}
              <div className="zp-mini-bar">
                <div
                  className="zp-mini-bar-fill zp-mini-bar-fill--flood"
                  style={{ width: `${floodPct}%` }}
                />
              </div>
            </div>
          )}

          {price !== undefined && (
            <div className="zp-rail-metric-row">
              <div className="zp-rail-row-label">Median Home Value</div>
              <div className="zp-rail-row-value">{fmtCurrency(price)}</div>
              {valueRankPos !== null && (
                <div className="zp-rail-row-rank">
                  #{valueRankPos} of {totalValueZips} ZIPs
                </div>
              )}
              <div className="zp-mini-bar">
                <div
                  className="zp-mini-bar-fill zp-mini-bar-fill--value"
                  style={{ width: `${valuePct ?? 0}%` }}
                />
              </div>
            </div>
          )}

          {hasPermits && (
            <div className="zp-rail-metric-row">
              <div className="zp-rail-row-label">New Permits (90d)</div>
              <div className="zp-rail-row-value">{permitsCount.toLocaleString()}</div>
              {permitsRankPos !== null && (
                <div className="zp-rail-row-rank">
                  #{permitsRankPos} of {totalPermitsZips} ZIPs
                </div>
              )}
              <div className="zp-mini-bar">
                <div
                  className="zp-mini-bar-fill zp-mini-bar-fill--permits"
                  style={{ width: `${permitsPct ?? 0}%` }}
                />
              </div>
            </div>
          )}

          <div className="zp-rail-footer">
            Sources: FEMA NFIP · housing-swfl brain · Lee County permits
          </div>
        </aside>
      </div>

      {/* ── Below body: unified data + dossier ───────────────────────────── */}
      <div className="mx-auto max-w-[1120px] px-10 pb-24 space-y-10">
        {/* Unified data grid — census + housing + flood, same card style */}
        {(summary.figures.length > 0 || hasHousing || hasFlood) && (
          <section id="section-data">
            <div className="grid gap-3 sm:grid-cols-2">
              {summary.figures.map((fig) => (
                <div
                  key={fig.key}
                  className="rounded-xl glass-card-modern border border-white/10 px-4 py-3"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {fig.label}
                  </p>
                  <p className="mt-1 font-mono text-lg font-semibold text-white">{fig.value}</p>
                  {fig.as_of && <p className="mt-0.5 text-xs text-gray-500">as of {fig.as_of}</p>}
                  <p className="mt-1 text-xs text-gray-600">{fig.source_label}</p>
                </div>
              ))}

              {hasHousing && (
                <>
                  <div className="rounded-xl glass-card-modern border border-white/10 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Median Sale Price
                    </p>
                    <p className="mt-1 font-mono text-lg font-semibold text-white">
                      ${(price as number).toLocaleString()}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">90-day window</p>
                    {priceBadge && (
                      <p className={`mt-1 text-xs ${priceColor}`}>{priceBadge.text}</p>
                    )}
                  </div>
                  <div className="rounded-xl glass-card-modern border border-white/10 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Days on Market
                    </p>
                    <p className="mt-1 font-mono text-lg font-semibold text-white">{dom}</p>
                    <p className="mt-0.5 text-xs text-gray-500">90-day window</p>
                    {domBadge && <p className={`mt-1 text-xs ${domColor}`}>{domBadge.text}</p>}
                  </div>
                  {saleToList != null && (
                    <div className="rounded-xl glass-card-modern border border-white/10 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        Sale-to-List Ratio
                      </p>
                      <p className="mt-1 font-mono text-lg font-semibold text-white">
                        {saleToList}%
                      </p>
                    </div>
                  )}
                  {mos != null && (
                    <div className="rounded-xl glass-card-modern border border-white/10 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        Months of Supply
                      </p>
                      <p className="mt-1 font-mono text-lg font-semibold text-white">{mos}</p>
                    </div>
                  )}
                  {homesSold != null && (
                    <div className="rounded-xl glass-card-modern border border-white/10 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        Homes Sold (90d)
                      </p>
                      <p className="mt-1 font-mono text-lg font-semibold text-white">{homesSold}</p>
                    </div>
                  )}
                  {inventory != null && (
                    <div className="rounded-xl glass-card-modern border border-white/10 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        Active Inventory
                      </p>
                      <p className="mt-1 font-mono text-lg font-semibold text-white">{inventory}</p>
                    </div>
                  )}
                </>
              )}

              {hasFlood && (
                <>
                  <div className="rounded-xl glass-card-modern border border-white/10 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Avg Annual Flood Loss
                    </p>
                    <p className="mt-1 font-mono text-lg font-semibold text-white">
                      ${aal.toLocaleString(undefined, { maximumFractionDigits: 0 })} / yr
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">FEMA NFIP per insured property</p>
                  </div>
                  <div className="rounded-xl glass-card-modern border border-white/10 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Flood Percentile
                    </p>
                    <p className="mt-1 font-mono text-lg font-semibold text-white">{floodPct}th</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      #{floodRankPos} of {TOTAL_SWFL_ZIPS} ZIPs in SWFL
                    </p>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {/* ── City / Corridor Area ───────────────────────────────────────── */}
        {cityLines.length > 0 && (
          <section id="section-city">
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

        {/* ── County ────────────────────────────────────────────────────── */}
        {countyLines.length > 0 && (
          <section id="section-county">
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

        {/* ── Southwest Florida ─────────────────────────────────────────── */}
        {(swflLines.length > 0 || metroTrend.data.length > 0) && (
          <section id="section-swfl">
            <SectionTitle>Southwest Florida</SectionTitle>
            {metroTrend.data.length > 0 && (
              <div className="mt-5">
                <MetroAreaChart
                  data={metroTrend.data}
                  series={SWFL_METRO_SERIES}
                  variant="area"
                  asOf={metroTrend.asOf}
                  eyebrow="Southwest Florida"
                  title="Median Home Value Trend"
                  subtitle="Cape Coral · Fort Myers · Naples"
                  valueFormat="usd"
                  rootId="zip-report-zhvi"
                />
              </div>
            )}
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

        <CitationList sources={sources} />
        <div>
          <DigestSubscribe source="zip-report" />
        </div>
        <ColorLegend />
        <ReportFooter freshnessToken={freshnessToken} />
      </div>

      {highlighterEnabled && (
        <ReportHighlightBridge
          reportId={buildReportId("zip", zip)}
          freshnessToken={freshnessToken}
          metricSuggestions={metricSuggestions}
        />
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function badgeColor(polarity: DirectionPolarity, isUp: boolean): string {
  if (polarity === "none") return "text-gray-400";
  if (polarity === "higher_is_bullish") return isUp ? "text-[#5bc97a]" : "text-[#e08158]";
  return isUp ? "text-[#e08158]" : "text-[#5bc97a]";
}

function stripStatAnnotation(text: string): string {
  return text.replace(/\s*\([^()]*:\s*[^()]+\)\s*$/, "");
}
