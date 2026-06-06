import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { parseBrainMarkdown } from "../../../../refinery/render/speaker.mts";
import {
  corridorKey,
  displayNameFor,
} from "../../../../refinery/lib/corridor-display.mts";
import {
  normalizeCorridor,
  type CorridorNormalized,
} from "../../../../refinery/sources/cre-source.mts";
import { fetchVerifiedCorridorRows } from "../corridors";
import { corridorJsonLd } from "../../../../lib/jsonld.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRAINS_DIR = path.join(process.cwd(), "brains");
const VALID_SLUG = /^[a-z0-9-]+$/;

interface PageProps {
  params: Promise<{ corridor: string }>;
}

async function loadData(slug: string): Promise<{
  corridor: CorridorNormalized;
  freshnessToken: string;
} | null> {
  if (!VALID_SLUG.test(slug)) return null;

  let freshnessToken = "";
  try {
    const md = await readFile(path.join(BRAINS_DIR, "cre-swfl.md"), "utf-8");
    freshnessToken = parseBrainMarkdown(md).freshness_token;
  } catch {
    /* brain unavailable — proceed without token */
  }

  const data = await fetchVerifiedCorridorRows();
  const row = data.find(
    (r) => corridorKey(String(r.corridor_name ?? "")) === slug,
  );
  if (!row) return null;

  return { corridor: normalizeCorridor(row), freshnessToken };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { corridor } = await params;
  const d = await loadData(corridor);
  const name = d
    ? (d.corridor.display_name ?? displayNameFor(d.corridor.name))
    : displayNameFor(corridor);
  return {
    title: `${name} — SWFL Commercial Real Estate`,
    description:
      d?.corridor.character_facts
        ?.replace(/\[(?:internal|web)-\d+\]/g, "")
        .slice(0, 200) ?? undefined,
  };
}

