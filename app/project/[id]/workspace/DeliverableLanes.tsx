"use client";

import { useState } from "react";
import type { ProjectItem } from "@/lib/project/items";
import { templateLabel } from "@/lib/deliverable/template-labels";
import { DeliverableThumbnail } from "./DeliverableThumbnail";
import { DeliverableModal } from "./DeliverableModal";
import type { DeliverableRow, DeliverableEditPatch, EmailScheduleRow } from "./types";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hourEt(h: number): string {
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${am ? "am" : "pm"} ET`;
}

/** "Weekly · Mondays 9am ET" / "Daily · 7am ET" / "Monthly · day 1 · 8am ET". */
function cadenceLabel(s: EmailScheduleRow): string {
  const when =
    s.cadence === "weekly" && s.day_of_week != null
      ? `${DOW[s.day_of_week] ?? "?"}`
      : s.cadence === "monthly" && s.day_of_month != null
        ? `day ${s.day_of_month}`
        : "";
  const cad = s.cadence.charAt(0).toUpperCase() + s.cadence.slice(1);
  return [cad, when, hourEt(s.send_hour_et)].filter(Boolean).join(" · ");
}

function scopeLabel(s: EmailScheduleRow): string {
  if (!s.scope_value) return "All SWFL";
  // scope_value is stored canonical lowercase. A ZIP/county code reads fine
  // upper-cased; a place name should be title-cased ("cape coral" → "Cape Coral").
  if (s.scope_kind === "place") return s.scope_value.replace(/\b\w/g, (c) => c.toUpperCase());
  return s.scope_value.toUpperCase();
}

function EmailScheduleCard({ s }: { s: EmailScheduleRow }) {
  const paused = s.status !== "active";
  return (
    <li className="flex flex-col gap-1 rounded-xl border border-white/10 bg-[#0d1e2b]/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-white">{scopeLabel(s)}</span>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
            paused ? "border border-white/10 text-gray-400" : "bg-[#00d4aa]/15 text-[#00d4aa]"
          }`}
        >
          {paused ? s.status : "active"}
        </span>
      </div>
      <span className="text-xs text-gray-400">{cadenceLabel(s)}</span>
      {s.topic && <span className="text-[11px] text-gray-500">Topic: {s.topic}</span>}
      <span className="text-[11px] text-gray-500">Audience: {s.audience_slug ?? "—"}</span>
      <span className="text-[11px] text-gray-500">
        {s.last_run_at
          ? `Last sent ${new Date(s.last_run_at).toLocaleDateString()}`
          : "Not sent yet"}
        {s.next_run_at && !paused ? ` · Next ${new Date(s.next_run_at).toLocaleDateString()}` : ""}
      </span>
    </li>
  );
}

/**
 * Two deliverable lanes (Piece 1 §D):
 *   • Built lane — every built deliverable as a live compact mini-render thumbnail
 *     that opens big in a modal; owner kill-switch + Send-weekly inline.
 *   • Emailing lane — the project's active email_schedules as recipe cards (the lane
 *     is schedule-driven; email_schedules has no deliverable_id). Live "this week's
 *     email" render is deferred to P4 (it needs a fresh data assembly, not cheap).
 */
