import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { buildRenderModel } from "@/lib/deliverable/templates";
import type {
  Slot,
  ExhibitSlot,
  StatSlot,
  QaSlot,
  NoteSlot,
  SectionSlot,
  SourcesSlot,
  InferenceNotesSlot,
  BrandingSlot,
  ExecSummarySlot,
  Narrative,
  SnapshotItem,
} from "@/lib/deliverable/templates";
import { ChartBlockView } from "@/components/charts/ChartBlockView";
import { TemplateSwitcher } from "./TemplateSwitcher";
import { PrintButton } from "@/components/PrintButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface DeliverableRow {
  id: string;
  project_id: string;
  user_id: string;
  template: string;
  instruction: string | null;
  narrative: Narrative;
  items_snapshot: SnapshotItem[];
  branding: Record<string, unknown> | null;
  status: "ready" | "building" | "revoked";
  created_at: string;
}

// ---------------------------------------------------------------------------
// Provenance helper — derive "As of Month YYYY" from a freshness_token.
// The raw token is NEVER displayed; only the human-readable date.
// ---------------------------------------------------------------------------

function asOfFromToken(token?: string): string | null {
  if (!token) return null;
  // Match trailing YYYYMMDD, e.g. SWFL-7421-v5-20260610
  const m = token.match(/(\d{4})(\d{2})(\d{2})\D*$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `As of ${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(d)}`;
}

// ---------------------------------------------------------------------------
// Slot renderers
// ---------------------------------------------------------------------------

function renderBranding(slot: BrandingSlot) {
  const b = slot.branding;
  const photo = typeof b.photo === "string" ? b.photo : null;
  const name = b.name != null ? String(b.name) : null;
  const brokerage = b.brokerage != null ? String(b.brokerage) : null;
  const license = b.license != null ? String(b.license) : null;
  return (
    <header className="mb-8 border-b border-white/10 pb-6">
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt={name ?? "Agent photo"}
          className="mb-3 h-16 w-16 rounded-full object-cover"
        />
      )}
      {name && <p className="text-lg font-semibold text-white">{name}</p>}
      {brokerage && <p className="text-sm text-gray-400">{brokerage}</p>}
      {license && <p className="text-xs text-gray-500">Lic. {license}</p>}
    </header>
  );
}

function renderExecSummary(slot: ExecSummarySlot) {
  return <p className="mb-8 text-base leading-relaxed text-gray-100">{slot.text}</p>;
}

