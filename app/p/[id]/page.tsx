import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { buildRenderModel } from "@/lib/deliverable/templates";
import { extractBrandTheme, toChartTheme } from "@/lib/deliverable/brand-theme";
import type {
  Slot,
  ExhibitSlot,
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
import { FrameRenderer } from "@/components/charts/registry/FrameRenderer";
import { signedUploadUrls } from "@/lib/project/signed-upload-url";
import { buildEmailDeliverableModel } from "@/lib/deliverable/email-deliverable";
import { renderGroundedReport } from "@/lib/email/grounded-report";
import { GlobalDigestFallback } from "@/components/GlobalDigestFallback";
import { TemplateSwitcher } from "./TemplateSwitcher";
import { StatCard } from "./StatCard";
import { PrintButton } from "@/components/PrintButton";
import { DeliveryButtons } from "./DeliveryButtons";
import { EmailPreviewFrame } from "./EmailPreviewFrame";
import { SendWeeklyHandle } from "./SendWeeklyHandle";
import { SendToContactsHandle } from "./SendToContactsHandle";
import { CitationList } from "@/components/CitationList";
import { cleanCitation } from "@/lib/citations/clean-url";

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
  // ZIP scope for an "email" deliverable (NULL for slot-rendered templates / old rows).
  // Flows from the `.select("*")` below once the 20260616_deliverables_scope migration lands.
  scope_kind: string | null;
  scope_value: string | null;
  // Soft-trash (FINAL BOSS Piece 4): non-null → trashed → this page 404s.
  deleted_at: string | null;
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
  const logoUrl = typeof b.logo_url === "string" ? b.logo_url : null;
  const primary = typeof b.primary_color === "string" ? b.primary_color : null;
  return (
    <header
      className="mb-8 border-b pb-6"
      style={{ borderColor: primary ? `${primary}40` : "rgba(255,255,255,0.1)" }}
    >
      <div className="flex items-start gap-4">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Brand logo"
            className="h-12 w-auto max-w-[160px] flex-shrink-0 object-contain"
          />
        )}
        <div>
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
        </div>
      </div>
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
  // Route through the shared root: strips internal/supabase/api URLs, cleans labels.
  const c =
    source_url || source_label ? cleanCitation({ url: source_url, label: source_label }) : null;
  if (!asOf && !c) return null;
  return (
    <p className="citation mt-1 text-xs text-gray-500">
      {c && c.linkable && c.href && (
        <>
          <a
            href={c.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#00d4aa] underline underline-offset-2"
          >
            {c.label}
          </a>
          {asOf && " · "}
        </>
      )}
      {c && !(c.linkable && c.href) && (
        <>
          {c.label}
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
  } else if (slot.exhibit_kind === "frame" && slot.chart_spec) {
    // Live-bound presentation frame — renders its OWN per-visual as-of + source
    // caption, so the figure-level citation below is suppressed for frames.
    body = (
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d1e2b]/80">
        <FrameRenderer spec={slot.chart_spec} />
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
    // Always a fresh server signed URL — never the raw private path (not fetchable).
    const isImage = slot.mime?.startsWith("image/");
    if (!slot.signed_url) {
      body = <p className="text-sm text-gray-500 italic">[Attachment unavailable]</p>;
    } else if (isImage) {
      body = (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slot.signed_url}
          alt={slot.caption ?? slot.title}
          className="max-w-full rounded-xl"
        />
      );
    } else {
      body = (
        <a
          href={slot.signed_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#00d4aa] underline underline-offset-2"
        >
          {slot.caption ?? slot.title} (PDF)
        </a>
      );
    }
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
      {slot.exhibit_kind === "file" ? (
        // User-supplied media — flag it so it's never mistaken for cited lake data.
        <figcaption className="mt-1 text-[11px] text-gray-500">Provided by agent</figcaption>
      ) : slot.exhibit_kind === "frame" ? null : (
        // Frames self-caption their as-of + source; everything else gets the figure citation.
        citation
      )}
    </figure>
  );
}

function renderSection(slot: SectionSlot, deliverableId: string) {
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
            <StatCard key={st.id} slot={st} deliverableId={deliverableId} />
          ))}
        </div>
      )}
    </section>
  );
}

