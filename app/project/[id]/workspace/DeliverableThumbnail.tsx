"use client";

import { ChartBlockView } from "@/components/charts/ChartBlockView";
import { SendWeeklyHandle } from "@/app/p/[id]/SendWeeklyHandle";
import { templateLabel } from "@/lib/deliverable/template-labels";
import type { DeliverableRow } from "./types";

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * One Built-lane card (Piece 1 §D): a live compact mini-render — exec-summary
 * blurb + the first chart drawn `compact` — that opens the deliverable big in a
 * modal on click. The owner kill-switch (revoke/restore) + the Send-weekly handle
 * (scoped, non-revoked) stay inline so the J4 send path isn't buried. Cross-build
 * contract: P4 swaps the frozen mini-render for a live rebuild + edit controls.
 */
export function DeliverableThumbnail({
  projectId,
  deliverable: d,
  onOpen,
  onToggleRevoke,
}: {
  projectId: string;
  deliverable: DeliverableRow;
  onOpen: () => void;
  onToggleRevoke: (deliverableId: string, currentStatus: string) => void;
}) {
  const label = templateLabel(d.template);
  const revoked = d.status === "revoked";
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0d1e2b]/80">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${label}`}
        className="flex min-h-40 flex-col gap-2 p-3 text-left hover:bg-white/5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-white">{label}</span>
          <span className="shrink-0 text-[10px] text-gray-500">
            {new Date(d.created_at).toLocaleDateString()}
          </span>
        </div>
        {d.exec_summary && (
          <p className="text-xs leading-snug text-gray-400">{clip(d.exec_summary, 140)}</p>
        )}
        {d.preview_chart && (
          <div className="pointer-events-none mt-auto">
            <ChartBlockView block={d.preview_chart} compact />
          </div>
        )}
        {revoked && <span className="text-[10px] font-medium text-red-400">revoked</span>}
      </button>

      <div className="flex items-center justify-between gap-2 border-t border-white/5 px-3 py-2">
        {!revoked && d.scope_kind ? (
          <SendWeeklyHandle
            deliverableId={d.id}
            projectId={projectId}
            scopeKind={d.scope_kind}
            scopeValue={d.scope_value}
          />
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => onToggleRevoke(d.id, d.status)}
          className={
            revoked
              ? "shrink-0 text-xs text-[#00d4aa] underline underline-offset-2"
              : "shrink-0 text-xs text-red-400 underline underline-offset-2"
          }
        >
          {revoked ? "Restore" : "Revoke"}
        </button>
      </div>

      {/* P4: older versions this one superseded (refresh / content-edit forks) */}
      {d.versions && d.versions.length > 0 && (
        <details className="border-t border-white/5 px-3 py-2 text-[11px] text-gray-500">
          <summary className="cursor-pointer select-none hover:text-gray-300">
            {d.versions.length} earlier version{d.versions.length > 1 ? "s" : ""}
          </summary>
          <ul className="mt-1.5 space-y-1">
            {d.versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2">
                <span>{new Date(v.created_at).toLocaleDateString()}</span>
                <a
                  href={`/p/${v.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#00d4aa] underline underline-offset-2"
                >
                  view ↗
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
