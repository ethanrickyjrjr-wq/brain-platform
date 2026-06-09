import { z } from "zod";
import {
  isPublishedSourceTable,
  SOURCE_PROVENANCE_TABLES,
  type SourceTableEntry,
} from "../_tables";
import { createServiceRoleClient } from "../../../../utils/supabase/service-role";
import { ReportShell, ReportHeader, ReportFooter, Meta } from "../../_components/report-shell";
import { HighlighterLayer } from "../../../../components/highlighter/HighlighterLayer";
import { HighlighterProvider } from "../../../../lib/highlighter/context";
import { highlighterUiEnabled } from "../../../../lib/highlighter/flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_SCHEMA = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_]+$/);

const DATE_COL_CANDIDATES = [
  "period_yyyymm",
  "period",
  "report_date",
  "collected_at",
  "fetched_at",
  "created_at",
] as const;

interface PageProps {
  params: Promise<{ table: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SourceProvenancePage({ params, searchParams }: PageProps) {
  const { table } = await params;
  const sp = await searchParams;

  if (!TABLE_SCHEMA.safeParse(table).success) {
    return <NotPublishedPanel table={table} />;
  }
  if (!isPublishedSourceTable(table)) {
    return <NotPublishedPanel table={table} />;
  }

  const entry: SourceTableEntry = SOURCE_PROVENANCE_TABLES[table];
  const label = firstParam(sp.label) ?? entry.label;
  const sourceName = firstParam(sp.source);
  const brain = firstParam(sp.brain) ?? entry.brain;
  const docHref = sanitizeDocHref(firstParam(sp.doc));
  const requestedDateCol = firstParam(sp.date_col);
  const dateCol = requestedDateCol ?? entry.date_col ?? null;

  let supabase;
  try {
    supabase = createServiceRoleClient();
  } catch {
    return (
      <Shell
        table={table}
        label={label}
        brain={brain}
        sourceName={sourceName}
        docHref={docHref}
        rowCount={null}
        rows={[]}
        columns={[]}
        dateColEffective={null}
        dateRange={null}
        statusMessage="Server is missing Supabase credentials; row data is unavailable in this environment."
      />
    );
  }

  const { count, error: countError } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });

  if (countError) {
    return (
      <Shell
        table={table}
        label={label}
        brain={brain}
        sourceName={sourceName}
        docHref={docHref}
        rowCount={null}
        rows={[]}
        columns={[]}
        dateColEffective={null}
        dateRange={null}
        statusMessage="Could not query this table — see server logs."
      />
    );
  }

  const rowCount = count ?? 0;

  if (rowCount === 0) {
    return (
      <Shell
        table={table}
        label={label}
        brain={brain}
        sourceName={sourceName}
        docHref={docHref}
        rowCount={0}
        rows={[]}
        columns={[]}
        dateColEffective={null}
        dateRange={null}
        statusMessage="Table is published but has no rows yet."
      />
    );
  }

  let sampleQuery = supabase.from(table).select("*").limit(12);
  if (dateCol) {
    sampleQuery = sampleQuery.order(dateCol, { ascending: false });
  }
  const { data, error: sampleError } = await sampleQuery;

  if (sampleError || !data || data.length === 0) {
    return (
      <Shell
        table={table}
        label={label}
        brain={brain}
        sourceName={sourceName}
        docHref={docHref}
        rowCount={rowCount}
        rows={[]}
        columns={[]}
        dateColEffective={null}
        dateRange={null}
        statusMessage="Row count is known, but the sample query returned no rows."
      />
    );
  }

  const rows = data as Record<string, unknown>[];
  const columns = Object.keys(rows[0]);

  const dateColEffective = dateCol ?? DATE_COL_CANDIDATES.find((c) => columns.includes(c)) ?? null;

  const dateRange = dateColEffective ? rangeOfStringValues(rows, dateColEffective) : null;