export function DeliverableLanes({
  projectId,
  deliverables,
  trashedDeliverables,
  emailSchedules,
  items,
  projectBranding,
  onToggleRevoke,
  onRefresh,
  onEdit,
  onTrash,
}: {
  projectId: string;
  deliverables: DeliverableRow[];
  trashedDeliverables: DeliverableRow[];
  emailSchedules: EmailScheduleRow[];
  /** The project's current items — fed to the guided edit panel's add/remove list. */
  items: ProjectItem[];
  /** Project branding — default for the edit panel's color pickers. */
  projectBranding: Record<string, string> | null;
  onToggleRevoke: (deliverableId: string, currentStatus: string) => void;
  /** P4 refresh → returns the new version id (so the modal swaps to it). */
  onRefresh: (deliverableId: string) => Promise<string | null>;
  /** P4 guided edit → returns {id, inPlace}; cosmetic stays in place, content forks. */
  onEdit: (
    deliverableId: string,
    patch: DeliverableEditPatch,
  ) => Promise<{ id: string; inPlace: boolean } | null>;
  /** P4 trash (restore=false) / restore (restore=true). */
  onTrash: (deliverableId: string, restore?: boolean) => Promise<boolean>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Bumped on every successful mutation so the open modal's iframe reloads even when
  // the id is unchanged (a cosmetic in-place edit).
  const [reloadNonce, setReloadNonce] = useState(0);
  // Optimistic shell for a just-forked version: the new id isn't in `deliverables`
  // until router.refresh() lands, so without this the modal would flash closed for a
  // render. The iframe only needs the id; once the real row arrives, `found` wins.
  const [optimistic, setOptimistic] = useState<DeliverableRow | null>(null);

  if (deliverables.length === 0 && emailSchedules.length === 0 && trashedDeliverables.length === 0)
    return null;

  const found = openId ? deliverables.find((d) => d.id === openId) : undefined;
  const open = found ?? (optimistic && optimistic.id === openId ? optimistic : undefined);

  async function handleRefresh() {
    if (!open) return;
    const newId = await onRefresh(open.id);
    if (newId) {
      setOptimistic({ ...open, id: newId, supersedes_id: open.id, versions: undefined });
      setOpenId(newId);
      setReloadNonce((n) => n + 1);
    }
  }

  async function handleEdit(patch: DeliverableEditPatch) {
    if (!open) return null;
    const result = await onEdit(open.id, patch);
    if (result) {
      if (!result.inPlace) {
        // content fork → swap to the new version, kept mounted via the optimistic shell
        setOptimistic({
          ...open,
          id: result.id,
          supersedes_id: open.id,
          versions: undefined,
          template: patch.template ?? open.template,
        });
        setOpenId(result.id);
      }
      setReloadNonce((n) => n + 1); // cosmetic in-place → force the iframe to reload
    }
    return result;
  }

  async function handleTrash() {
    if (!open) return;
    const ok = await onTrash(open.id);
    if (ok) setOpenId(null); // the row is gone from the lane
  }

  return (
    <>
      {deliverables.length > 0 && (
        <section className="mt-8 rounded-xl border border-white/10 bg-[#0d1e2b]/50 p-4">
          <h2 className="text-sm font-semibold text-white">Built deliverables</h2>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {deliverables.map((d) => (
              <DeliverableThumbnail
                key={d.id}
                projectId={projectId}
                deliverable={d}
                onOpen={() => setOpenId(d.id)}
                onToggleRevoke={onToggleRevoke}
              />
            ))}
          </ul>

          {trashedDeliverables.length > 0 && (
            <details className="mt-4 rounded-lg border border-white/5 bg-[#0a1722]/60 px-3 py-2">
              <summary className="cursor-pointer select-none text-xs text-gray-400 hover:text-gray-200">
                Recently deleted ({trashedDeliverables.length})
              </summary>
              <ul className="mt-2 space-y-1.5">
                {trashedDeliverables.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-gray-400">
                      {templateLabel(t.template)} · {new Date(t.created_at).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => void onTrash(t.id, true)}
                      className="shrink-0 text-[#00d4aa] underline underline-offset-2"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-gray-500">
                Deleted deliverables are kept for 7 days, then permanently removed.
              </p>
            </details>
          )}
        </section>
      )}

      {emailSchedules.length > 0 && (
        <section className="mt-6 rounded-xl border border-white/10 bg-[#0d1e2b]/50 p-4">
          <h2 className="text-sm font-semibold text-white">Emailing</h2>
          <p className="mt-1 text-xs text-gray-500">
            Active schedules. Each send pulls fresh data at send time.
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {emailSchedules.map((s) => (
              <EmailScheduleCard key={s.id} s={s} />
            ))}
          </ul>
        </section>
      )}

      {open && (
        <DeliverableModal
          deliverable={open}
          title={`${templateLabel(open.template)} · ${new Date(
            open.created_at,
          ).toLocaleDateString()}`}
          items={items}
          projectBranding={projectBranding}
          reloadNonce={reloadNonce}
          onClose={() => setOpenId(null)}
          onRefresh={handleRefresh}
          onEdit={handleEdit}
          onTrash={handleTrash}
        />
      )}
    </>
  );
}
