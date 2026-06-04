import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import Image from "next/image";
import { parseBrainMarkdown } from "../../../../refinery/render/speaker.mts";
import {
  resolveGradeConfig,
  type DirectionPolarity,
} from "../../../../refinery/vocab/loader.mts";

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

/**
 * Compute badge text + polarity for a YoY-style delta.
 * Polarity is resolved from the vocab — never hardcoded.
 * Returns null when delta is absent so callers can skip the badge entirely.
 */
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

  // Housing is required — 404 on failure
  let housing: Awaited<ReturnType<typeof loadBrain>>;
  try {
    housing = await loadBrain("housing-swfl");
  } catch {
    notFound();
  }

  // Env is optional — flood section hidden on failure, not a hard error
  let env: Awaited<ReturnType<typeof loadBrain>> | null = null;
  try {
    env = await loadBrain("env-swfl");
  } catch {
    // env brain unavailable — flood section will be hidden via hasFlood
  }

  // Housing row — 404 if this ZIP is absent from the brain
  const housingTable = housing.output.detail_tables?.find(
    (t) => t.id === "housing_by_zip",
  );
  const housingRow = housingTable?.rows.find((r) => r.key === zip);
  if (!housingRow) notFound();

  const price = housingRow.cells["median_sale_price"] as number;
  const priceYoy = housingRow.cells["median_sale_price_yoy_pct"] as
    | number
    | null;
  const dom = housingRow.cells["median_dom"] as number;
  const domYoy = housingRow.cells["median_dom_yoy_days"] as number | null;
  const saleToList = housingRow.cells["avg_sale_to_list_pct"] as number | null;
  const mos = housingRow.cells["months_of_supply"] as number | null;
  const homesSold = housingRow.cells["homes_sold"] as number | null;
  const inventory = housingRow.cells["inventory"] as number | null;

  // Flood metrics — section silently hidden for inland ZIPs with no NFIP data
  const floodMetric = env?.output.key_metrics.find(
    (m) => m.metric === `swfl_zip_${zip}_flood_aal_usd_per_insured_property`,
  );
  const rankMetric = env?.output.key_metrics.find(
    (m) => m.metric === `swfl_zip_${zip}_flood_aal_pct_swfl_rank`,
  );
  const hasFlood = floodMetric !== undefined && rankMetric !== undefined;

  // Badges — polarity from vocab, never hardcoded
  const priceBadge = deltaForSlug(
    "median_sale_price_yoy_pct",
    priceYoy,
    "% YoY",
  );
  const domBadge = deltaForSlug("median_dom_yoy_days", domYoy, " days");

  // Local consts to avoid TS non-null assertion inside JSX when hasFlood is true
  const aal = hasFlood
    ? ((floodMetric as NonNullable<typeof floodMetric>).value as number)
    : 0;
  const rank = hasFlood
    ? Math.round((rankMetric as NonNullable<typeof rankMetric>).value as number)
    : 0;
  const floodSourceUrl = hasFlood
    ? (floodMetric as NonNullable<typeof floodMetric>).source.url
    : "";
  const floodSourceCitation = hasFlood
    ? (floodMetric as NonNullable<typeof floodMetric>).source.citation
    : "";

  return (
    <div className="min-h-dvh bg-white font-sans text-zinc-900">
      <main className="mx-auto max-w-2xl px-6 py-12 sm:px-8 sm:py-16">
        {/* Header */}
        <header className="border-b border-zinc-200 pb-6">
          <div className="flex items-center gap-2 text-zinc-500">
            <Image
              src="/logo.png"
              alt="SWFL Data Gulf"
              width={16}
              height={16}
              className="h-4 w-4"
            />
            <p className="text-xs uppercase tracking-wider">SWFL Data Gulf</p>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            ZIP {zip} — Housing &amp; Flood Risk Report
          </h1>
          <dl className="mt-4 flex flex-wrap gap-5 text-sm">
            <Meta
              label="Freshness"
              value={<code className="text-xs">{housing.freshness_token}</code>}
            />
            <Meta label="Updated" value={formatDate(housing.refined_at)} />
          </dl>
        </header>

        {/* Housing Market */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Housing Market
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            housing-swfl · 90-day window
          </p>
          <dl className="mt-4 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            <DataRow
              label="Median sale price"
              value={`$${price.toLocaleString()}`}
              badge={priceBadge}
            />
            <DataRow
              label="Days on market"
              value={String(dom)}
              badge={domBadge}
            />
            {saleToList != null && (
              <DataRow label="Sale-to-list ratio" value={`${saleToList}%`} />
            )}
            {mos != null && (
              <DataRow label="Months of supply" value={String(mos)} />
            )}
            {homesSold != null && (
              <DataRow label="Homes sold (90d)" value={String(homesSold)} />
            )}
            {inventory != null && (
              <DataRow label="Active inventory" value={String(inventory)} />
            )}
          </dl>
        </section>

        {/* Flood Risk */}
        {hasFlood && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Flood Risk
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              env-swfl · NFIP 10-yr average annual loss
            </p>
            <dl className="mt-4 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
              <DataRow
                label="Avg Annual Loss"
                value={`$${aal.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })} / yr per insured property`}
              />
              <DataRow label="SWFL percentile rank" value={`${rank}th`} />
              <div className="flex items-start justify-between px-4 py-3 text-sm">
                <dt className="text-zinc-500">Source</dt>
                <dd className="ml-4 text-right text-xs text-zinc-600">
                  <a
                    href={floodSourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-sky-700"
                  >
                    {floodSourceCitation}
                  </a>
                </dd>
              </div>
            </dl>
          </section>
        )}

        {/* Price CTA */}
        <div className="mt-10 rounded-lg border border-zinc-200 bg-zinc-50 px-6 py-6">
          <p className="text-center text-sm font-medium text-zinc-700">
            Get this for any SWFL ZIP
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-6 text-sm text-zinc-600">
            <span>
              One-time report{" "}
              <span className="font-semibold text-zinc-900">$39</span>
            </span>
            <span>
              Weekly updates{" "}
              <span className="font-semibold text-zinc-900">$79/mo</span>
            </span>
          </div>
          <div className="mt-4 flex justify-center">
            <a
              href={`mailto:support@swfldatagulf.com?subject=ZIP%20Report%20${zip}`}
              className="inline-flex items-center rounded-md bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              Order this report
            </a>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-10 border-t border-zinc-200 pt-6 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="SWFL Data Gulf"
              width={16}
              height={16}
              className="h-4 w-4"
            />
            <span>
              SWFL Data Gulf ·{" "}
              <code className="text-xs">{housing.freshness_token}</code>
            </span>
          </div>
          <p className="mt-2 flex flex-wrap gap-3">
            <span>Raw data:</span>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/b/housing-swfl"
              className="underline underline-offset-2 hover:text-zinc-700"
            >
              /api/b/housing-swfl
            </a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/b/env-swfl"
              className="underline underline-offset-2 hover:text-zinc-700"
            >
              /api/b/env-swfl
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}

// ── Helper components ──────────────────────────────────────────────────────

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-zinc-900">{value}</dd>
    </div>
  );
}

/**
 * Badge color derived from direction_polarity (vocab source of truth):
 *   higher_is_bullish + up   → emerald (good)
 *   higher_is_bullish + down → rose    (bad)
 *   lower_is_bullish  + up   → rose    (bad)
 *   lower_is_bullish  + down → emerald (good)
 *   none / invalid           → zinc    (neutral — no directional assertion)
 */
function badgeColor(polarity: DirectionPolarity, isUp: boolean): string {
  if (polarity === "none") return "text-zinc-500";
  if (polarity === "higher_is_bullish") {
    return isUp ? "text-emerald-600" : "text-rose-600";
  }
  // lower_is_bullish
  return isUp ? "text-rose-600" : "text-emerald-600";
}

function DataRow({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: {
    text: string;
    polarity: DirectionPolarity;
    isUp: boolean;
  } | null;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="flex items-center gap-2 text-right font-mono text-zinc-900">
        {value}
        {badge && (
          <span
            className={`font-sans text-xs ${badgeColor(badge.polarity, badge.isUp)}`}
          >
            {badge.text}
          </span>
        )}
      </dd>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
