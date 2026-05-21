import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import {
  parseBrainMarkdown,
  type ParsedBrain,
} from "../../../refinery/render/speaker.mts";
import type {
  BrainOutputDirection,
  BrainOutputMetric,
} from "../../../refinery/types/brain-output.mts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRAINS_DIR = path.join(process.cwd(), "brains");
const VALID_SLUG = /^[a-z0-9-]+$/;

const DIRECTION_BADGE: Record<BrainOutputDirection, string> = {
  bullish:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  bearish: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
  mixed: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  neutral: "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
};

const EDGE_TYPE_LABEL: Record<string, string> = {
  input: "input",
  constraint: "constraint",
  veto: "veto",
  modifier: "modifier",
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

  let brain: ParsedBrain;
  try {
    brain = parseBrainMarkdown(content);
  } catch {
    return <RawFallback slug={slug} content={content} />;
  }

  const out = brain.output;

  return (
    <div className="min-h-dvh bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-100">
      <main className="mx-auto max-w-4xl px-6 py-12 sm:px-8 sm:py-16">
        <header className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
          <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Brain Report
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {brain.brain_id}
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-zinc-700 dark:text-zinc-300">
            {brain.scope}
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Meta
              label="Freshness"
              value={<code className="text-xs">{brain.freshness_token}</code>}
            />
            <Meta label="Version" value={`v${brain.version}`} />
            <Meta label="Refined" value={formatDate(brain.refined_at)} />
            <Meta label="Trust tier" value={`T${out.trust_tier}`} />
          </dl>
        </header>

        <section className="mt-8">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${DIRECTION_BADGE[out.direction]}`}
            >
              {out.direction}
            </span>
            <Stat
              label="Magnitude"
              value={`${Math.round(out.magnitude * 100)}%`}
            />
            <Stat
              label="Confidence"
              value={`${Math.round(out.confidence * 100)}%`}
            />
            <Stat label="Upstream count" value={String(out.upstream_count)} />
            <Stat label="Chain depth" value={String(out.chain_depth)} />
          </div>
          <p className="mt-6 text-lg leading-8 text-zinc-800 dark:text-zinc-200">
            {out.conclusion}
          </p>
        </section>

        {out.key_metrics.length > 0 && (
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
                    <th className="px-4 py-3">Tier</th>
                    <th className="px-4 py-3">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {out.key_metrics.map((m) => (
                    <tr key={m.metric}>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium">{m.label}</div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {m.metric}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right align-top font-mono">
                        {displayValue(m)}
                      </td>
                      <td className="px-4 py-3 align-top">{m.direction}</td>
                      <td className="px-4 py-3 align-top">T{m.source.tier}</td>
                      <td className="px-4 py-3 align-top text-xs text-zinc-600 dark:text-zinc-400">
                        <a
                          href={m.source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-700 dark:decoration-zinc-600 dark:hover:decoration-zinc-300"
                        >
                          {m.source.citation}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {out.caveats.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">Caveats</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-zinc-700 dark:text-zinc-300">
              {out.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </section>
        )}

        {out.drivers.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">
              Upstream drivers
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {out.drivers.map((d) => (
                <li
                  key={d.brain_id}
                  className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {EDGE_TYPE_LABEL[d.edge_type] ?? d.edge_type}
                  </span>
                  <span>{d.brain_id}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {out.contradicts.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">
              Contradictions
            </h2>
            <ul className="mt-3 list-disc space-y-1 pl-6 text-zinc-700 dark:text-zinc-300">
              {out.contradicts.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </section>
        )}

        {out.overrides.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">
              Overrides fired
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {out.overrides.map((o) => (
                <li
                  key={o}
                  className="inline-flex items-center rounded-md bg-amber-100 px-2.5 py-1 font-mono text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                >
                  {o}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-12 border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <p>
            Raw audit:{" "}
            <a
              href={`/api/b/${brain.brain_id}`}
              className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              /api/b/{brain.brain_id}
            </a>
            {" · "}
            Speaker (tier 1):{" "}
            <a
              href={`/api/b/${brain.brain_id}?view=speak&tier=1`}
              className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              ?view=speak&amp;tier=1
            </a>
            {" · "}
            <a
              href={`/api/b/${brain.brain_id}?view=speak&tier=2`}
              className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              tier=2
            </a>
          </p>
        </footer>
      </main>
    </div>
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
    <div className="min-h-dvh bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-100">
      <main className="mx-auto max-w-4xl px-6 py-12 sm:px-8 sm:py-16">
        <header className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
          <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Brain Report (raw)
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{slug}</h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            This brain does not expose a structured OUTPUT block. Showing the
            raw artifact.
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

function displayValue(m: BrainOutputMetric): string {
  if (typeof m.value === "string") return m.value;
  const v = m.value;
  switch (m.display_format) {
    case "currency":
      return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    case "percent":
      return v <= 1 && v >= -1
        ? `${(v * 100).toFixed(2)}%`
        : `${v.toFixed(2)}%`;
    case "count":
      return v.toLocaleString("en-US");
    case "ratio":
      return v.toFixed(2);
    default:
      return String(v);
  }
}
