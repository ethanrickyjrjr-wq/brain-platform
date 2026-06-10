import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { parseBrainMarkdown } from "../../../../refinery/render/speaker.mts";
import { corridorKey, displayNameFor } from "../../../../refinery/lib/corridor-display.mts";
import {
  normalizeCorridor,
  type CorridorNormalized,
} from "../../../../refinery/sources/cre-source.mts";
import { fetchVerifiedCorridorRows } from "../corridors";
import { corridorJsonLd } from "../../../../lib/jsonld.ts";
import {
  ReportShell,
  ReportHeader,
  ReportFooter,
  SectionTitle,
  Meta,
  Chip,
} from "../../_components/report-shell";
import { MetricsTable, type MetricRow } from "../../_components/metrics-table";
import { ColorLegend } from "../../_components/color-legend";
import { HighlighterLayer } from "../../../../components/highlighter/HighlighterLayer";
import { HighlighterProvider } from "../../../../lib/highlighter/context";
import { highlighterUiEnabled } from "../../../../lib/highlighter/flag";

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
  const row = data.find((r) => corridorKey(String(r.corridor_name ?? "")) === slug);
  if (!row) return null;

  return { corridor: normalizeCorridor(row), freshnessToken };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { corridor } = await params;
  const d = await loadData(corridor);
  const name = d
    ? (d.corridor.display_name ?? displayNameFor(d.corridor.name))
    : displayNameFor(corridor);
  return {
    title: `${name} — SWFL Commercial Real Estate`,
    description:
      d?.corridor.character_facts?.replace(/\[(?:internal|web)-\d+\]/g, "").slice(0, 200) ??
      undefined,
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
  const highlighterEnabled = highlighterUiEnabled();

  const pageContent = (
    <>
      <nav className="mb-6">
        <Link
          href="/r/cre-swfl"
          className="text-xs text-gray-400 transition-colors hover:text-white"
        >
          ← Commercial Real Estate
        </Link>
      </nav>

      <ReportHeader title={displayN}>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip>{c.city}</Chip>
          <Chip>{c.county} County</Chip>
          {c.corridor_type && <Chip>{formatType(c.corridor_type)}</Chip>}
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          {c.metrics_period && <Meta label="Period" value={c.metrics_period} />}
          {freshnessToken && (
            <Meta
              label="Freshness"
              value={<code className="text-xs text-[#00d4aa]">{freshnessToken}</code>}
            />
          )}
          {c.metrics_verified_date && (
            <Meta label="Verified" value={c.metrics_verified_date.slice(0, 10)} />
          )}
        </dl>
      </ReportHeader>

      {metrics.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Key metrics</SectionTitle>
          <MetricsTable metrics={metrics} trendLabel="Trend" />
        </section>
      )}

      {c.flags.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Active intel</SectionTitle>
          <ul className="mt-4 space-y-3">
            {c.flags.map((f, i) => (
              <li key={i} className="flex items-start gap-3">
                <FlagTypeBadge type={f.type} />
                <span className="text-sm text-gray-200">
                  {f.flag}
                  {f.status && <span className="ml-1 text-xs text-gray-500">({f.status})</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.character_render && (
        <section className="mt-10">
          <SectionTitle>Area context</SectionTitle>
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

      <WebCitations citations={c.character_citations} />

      {metrics.length > 0 && <ColorLegend />}

      <ReportFooter freshnessToken={freshnessToken || undefined}>
        <Link
          href="/r/cre-swfl"
          className="text-[#00d4aa] underline underline-offset-2 hover:text-[#00d4aa]/80"
        >
          All SWFL commercial areas
        </Link>
      </ReportFooter>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />

      {highlighterEnabled && (
        <HighlighterLayer
          reportId={corridor}
          conclusion={
            c.character_render ? stripCitations(c.character_render).slice(0, 500) : undefined
          }
          freshnessToken={freshnessToken || undefined}
          // [AUDIT-FIX C-meta EXTENDED] Carry the corridor metric rows so the popup
          // gets each figure's value + source + freshness for "File this figure".
          // No precomputed chips here, so suggestions are empty (the popup falls
          // back to type-aware chips) — but provenance now flows.
          metricSuggestions={metrics.map((m) => ({
            label: m.label,
            value: typeof m.value === "string" ? m.value : String(m.value),
            suggestions: [],
            sourceUrl: m.sourceUrl ?? undefined,
            freshnessToken: freshnessToken || undefined,
          }))}
        />
      )}
    </>
  );

  return (
    <ReportShell>
      {highlighterEnabled ? <HighlighterProvider>{pageContent}</HighlighterProvider> : pageContent}
    </ReportShell>
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

function buildMetricRows(c: CorridorNormalized): MetricRow[] {
  const rows: MetricRow[] = [];
  if (c.cap_rate_pct !== null) {
    rows.push({
      label: "Cap rate",
      value: `${c.cap_rate_pct.toFixed(1)}%`,
      direction: c.cap_rate_direction,
      sourceUrl: c.cap_rate_source_url,
    });
  }
  if (c.vacancy_rate_pct !== null) {
    rows.push({
      label: "Vacancy",
      value: `${c.vacancy_rate_pct.toFixed(1)}%`,
      direction: c.vacancy_rate_direction,
      sourceUrl: c.vacancy_rate_source_url,
    });
  }
  if (c.absorption_sqft !== null) {
    rows.push({
      label: "Net absorption",
      value: `${c.absorption_sqft >= 0 ? "+" : ""}${c.absorption_sqft.toLocaleString()} sf`,
      direction: c.absorption_sqft_direction,
      sourceUrl: c.absorption_sqft_source_url,
    });
  }
  if (c.asking_rent_psf !== null) {
    rows.push({
      label: "Asking rent (NNN)",
      value: `$${c.asking_rent_psf.toFixed(2)}/sf`,
      direction: c.asking_rent_psf_direction,
      sourceUrl: c.asking_rent_psf_source_url,
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
    .filter((w): w is Record<string, unknown> => w != null && typeof w === "object")
    .map((w) => ({
      ref: typeof w.ref === "string" ? w.ref : undefined,
      url: typeof w.url === "string" ? w.url : undefined,
      title: typeof w.title === "string" ? w.title : undefined,
    }))
    .filter((w) => w.url);
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
    className: "bg-[#d4b370]/10 text-[#d4b370]",
  },
  regulatory: {
    label: "Regulatory",
    className: "bg-[#e08158]/10 text-[#e08158]",
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
    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function WebCitations({ citations }: { citations: unknown }) {
  const items = parseWebCitations(citations);
  if (items.length === 0) return null;
  return (
    <section className="mt-10">
      <SourcesGate sourceCount={items.length} />
    </section>
  );
}

function SourcesGate({ sourceCount }: { sourceCount: number }) {
  return (
    <div className="rounded-xl glass-card-modern border border-white/10 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-medium text-gray-300">Sources</span>
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
          {sourceCount} source{sourceCount !== 1 ? "s" : ""} behind this corridor read.
        </p>
      </div>
    </div>
  );
}