export default async function CorridorPage({ params }: PageProps) {
  const { corridor } = await params;
  if (!VALID_SLUG.test(corridor)) notFound();

  const d = await loadData(corridor);
  if (!d) notFound();

  const { corridor: c, freshnessToken } = d;
  const displayN = c.display_name ?? displayNameFor(c.name);
  const metrics = buildMetricRows(c);
  const ld = corridorJsonLd(c, freshnessToken, displayN);

  return (
    <div className="min-h-dvh bg-navy-dark font-sans text-white">
      <main className="mx-auto max-w-4xl px-6 py-12 sm:px-8 sm:py-16">
        {/* Back nav */}
        <nav className="mb-6">
          <Link
            href="/r/cre-swfl"
            className="text-xs text-gray-400 transition-colors hover:text-white"
          >
            ← Commercial Real Estate
          </Link>
        </nav>

        {/* Header */}
        <header className="border-b border-white/10 pb-6">
          <div className="flex items-center gap-2 text-gray-400">
            <WaveMark />
            <p className="text-xs uppercase tracking-wider">SWFL Data Gulf</p>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {displayN}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip>{c.city}</Chip>
            <Chip>{c.county} County</Chip>
            {c.corridor_type && <Chip>{formatType(c.corridor_type)}</Chip>}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {c.metrics_period && (
              <Meta label="Period" value={c.metrics_period} />
            )}
            {freshnessToken && (
              <Meta
                label="Freshness"
                value={
                  <code className="text-xs text-[#00d4aa]">
                    {freshnessToken}
                  </code>
                }
              />
            )}
            {c.metrics_verified_date && (
              <Meta
                label="Verified"
                value={c.metrics_verified_date.slice(0, 10)}
              />
            )}
          </dl>
        </header>

        {/* Key metrics */}
        {metrics.length > 0 && (
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
                    <th className="px-4 py-3">Trend</th>
                    <th className="px-4 py-3">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {metrics.map((m, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3 font-medium text-white">
                        {m.label}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-200">
                        {m.value}
                      </td>
                      <td className="px-4 py-3">
                        <DirectionBadge direction={m.direction} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {m.sourceUrl ? (
                          <a
                            href={m.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#00d4aa] underline decoration-[#00d4aa]/40 underline-offset-2 hover:decoration-[#00d4aa]"
                          >
                            Source
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Active intel */}
        {c.flags.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight text-white">
              Active intel
            </h2>
            <ul className="mt-4 space-y-3">
              {c.flags.map((f, i) => (
                <li key={i} className="flex items-start gap-3">
                  <FlagTypeBadge type={f.type} />
                  <span className="text-sm text-gray-200">
                    {f.flag}
                    {f.status && (
                      <span className="ml-1 text-xs text-gray-500">
                        ({f.status})
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Area context */}
        {c.character_render && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight text-white">
              Area context
            </h2>
            <div className="mt-4 space-y-4 text-sm leading-7 text-gray-300">
              {stripCitations(c.character_render)
                .split(/\n\n+/)
                .filter((p) => p.trim().length > 0)
                .map((para, i) => (
                  <p key={i}>{para.trim()}</p>
                ))}
            </div>
          </section>
        )}

        {/* Web citations */}
        <WebCitations citations={c.character_citations} />

        {/* Footer */}
        <footer className="mt-12 border-t border-white/10 pt-6 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <WaveMark />
            <span>
              SWFL Data Gulf Intelligence
              {freshnessToken && (
                <>
                  {" · "}
                  <code className="text-xs text-[#00d4aa]">
                    {freshnessToken}
                  </code>
                </>
              )}
            </span>
          </div>
          <p className="mt-2">
            <Link
              href="/r/cre-swfl"
              className="text-[#00d4aa] underline underline-offset-2 hover:text-[#00d4aa]/80"
            >
              All SWFL commercial areas
            </Link>
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatType(t: string): string {
  return t.replace(/-/g, " ");
}

function stripCitations(text: string): string {
  return text.replace(/\[(?:internal|web)-\d+\]/g, "");
}

interface MetricRow {
  label: string;
  value: string;
  direction: string | null;
  sourceUrl: string | null;
}

function buildMetricRows(c: CorridorNormalized): MetricRow[] {
  const rows: MetricRow[] = [];
  if (c.cap_rate_pct !== null) {
    rows.push({
      label: "Cap rate",
      value: `${c.cap_rate_pct.toFixed(1)}%`,
      direction: c.cap_rate_direction,
      sourceUrl: c.cap_rate_source_url ?? c.source_url,
    });
  }
  if (c.vacancy_rate_pct !== null) {
    rows.push({
      label: "Vacancy",
      value: `${c.vacancy_rate_pct.toFixed(1)}%`,
      direction: c.vacancy_rate_direction,
      sourceUrl: c.vacancy_rate_source_url ?? c.source_url,
    });
  }
  if (c.absorption_sqft !== null) {
    rows.push({
      label: "Net absorption",
      value: `${c.absorption_sqft >= 0 ? "+" : ""}${c.absorption_sqft.toLocaleString()} sf`,
      direction: c.absorption_sqft_direction,
      sourceUrl: c.absorption_sqft_source_url ?? c.source_url,
    });
  }
  if (c.asking_rent_psf !== null) {
    rows.push({
      label: "Asking rent (NNN)",
      value: `$${c.asking_rent_psf.toFixed(2)}/sf`,
      direction: c.asking_rent_psf_direction,
      sourceUrl: c.asking_rent_psf_source_url ?? c.source_url,
    });
  }
  return rows;
}

interface WebCitation {
  ref?: string;
  url?: string;
  title?: string;
}

function parseWebCitations(raw: unknown): WebCitation[] {
  if (raw == null || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const web = obj.web;
  if (!Array.isArray(web)) return [];
  return web
    .filter(
      (w): w is Record<string, unknown> => w != null && typeof w === "object",
    )
    .map((w) => ({
      ref: typeof w.ref === "string" ? w.ref : undefined,
      url: typeof w.url === "string" ? w.url : undefined,
      title: typeof w.title === "string" ? w.title : undefined,
    }))
    .filter((w) => w.url);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function WaveMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 28 18"
      className="h-4 w-6 text-[#00d4aa]"
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
      <dt className="text-xs uppercase tracking-wider text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-white">{value}</dd>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-xs text-gray-300">
      {children}
    </span>
  );
}

const DIRECTION_CONFIG: Record<string, { label: string; className: string }> = {
  rising: { label: "↑ Rising", className: "text-emerald-400" },
  falling: { label: "↓ Falling", className: "text-rose-400" },
  stable: { label: "→ Stable", className: "text-gray-400" },
};

function DirectionBadge({ direction }: { direction: string | null }) {
  if (!direction) return <span className="text-gray-600">—</span>;
  const cfg = DIRECTION_CONFIG[direction];
  if (!cfg) return <span className="text-gray-400">{direction}</span>;
  return (
    <span className={`text-xs font-medium ${cfg.className}`}>{cfg.label}</span>
  );
}

const FLAG_TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  new_project: {
    label: "New project",
    className: "bg-sky-900/40 text-sky-300",
  },
  infrastructure: {
    label: "Infrastructure",
    className: "bg-violet-900/40 text-violet-300",
  },
  construction: {
    label: "Construction",
    className: "bg-amber-900/40 text-amber-300",
  },
  regulatory: {
    label: "Regulatory",
    className: "bg-rose-900/40 text-rose-300",
  },
  status_update: {
    label: "Status",
    className: "bg-white/[0.06] text-gray-300",
  },
};

function FlagTypeBadge({ type }: { type: string }) {
  const cfg = FLAG_TYPE_CONFIG[type] ?? {
    label: type.replace(/_/g, " "),
    className: "bg-white/[0.06] text-gray-300",
  };
  return (
    <span
      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

function WebCitations({ citations }: { citations: unknown }) {
  const items = parseWebCitations(citations);
  if (items.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight text-white">
        Sources
      </h2>
      <ul className="mt-3 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-sm">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00d4aa] underline decoration-[#00d4aa]/40 underline-offset-2 hover:decoration-[#00d4aa]"
            >
              {item.title ?? item.url}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