function renderSources(slot: SourcesSlot) {
  // The ONE collapsible Sources box — cleans every URL/label at display time.
  return <CitationList sources={slot.sources} />;
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

/** Every file exhibit in the model — top-level and nested inside sections. */
function fileExhibitSlots(slots: Slot[]): ExhibitSlot[] {
  const out: ExhibitSlot[] = [];
  for (const slot of slots) {
    if (slot.kind === "exhibit" && slot.exhibit_kind === "file") out.push(slot);
    else if (slot.kind === "section") {
      for (const ex of slot.exhibits) if (ex.exhibit_kind === "file") out.push(ex);
    }
  }
  return out;
}

function renderSlot(slot: Slot, index: number, deliverableId: string): React.ReactNode {
  switch (slot.kind) {
    case "branding":
      return <div key={index}>{renderBranding(slot)}</div>;
    case "exec_summary":
      return <div key={index}>{renderExecSummary(slot)}</div>;
    case "section":
      return <div key={index}>{renderSection(slot, deliverableId)}</div>;
    case "exhibit":
      return <div key={index}>{renderExhibit(slot)}</div>;
    case "stat":
      return (
        <div key={index}>
          <StatCard slot={slot} deliverableId={deliverableId} />
        </div>
      );
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
  const { data } = await db
    .from("deliverables")
    .select("narrative, status, deleted_at")
    .eq("id", id)
    .single();
  const row = data as {
    narrative: Narrative | null;
    status: string;
    deleted_at: string | null;
  } | null;
  // A revoked or trashed deliverable 404s in the body — don't leak its content via the
  // <title> either. `absolute` bypasses the root layout's "%s — SWFL Data Gulf" template.
  if (!row || row.status === "revoked" || row.deleted_at) {
    return { title: { absolute: "SWFL Data Gulf" } };
  }
  const title = row.narrative?.exec_summary?.split(/[.!?]/)[0]?.trim() ?? "Deliverable";
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

  // Revoked: HTTP 404 (notFound) — App Router pages can't return HTTP 410 directly.
  if (data.status === "revoked") notFound();

  // Trashed (FINAL BOSS Piece 4 soft-delete): hide from any holder of the link.
  // Recoverable by the owner for 7 days from the workspace, then hard-swept.
  if (data.deleted_at) notFound();

  // Determine ownership without a second DB query — user_id is on the deliverable row.
  const userClient = createClient(await cookies());
  const {
    data: { user },
  } = await userClient.auth.getUser();
  const isOwner = user?.id === data.user_id;

  // "email" deliverables render via the grounded email spine, NOT buildRenderModel's
  // React slot model. The frozen items_snapshot + narrative + persisted ZIP scope
  // reconstruct the model purely (no live fetch). renderGroundedReport returns a FULL
  // <html> document, so it must render inside an isolated <iframe srcDoc> — injected
  // into a <div> the browser would strip its <head>/<style> and the skin would be bare.
  if (data.template === "email") {
    const ctaUrl =
      data.branding != null && typeof data.branding.website_url === "string"
        ? data.branding.website_url
        : "";
    const emailModel = buildEmailDeliverableModel(data, { ctaUrl });
    if (!emailModel) {
      return (
        <main className="deliverable-page w-full px-4 py-10">
          <GlobalDigestFallback narrative={data.narrative} />
        </main>
      );
    }
    const emailHtml = await renderGroundedReport(emailModel, { skin: "email" });
    return (
      <main className="deliverable-page w-full px-4 py-10">
        <div className="print-hide mb-6 flex flex-wrap items-center justify-between gap-3">
          {/* The email preview is a full <html> doc in an iframe; window.print() on it
              is unreliable, so the PDF affordance opens the dedicated print route, which
              renders the skin:"pdf" doc skin and auto-prints. */}
          <a
            href={`/p/${id}/print`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-[#0a8078]/40 px-4 py-2 text-sm font-medium text-[#0a8078] transition-colors hover:bg-[#0a8078]/10"
          >
            Save as PDF
          </a>
          {isOwner && (
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={`/project/${data.project_id}`}
                className="rounded-full border border-[#0a8078]/40 px-4 py-2 text-sm font-medium text-[#0a8078] transition-colors hover:bg-[#0a8078]/10"
              >
                ← Back to project
              </a>
              <SendToContactsHandle deliverableId={id} />
              <SendWeeklyHandle
                deliverableId={id}
                projectId={data.project_id}
                scopeKind={data.scope_kind}
                scopeValue={data.scope_value}
              />
            </div>
          )}
        </div>
        <EmailPreviewFrame srcDoc={emailHtml} />
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

  // Inject brand theme into every frame ChartSpec at render time (Phase 6).
  // This is a render-time concern: theme changes don't require a rebuild.
  const brandTheme = extractBrandTheme(data.branding);
  if (brandTheme) {
    const chartTheme = toChartTheme(brandTheme);
    for (const slot of model.slots) {
      if (slot.kind === "exhibit" && slot.exhibit_kind === "frame" && slot.chart_spec) {
        slot.chart_spec = { ...slot.chart_spec, theme: chartTheme };
      } else if (slot.kind === "section") {
        for (const ex of slot.exhibits) {
          if (ex.exhibit_kind === "frame" && ex.chart_spec) {
            ex.chart_spec = { ...ex.chart_spec, theme: chartTheme };
          }
        }
      }
    }
  }

  // Re-sign uploaded file exhibits on every render. The snapshot stores the raw
  // `storage_path` (URLs expire); a public viewer can't read the owner's private
  // object under their own JWT, so the service-role `db` client mints the link.
  const fileSlots = fileExhibitSlots(model.slots);
  if (fileSlots.length > 0) {
    const urls = await signedUploadUrls(
      db,
      fileSlots.map((s) => s.storage_path).filter((p): p is string => Boolean(p)),
    );
    for (const s of fileSlots) if (s.storage_path) s.signed_url = urls[s.storage_path];
  }

  return (
    <PageShell width="wide" className="deliverable-page">
      {/* Brand accent bar — print-visible top rule, hidden when no brand color set */}
      {brandTheme?.primary && (
        <div
          className="print-hide mb-6 h-1 w-full rounded-full"
          style={{ backgroundColor: brandTheme.primary }}
        />
      )}

      {/* Action strip — hidden in print */}
      <div className="print-hide mb-6 flex flex-wrap items-center justify-between gap-3">
        {isOwner && (
          <div className="flex items-center gap-3">
            <a
              href={`/project/${data.project_id}`}
              className="rounded-full border border-[#0a8078]/40 px-4 py-2 text-sm font-medium text-[#0a8078] transition-colors hover:bg-[#0a8078]/10"
            >
              ← Back to project
            </a>
            <TemplateSwitcher id={id} current={data.template} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <DeliveryButtons
            id={id}
            title={data.narrative.exec_summary?.split(/[.!?]/)[0]?.trim() ?? "SWFL Report"}
            execSummary={data.narrative.exec_summary ?? ""}
            agentName={
              data.branding != null && typeof data.branding.agent_name === "string"
                ? data.branding.agent_name
                : undefined
            }
          />
          <PrintButton reportId={id} />
        </div>
      </div>
      {/* Send weekly handle — owners only, requires a ZIP scope on the deliverable */}
      {isOwner && data.scope_kind && (
        <div className="print-hide mb-4">
          <SendWeeklyHandle
            deliverableId={id}
            projectId={data.project_id}
            scopeKind={data.scope_kind}
            scopeValue={data.scope_value}
          />
        </div>
      )}

      {/* Render every slot in model order */}
      {model.slots.map((slot, i) => renderSlot(slot, i, id))}
    </PageShell>
  );
}
