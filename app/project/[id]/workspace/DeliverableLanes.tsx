"use client";

import { SendWeeklyHandle } from "@/app/p/[id]/SendWeeklyHandle";
import type { DeliverableRow } from "./types";

/**
 * The Built lane: every built deliverable for this project (owner kill-switch +
 * Send-weekly handle on scoped ones). Cross-build contract: P4 swaps the frozen
 * link rows for live thumbnails + an open-big modal; the Emailing lane (schedule-
 * driven) lands when `page.tsx` loads `email_schedules`. For now this preserves
 * the monolith's "Shared Deliverables" section behavior, extracted.
 */
export function DeliverableLanes({
  projectId,
  deliverables,
  onToggleRevoke,
}: {
  projectId: string;
  deliverables: DeliverableRow[];
  onToggleRevoke: (deliverableId: string, currentStatus: string) => void;
}) {
  if (deliverables.length === 0) return null;
  return (
    <section className="mt-8 rounded-xl border border-white/10 bg-[#0d1e2b]/50 p-4">
      <h2 className="text-sm font-semibold text-white">Built deliverables</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {deliverables.map((d) => (
          <li key={d.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <a
                  href={`/p/${d.id}`}
                  className="text-sm text-[#00d4aa] underline underline-offset-2"
                >
                  {d.template}
                </a>
                <span className="text-xs text-gray-500">
                  {new Date(d.created_at).toLocaleDateString()}
                </span>
                {d.status === "revoked" && (
                  <span className="text-xs font-medium text-red-400">revoked</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onToggleRevoke(d.id, d.status)}
                className={
                  d.status === "revoked"
                    ? "text-xs text-[#00d4aa] underline underline-offset-2"
                    : "text-xs text-red-400 underline underline-offset-2"
                }
              >
                {d.status === "revoked" ? "Restore" : "Revoke"}
              </button>
            </div>
            {d.status !== "revoked" && d.scope_kind && (
              <SendWeeklyHandle
                deliverableId={d.id}
                projectId={projectId}
                scopeKind={d.scope_kind}
                scopeValue={d.scope_value}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