function renderCitation({
  source_url,
  source_label,
  freshness_token,
}: {
  source_url?: string;
  source_label?: string;
  freshness_token?: string;
}) {
  const asOf = asOfFromToken(freshness_token);
  const hasSource = Boolean(source_url || source_label);
  if (!asOf && !hasSource) return null;
  return (
    <p className="citation mt-1 text-xs text-gray-500">
      {hasSource && source_url && (
        <>
          <a
            href={source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#00d4aa] underline underline-offset-2"
          >
            {source_label ?? source_url}
          </a>
          {asOf && " · "}
        </>
      )}
      {hasSource && !source_url && source_label && (
        <>
          {source_label}
          {asOf && " · "}
        </>
      )}
      {asOf}
    </p>
  );
}

function renderExhibit(slot: ExhibitSlot) {
  const citation = renderCitation({
    source_url: slot.source_url,
    freshness_token: slot.freshness_token,
  });

  let body: React.ReactNode;
  if (slot.exhibit_kind === "chart" && slot.chart_block) {
    body = (
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d1e2b]/80">
        <ChartBlockView block={slot.chart_block} />
      </div>
    );
  } else if (slot.exhibit_kind === "table_slice" && slot.columns && slot.rows) {
    body = (
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full text-sm text-gray-200">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {slot.columns.map((col) => (
                <th key={col} className="px-4 py-2 text-left font-medium text-gray-400">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slot.rows.map((row, ri) => (
              <tr key={ri} className="border-b border-white/5 hover:bg-white/5">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-4 py-2 text-gray-300">
                    {cell === null ? "—" : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (slot.exhibit_kind === "file") {
    const isImage = slot.mime?.startsWith("image/");
    body =
      isImage && slot.storage_path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slot.storage_path}
          alt={slot.caption ?? slot.title}
          className="max-w-full rounded-xl"
        />
      ) : (
        <a
          href={slot.storage_path ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#00d4aa] underline underline-offset-2"
        >
          {slot.caption ?? slot.title}
        </a>
      );
  } else {
    // Unknown exhibit_kind — render title as fallback
    body = <p className="text-sm text-gray-500 italic">[Exhibit: {slot.title}]</p>;
  }

  return (
    <figure className="mb-6">
      {slot.caption && (
        <figcaption className="mb-2 text-sm font-medium text-gray-300">{slot.caption}</figcaption>
      )}
      {body}
      {citation}
    </figure>
  );
}

function renderStat(slot: StatSlot) {
  const citation = renderCitation({
    source_url: slot.source_url,
    source_label: slot.source_label,
    freshness_token: slot.freshness_token,
  });
  return (
    <div key={slot.id} className="mb-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{slot.label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{slot.value}</p>
      {citation}
    </div>
  );
}

function renderSection(slot: SectionSlot) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-lg font-semibold text-white">{slot.title}</h2>
      {slot.intro && <p className="mb-4 text-sm leading-relaxed text-gray-300">{slot.intro}</p>}
      {slot.exhibits.length > 0 && (
        <div className="space-y-4">
          {slot.exhibits.map((ex) => (
            <div key={ex.id}>{renderExhibit(ex)}</div>
          ))}
        </div>
      )}
      {slot.stats.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {slot.stats.map((st) => (
            <div key={st.id}>{renderStat(st)}</div>
          ))}
        </div>
      )}
    </section>
  );
}

function renderSources(slot: SourcesSlot) {
  if (slot.sources.length === 0) return null;
  return (
    <footer className="mt-8 border-t border-white/10 pt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Sources</p>
      <ul className="space-y-1">
        {slot.sources.map((src) => (
          <li key={src.url} className="text-xs text-gray-500">
            <a
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00d4aa] underline underline-offset-2 hover:text-[#00d4aa]/80"
            >
              {src.label}
            </a>
          </li>
        ))}
      </ul>
    </footer>
  );
}

function renderInferenceNotes(slot: InferenceNotesSlot) {
  if (slot.notes.length === 0) return null;
  return (
    <aside
      className="mb-6 rounded-lg border border-[#d4b370]/30 bg-[#d4b370]/10 px-4 py-3"
      style={{ color: "#d4b370" }}
    >
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide">Inference Notes</p>
      <ul className="space-y-1">
        {slot.notes.map((note, i) => (
          // Strings already carry [INFERENCE] tag — don't double it
          <li key={i} className="text-xs leading-relaxed">
            {note}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function renderQa(slot: QaSlot) {
  const citation = renderCitation({ freshness_token: slot.freshness_token });
  return (
    <div className="mb-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <p className="mb-1 text-xs font-semibold text-gray-400">{slot.question}</p>
      <p className="text-sm text-gray-200 leading-relaxed">{slot.answer}</p>
      {slot.fact && <p className="mt-1 text-xs text-[#00d4aa]">{slot.fact}</p>}
      {citation}
    </div>
  );
}

function renderNote(slot: NoteSlot) {
  return <p className="mb-3 text-sm italic text-gray-500">{slot.text}</p>;
}

function renderSlot(slot: Slot, index: number): React.ReactNode {
  switch (slot.kind) {
    case "branding":
      return <div key={index}>{renderBranding(slot)}</div>;
    case "exec_summary":
      return <div key={index}>{renderExecSummary(slot)}</div>;
    case "section":
      return <div key={index}>{renderSection(slot)}</div>;
    case "exhibit":
      return <div key={index}>{renderExhibit(slot)}</div>;
    case "stat":
      return <div key={index}>{renderStat(slot)}</div>;
    case "sources":
      return <div key={index}>{renderSources(slot)}</div>;
    case "inference_notes":
      return <div key={index}>{renderInferenceNotes(slot)}</div>;
    case "qa":
      return <div key={index}>{renderQa(slot)}</div>;
    case "note":
      return <div key={index}>{renderNote(slot)}</div>;
    default: {
      const _exhaustive: never = slot;
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// generateMetadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const db = createServiceRoleClient();
  const { data } = await db.from("deliverables").select("narrative").eq("id", id).single();
  const narrative = data?.narrative as Narrative | null;
  const title = narrative?.exec_summary?.split(/[.!?]/)[0]?.trim() ?? "Deliverable";
  return {
    title: `${title} — SWFL Data Gulf`,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DeliverablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = createServiceRoleClient();

  const { data, error } = await db
    .from("deliverables")
    .select("*")
    .eq("id", id)
    .single<DeliverableRow>();

  if (error || !data) notFound();

  // Revoked: render a clean notice.
  // TODO(S7): return real HTTP 410
  if (data.status === "revoked") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="text-lg font-medium text-gray-300">
          This shared deliverable has been revoked.
        </p>
        <p className="mt-2 text-sm text-gray-500">
          The link is no longer active. Please contact the sender for an updated copy.
        </p>
      </main>
    );
  }

  // Build deterministic render model from the frozen snapshot
  const model = buildRenderModel(
    data.template as Parameters<typeof buildRenderModel>[0],
    data.narrative,
    data.items_snapshot,
    data.branding ?? undefined,
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {/* Action strip — hidden in print */}
      <div className="print-hide mb-6 flex flex-wrap items-center justify-between gap-3">
        <TemplateSwitcher id={id} current={data.template} />
        {/* Placeholder for future Copy / Share actions (S7) */}
        <PrintButton reportId={id} />
      </div>

      {/* Render every slot in model order */}
      {model.slots.map((slot, i) => renderSlot(slot, i))}
    </main>
  );
}
