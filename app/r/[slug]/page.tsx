import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  parseBrainMarkdown,
  toDisplayBrain,
  displayName,
  type DisplayBrain,
} from "../../../refinery/render/speaker.mts";
import {
  fetchVerifiedCorridorRows,
  toCorridorLinks,
} from "../cre-swfl/corridors";
import type { BrainOutputDirection } from "../../../refinery/types/brain-output.mts";
import { brainJsonLd } from "../../../lib/jsonld.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRAINS_DIR = path.join(process.cwd(), "brains");
const VALID_SLUG = /^[a-z0-9-]+$/;

async function loadDisplay(slug: string): Promise<DisplayBrain | null> {
  if (!VALID_SLUG.test(slug)) return null;
  try {
    const content = await readFile(
      path.join(BRAINS_DIR, `${slug}.md`),
      "utf-8",
    );
    return toDisplayBrain(parseBrainMarkdown(content));
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const display = await loadDisplay(slug);
  if (!display) return { title: displayName(slug) };
  const firstSentence =
    display.conclusion?.split(/(?<=[.!?])\s+/)[0]?.slice(0, 200) ??
    display.scope?.slice(0, 200) ??
    undefined;
  return {
    title: display.title,
    description: firstSentence,
  };
}

const DIRECTION_BADGE: Record<BrainOutputDirection, string> = {
  bullish:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  bearish: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
  mixed: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  neutral: "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
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
    <div className="min-h-dvh bg-white font-sans text-zinc-900">
      <main className="mx-auto max-w-4xl px-6 py-12 sm:px-8 sm:py-16">
        <header className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <WaveMark />
            <p className="text-xs uppercase tracking-wider">SWFL Data Gulf</p>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {display.title}
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-zinc-700 dark:text-zinc-300">
            {display.scope}
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Meta
              label="Freshness"
              value={<code className="text-xs">{display.freshnessToken}</code>}
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
          <p className="mt-6 text-lg leading-8 text-zinc-800 dark:text-zinc-200">
            {display.conclusion}
          </p>
        </section>

        {/* Corridor index — cre-swfl only. The DB read lives inside this async
            component, so it never fires on any other brain's report. */}
        {slug === "cre-swfl" && <CorridorIndex />}

        {display.metrics.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">
              Key metrics
            </h2>
            <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-100 text-xs uppercase tracking-wider text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="px-4 py-3">Metric</th>
                    <th className="px-4 py-3 text-right">Value</th>
                    <th className="px-4 py-3">Direction</th>
                    <th className="px-4 py-3">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {display.metrics.map((m, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3 align-top font-medium">
                        {m.label}
                      </td>
                      <td className="px-4 py-3 text-right align-top font-mono">
                        {m.value}
                      </td>
                      <td className="px-4 py-3 align-top">{m.direction}</td>
                      <td className="px-4 py-3 align-top text-xs text-zinc-600 dark:text-zinc-400">
                        <a
                          href={m.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-700 dark:decoration-zinc-600 dark:hover:decoration-zinc-300"
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
            <h2 className="text-xl font-semibold tracking-tight">
              Worth knowing
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-zinc-700 dark:text-zinc-300">
              {display.summaryCaveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </section>
        )}

        {hasDetail && (
          <details className="mt-10 rounded-lg border border-zinc-200 dark:border-zinc-800">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100">
              Full detail — every source and note
            </summary>
            <div className="space-y-6 px-4 pb-5 pt-1">
              {display.metrics.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Sources
                  </h3>
                  <ul className="mt-2 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {display.metrics.map((m, i) => (
                      <li key={i}>
                        <a
                          href={m.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-700 dark:decoration-zinc-600"
                        >
                          {m.label}
                        </a>
                        <span className="text-zinc-500 dark:text-zinc-400">
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
                  <h3 className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    More notes
                  </h3>
                  <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-zinc-700 dark:text-zinc-300">
                    {display.detailCaveats.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        )}

        <footer className="mt-12 border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <div className="flex items-center gap-2">
            <WaveMark />
            <span>
              SWFL Data Gulf Intelligence ·{" "}
              <code className="text-xs">{display.freshnessToken}</code>
            </span>
          </div>
          <p className="mt-2">
            <a
              href={`/api/b/${slug}`}
              className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200"
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

/**
 * cre-swfl corridor index — a clickable directory of every corridor that has a
 * live drill-down page. Sourced from `fetchVerifiedCorridorRows()` (the exact
 * query the drill-down route resolves against), so every link is guaranteed to
 * resolve. Rendered only when slug === "cre-swfl"; the DB read is scoped here.
 */
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
      <h2 className="text-xl font-semibold tracking-tight">
        Explore corridors
      </h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {links.length} verified corridors — open one for its metrics, active
        intel, and area context.
      </p>
      <div className="mt-4 space-y-5">
        {[...byCounty.entries()].map(([county, items]) => (
          <div key={county}>
            <h3 className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {county === "Unknown" ? "Other SWFL" : `${county} County`}
            </h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {items.map((l) => (
                <li key={l.slug}>
                  <Link
                    href={`/r/cre-swfl/${l.slug}`}
                    className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm text-zinc-700 hover:border-sky-300 hover:text-sky-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-sky-700 dark:hover:text-sky-300"
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

/** The 3-wave SWFL Data Gulf mark — inline, decorative, never a link. */
function WaveMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 28 18"
      className="h-4 w-6 text-sky-500"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M1 5c3.5-4 7-4 10.5 0S18.5 9 22 5s4.5-1 5 0" />
      <path d="M1 10c3.5-4 7-4 10.5 0S18.5 14 22 10s4.5-1 5 0" />
      <path d="M1 15c3.5-4 7-4 10.5 0S18.5 19 22 15s4.5-1 5 0" />
    </svg>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {label}:{" "}
      </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function RawFallback({ slug, content }: { slug: string; content: string }) {
  return (
    <div className="min-h-dvh bg-white font-sans text-zinc-900">
      <main className="mx-auto max-w-4xl px-6 py-12 sm:px-8 sm:py-16">
        <header className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <WaveMark />
            <p className="text-xs uppercase tracking-wider">SWFL Data Gulf</p>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {displayName(slug)}
          </h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            This read does not expose a structured summary yet. Showing the raw
            artifact.
          </p>
        </header>
        <pre className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-4 text-xs leading-5 dark:border-zinc-800 dark:bg-zinc-900">
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