  return (
    <Shell
      table={table}
      label={label}
      brain={brain}
      sourceName={sourceName}
      docHref={docHref}
      rowCount={rowCount}
      rows={rows}
      columns={columns}
      dateColEffective={dateColEffective}
      dateRange={dateRange}
      statusMessage={null}
    />
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface ShellProps {
  table: string;
  label: string;
  brain: string | undefined;
  sourceName: string | undefined;
  docHref: string | null;
  rowCount: number | null;
  rows: Record<string, unknown>[];
  columns: string[];
  dateColEffective: string | null;
  dateRange: { min: string; max: string } | null;
  statusMessage: string | null;
}

function Shell({
  table,
  label,
  brain,
  sourceName,
  docHref,
  rowCount,
  rows,
  columns,
  dateColEffective,
  dateRange,
  statusMessage,
}: ShellProps) {
  const highlighterEnabled = highlighterUiEnabled();
  const content = (
    <>
      <ReportHeader title={label}>
        <p className="mt-3 font-mono text-sm text-gray-400">{table}</p>
      </ReportHeader>

      <section className="mt-8">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Meta label="Source" value={sourceName ?? "—"} />
          <Meta
            label="Brain"
            value={
              brain ? (
                <a
                  href={`/r/${brain}`}
                  className="text-[#00d4aa] underline underline-offset-2 hover:text-[#00d4aa]/80"
                >
                  {brain}
                </a>
              ) : (
                "—"
              )
            }
          />
          <Meta label="Rows" value={rowCount === null ? "—" : rowCount.toLocaleString("en-US")} />
          <Meta
            label="Date range"
            value={
              dateRange
                ? `${dateRange.min} → ${dateRange.max}`
                : dateColEffective === null
                  ? "no date column detected"
                  : "—"
            }
          />
        </dl>
        {docHref && (
          <p className="mt-4 text-sm">
            <a
              href={docHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00d4aa] underline decoration-[#00d4aa]/40 underline-offset-2 hover:decoration-[#00d4aa]"
            >
              Source documentation ↗
            </a>
          </p>
        )}
        {dateColEffective && (
          <p className="mt-3 text-xs text-gray-500">
            Sample ordered by <code className="font-mono text-gray-300">{dateColEffective}</code>{" "}
            desc.
          </p>
        )}
      </section>

      {statusMessage && (
        <section className="mt-8">
          <div className="glass-card-modern rounded-xl border border-white/10 px-4 py-3 text-sm text-gray-300">
            {statusMessage}
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold tracking-tight text-white">
            Sample rows ({rows.length})
          </h2>
          <div className="mt-4 overflow-x-auto rounded-xl glass-card-modern border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-gray-400">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="px-4 py-3 font-mono text-[11px] tracking-wide">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td
                        key={c}
                        className="px-4 py-3 align-top font-mono text-xs text-gray-300 max-w-[220px] break-all"
                      >
                        {displayCell(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ReportFooter note="Provenance page for tables consumed by Brains. Rows served via a server-only Supabase service-role client; no credentials reach the browser." />

      {highlighterEnabled && <HighlighterLayer reportId={table} />}
    </>
  );

  return (
    <ReportShell>
      {highlighterEnabled ? <HighlighterProvider>{content}</HighlighterProvider> : content}
    </ReportShell>
  );
}

function NotPublishedPanel({ table }: { table: string }) {
  return (
    <ReportShell>
      <ReportHeader title="Not a published source">
        <p className="mt-3 font-mono text-sm text-gray-400">{table}</p>
      </ReportHeader>
      <section className="mt-8">
        <p className="text-base leading-7 text-gray-300">
          This table is not exposed via the public provenance route. If you arrived here from a
          citation link, the brain that emitted it may need to be regenerated against the current
          allowlist.
        </p>
      </section>
    </ReportShell>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v[0];
  return v;
}

function sanitizeDocHref(v: string | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function rangeOfStringValues(
  rows: Record<string, unknown>[],
  col: string,
): { min: string; max: string } | null {
  const values = rows
    .map((r) => r[col])
    .filter(
      (v): v is string | number =>
        v !== null && v !== undefined && (typeof v === "string" || typeof v === "number"),
    )
    .map((v) => String(v));
  if (values.length === 0) return null;
  const sorted = [...values].sort();
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

function displayCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "[object]";
  }
}
