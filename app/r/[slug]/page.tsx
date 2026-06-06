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
import {
  fetchVerifiedCorridorRows,
  toCorridorLinks,
} from "../cre-swfl/corridors";
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
    const content = await readFile(
      path.join(BRAINS_DIR, `${slug}.md`),
      "utf-8",
    );
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

  let display: DisplayBrain;
  try {
    display = toDisplayBrain(parseBrainMarkdown(content));
  } catch {
    return <RawFallback slug={slug} content={content} />;
  }

  const hasDetail =
    display.detailCaveats.length > 0 || display.metrics.length > 0;
  const ld = brainJsonLd(display, slug);

  return (
    <ReportShell>
      <ReportHeader title={display.title}>
        <p className="mt-3 max-w-3xl text-base leading-7 text-gray-300">
          {display.scope}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Meta
            label="Freshness"
            value={
              <code className="text-xs text-[#00d4aa]">
                {display.freshnessToken}
              </code>
            }
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
        </div>
        <p className="mt-6 text-lg leading-8 text-gray-200">
          {display.conclusion}
        </p>
      </section>

      {slug === "cre-swfl" && <CorridorIndex />}

      {display.metrics.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Key metrics</SectionTitle>
          <MetricsTable
            metrics={display.metrics.map((m) => ({
              label: m.label,
              value: m.value,
              direction: m.direction,
              sourceUrl: m.sourceUrl,
              sourceLabel: m.sourceLabel,
            }))}
          />
        </section>
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

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
    </ReportShell>
  );
}

async function CorridorIndex() {
  const links = toCorridorLinks(await fetchVerifiedCorridorRows());
  if (links.length === 0) return null;

  const byCounty = new Map<string, typeof links>();
  for (const l of links) {
    const arr = byCounty.get(l.county) ?? [];
    arr.push(l);
    byCounty.set(l.county, arr);
  }

  return (
    <section className="mt-10">
      <SectionTitle>Explore corridors</SectionTitle>
      <p className="mt-1 text-sm text-gray-400">
        {links.length} verified corridors — open one for its metrics, active
        intel, and area context.
      </p>
      <div className="mt-4 space-y-5">
        {[...byCounty.entries()].map(([county, items]) => (
          <div key={county}>
            <h3 className="text-xs uppercase tracking-wider text-gray-400">
              {county === "Unknown" ? "Other SWFL" : `${county} County`}
            </h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {items.map((l) => (
                <li key={l.slug}>
                  <Link
                    href={`/r/cre-swfl/${l.slug}`}
                    className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-gray-300 transition-colors hover:border-[#00d4aa]/50 hover:text-[#00d4aa]"
                  >
                    {l.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function RawFallback({ slug, content }: { slug: string; content: string }) {
  return (
    <ReportShell>
      <ReportHeader title={displayName(slug)}>
        <p className="mt-3 text-sm text-gray-400">
          This read does not expose a structured summary yet. Showing the raw
          artifact.
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
        <p className="text-xs uppercase tracking-wider text-gray-600 mb-2">
          Sources
        </p>
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
          {sourceCount} source{sourceCount !== 1 ? "s" : ""} + full provenance
          behind this read.
        </p>
      </div>
    </div>
  );
}
