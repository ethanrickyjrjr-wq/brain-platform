"use client";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import type { ProjectItem } from "@/lib/project/items";
import type { DeliverableRow, DeliverableEditPatch } from "./types";
import { DeliverableEditPanel } from "./DeliverableEditPanel";
import { useIframeSelection } from "@/lib/highlighter/use-iframe-selection";
import { DeliverableHighlightPopup } from "@/components/highlighter/DeliverableHighlightPopup";
import { useAiContext } from "@/components/briefcase/use-ai-context";
import { useBriefcase } from "@/components/briefcase/BriefcaseProvider";
import { describePage, projectPageContextForPath } from "@/lib/chat/page-context";
import { briefcaseDigest } from "@/lib/briefcase/briefcase-digest";

/**
 * "Open big" for a built deliverable (Piece 1 §D + Piece 4). The frozen page renders
 * in an `<iframe src="/p/[id]">`; P4 adds the action bar — Refresh (re-render against
 * today's data → new version), Edit (guided rebuild panel), Delete (soft-trash). The
 * iframe carries a `?r=<nonce>` cache-buster so a cosmetic in-place edit (same id)
 * reloads; a content edit/refresh swaps the modal to the new version's id (parent).
 *
 * Layer 2 (PROJECT highlighter): select text in the iframe → DeliverableHighlightPopup
 * (EDIT/ASK verbs). Same-origin assumption: /p/[id] and the parent are both
 * swfldatagulf.com, so the parent can read the iframe's contentDocument selection.
 */
export function DeliverableModal({
  deliverable: d,
  title,
  items,
  projectBranding,
  projectId,
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
  projectId: string;
  reloadNonce: number;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onEdit: (patch: DeliverableEditPatch) => Promise<{ id: string; inPlace: boolean } | null>;
  onTrash: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | "refresh" | "trash" | "edit" | "highlight-edit">(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ALL hooks above any conditional return (React invariant). This modal only ever
  // renders inside /project/[id], so the highlighter speaks as PROJECT AI: context is
  // "project" with the real projectId (guaranteed grounding even if the digest lags).
  // pageContext/briefcase are the same client context the pill + app-root highlighter
  // send (describePage + briefcaseDigest), so the answer reasons at the project's grain.
  const pathname = usePathname() ?? "/";
  const digest = useAiContext();
  const briefcaseCtx = useBriefcase();
  const highlightPageContext = describePage(pathname, projectPageContextForPath(pathname, digest));
  const highlightBriefcase = briefcaseDigest(briefcaseCtx?.draftItems ?? []);

  // Selection capture — only meaningful when the iframe is visible (not the edit panel).
  const iframeSelection = useIframeSelection(iframeRef);
  const activeSelection = !editing ? iframeSelection : null;

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

  async function handleHighlightEdit(instruction: string) {
    if (busy) return;
    setBusy("highlight-edit");
    const r = await onEdit({ instruction });
    setBusy(null);
    if (r) {
      // Clear the iframe selection → selectionchange → hook sets null → popup closes.
      iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges();
    }
  }

  function closeSelectionPopup() {
    iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges();
  }

  return (
    <Modal title={title} onClose={onClose} widthClass="max-w-5xl">
      {/* Action bar */}
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
          ref={iframeRef}
          src={`/p/${d.id}?r=${reloadNonce}`}
          title={title}
          className="h-[78vh] w-full border-0 bg-white"
        />
      )}

      {/* In-deliverable selection popup — floats at z-[70] above the modal. */}
      {activeSelection && (
        <DeliverableHighlightPopup
          deliverableId={d.id}
          selection={activeSelection}
          projectId={projectId}
          context="project"
          pageContext={highlightPageContext}
          briefcase={highlightBriefcase}
          confirming={busy === "highlight-edit"}
          onConfirmEdit={(instruction) => void handleHighlightEdit(instruction)}
          onClose={closeSelectionPopup}
        />
      )}
    </Modal>
  );
}
