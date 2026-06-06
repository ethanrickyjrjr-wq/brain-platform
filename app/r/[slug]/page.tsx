import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import Image from "next/image";
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
    <div className="min-h-dvh bg-navy-dark font-sans text-white">
      <main className="mx-auto max-w-4xl px-6 py-12 sm:px-8 sm:py-16">
        <header className="border-b border-white/10 pb-6">
          <div className="flex items-center gap-2 text-gray-400">
            <Image
              src="/logo.png"
              alt="SWFL Data Gulf"
              width={28}
              height={28}
              className="h-7 w-7 rounded-lg"
            />
            <p className="text-xs uppercase tracking-wider">SWFL Data Gulf</p>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {display.title}
          </h1>
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
        </header>

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
            <h2 className="text-xl font-semibold tracking-tight text-white">
              Key metrics
            </h2>
            <div className="mt-4 overflow-x-auto rounded-xl glass-card-modern border border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-gray-400">
                  <tr>
                    <th className="px-4 py-3">Metric</th>
                    <th className="px-4 py-3 text-right">Value</th>
                    <th className="px-4 py-3">Direction</th>
                    <th className="px-4 py-3">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {display.metrics.map((m, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3 align-top font-medium text-white">
                        {m.label}
                      </td>
                      <td className="px-4 py-3 text-right align-top font-mono text-gray-200">
                        {m.value}
                      </td>
                      <td className="px-4 py-3 align-top text-gray-300">
                        {m.direction}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-gray-500">
                        <a
                          href={m.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#00d4aa] underline decoration-[#00d4aa]/40 underline-offset-2 hover:decoration-[#00d4aa]"
                        >
                          {m.sourceLabel}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {display.summaryCaveats.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight text-white">
              Worth knowing
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-gray-300">
              {display.summaryCaveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </section>
        )}

        {hasDetail && <SourcesGate sourceCount={display.metrics.length} />}

        <footer className="mt-12 border-t border-white/10 pt-6 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt=""
              width={16}
              height={16}
              className="h-4 w-4 rounded"
            />
            <span>
              SWFL Data Gulf Intelligence ·{" "}
              <code className="text-xs text-[#00d4aa]">
                {display.freshnessToken}
              </code>
            </span>
          </div>
        </footer>
      </main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
    </div>
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
      <h2 className="text-xl font-semibold tracking-tight text-white">
        Explore corridors
      </h2>
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

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-white">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm">
      <span className="text-xs text-gray-400">{label}: </span>
      <span className="font-mono text-white">{value}</span>
    </div>
  );
}

function RawFallback({ slug, content }: { slug: string; content: string }) {
  return (
    <div className="min-h-dvh bg-navy-dark font-sans text-white">
      <main className="mx-auto max-w-4xl px-6 py-12 sm:px-8 sm:py-16">
        <header className="border-b border-white/10 pb-6">
          <div className="flex items-center gap-2 text-gray-400">
            <Image
              src="/logo.png"
              alt="SWFL Data Gulf"
              width={28}
              height={28}
              className="h-7 w-7 rounded-lg"
            />
            <p className="text-xs uppercase tracking-wider">SWFL Data Gulf</p>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            {displayName(slug)}
          </h1>
          <p className="mt-3 text-sm text-gray-400">
            This read does not expose a structured summary yet. Showing the raw
            artifact.
          </p>
        </header>
        <pre className="mt-6 overflow-x-auto rounded-xl glass-card-modern border border-white/10 p-4 text-xs leading-5 text-gray-300">
          {content}
        </pre>
      </main>
    </div>
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
        <a
          href="/#waitlist"
          className="inline-flex items-center gap-2 btn-gradient text-navy-dark px-5 py-2 rounded-lg text-sm font-semibold"
        >
          Get access to unlock sources
        </a>
        <p className="mt-2 text-xs text-gray-600">
          {sourceCount} source{sourceCount !== 1 ? "s" : ""} + full provenance
          behind this read.
        </p>
      </div>
    </div>
  );
}
