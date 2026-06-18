"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { ProjectItem } from "@/lib/project/items";
import type { DeliverableRow, DeliverableEditPatch } from "./types";
import { DeliverableEditPanel } from "./DeliverableEditPanel";

/**
 * "Open big" for a built deliverable (Piece 1 §D + Piece 4). The frozen page renders
 * in an `<iframe src="/p/[id]">`; P4 adds the action bar — Refresh (re-render against
 * today's data → new version), Edit (guided rebuild panel), Delete (soft-trash). The
 * iframe carries a `?r=<nonce>` cache-buster so a cosmetic in-place edit (same id)
 * reloads; a content edit/refresh swaps the modal to the new version's id (parent).
 */
export function DeliverableModal({
  deliverable: d,
  title,
  items,
  projectBranding,
  reloadNonce,
  onClose,
  onRefresh,
  onEdit,
  onTrash,
}: {
  deliverable: DeliverableRow;
  title: string;
  items: ProjectItem[];
  projectBranding: Record<string, string> | null;
  reloadNonce: number;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onEdit: (patch: DeliverableEditPatch) => Promise<{ id: string; inPlace: boolean } | null>;
  onTrash: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | "refresh" | "trash" | "edit">(null);

  async function refresh() {
    if (busy) return;
    setBusy("refresh");
    await onRefresh();
    setBusy(null);
  }
  async function trash() {
    if (busy) return;
    setBusy("trash");
    await onTrash(); // parent closes the modal on success
    setBusy(null);
  }

  return (
    <Modal title={title} onClose={onClose} widthClass="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            disabled={busy !== null}
            className="text-xs text-[#00d4aa] underline underline-offset-2 disabled:opacity-40"
          >
            {editing ? "Close editor" : "Edit"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy !== null}
            className="text-xs text-[#00d4aa] underline underline-offset-2 disabled:opacity-40"
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh data"}
          </button>
          <button
            type="button"
            onClick={() => void trash()}
            disabled={busy !== null}
            className="text-xs text-red-400 underline underline-offset-2 disabled:opacity-40"
          >
            {busy === "trash" ? "Deleting…" : "Delete"}
          </button>
        </div>
        <a
          href={`/p/${d.id}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[#00d4aa] underline underline-offset-2"
        >
          Open in new tab ↗
        </a>
      </div>

      {editing ? (
        <DeliverableEditPanel
          deliverable={d}
          items={items}
          projectBranding={projectBranding}
          disabled={busy !== null}
          onCancel={() => setEditing(false)}
          onRebuild={async (patch) => {
            if (busy) return null;
            setBusy("edit");
            const r = await onEdit(patch);
            setBusy(null);
            if (r) setEditing(false);
            return r;
          }}
        />
      ) : (
        <iframe
          src={`/p/${d.id}?r=${reloadNonce}`}
          title={title}
          className="h-[78vh] w-full border-0 bg-white"
        />
      )}
    </Modal>
  );
}
