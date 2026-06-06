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
  bullish: "bg-emerald-900/40 text-emerald-400 border border-emerald-700/30",
  bearish: "bg-rose-900/40 text-rose-400 border border-rose-700/30",
  mixed: "bg-amber-900/40 text-amber-400 border border-amber-700/30",
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

        {hasDetail && (
          <details className="mt-10 rounded-xl glass-card-modern border border-white/10">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-300 hover:text-white">
              Full detail — every source and note
            </summary>
            <div className="space-y-6 px-4 pb-5 pt-1">
              {display.metrics.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-gray-400">
                    Sources
                  </h3>
                  <ul className="mt-2 space-y-2 text-sm text-gray-300">
                    {display.metrics.map((m, i) => (
                      <li key={i}>
                        <a
                          href={m.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#00d4aa] underline decoration-[#00d4aa]/40 underline-offset-2 hover:decoration-[#00d4aa]"
                        >
                          {m.label}
                        </a>
                        <span className="text-gray-500">
                          {" "}
                          — {m.sourceFull}{" "}
                          <span className="text-xs">
                            ({formatDate(m.fetchedAt)})
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {display.detailCaveats.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-gray-400">
                    More notes
                  </h3>
                  <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-gray-300">
                    {display.detailCaveats.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        )}

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
          <p className="mt-2">
            <a
              href={`/api/b/${slug}`}
              className="text-[#00d4aa] underline underline-offset-2 hover:text-[#00d4aa]/80"
            >
              Raw data
            </a>
          </p>
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
