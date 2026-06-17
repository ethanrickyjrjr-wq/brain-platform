"use client";

import { Modal } from "@/components/ui/Modal";

/**
 * "Open big" for a built deliverable (Piece 1 §D). Per the locked decision, P1
 * renders the deliverable in an `<iframe src="/p/[id]">` inside the portal modal —
 * the real, frozen page, including its owner Send-weekly handle (the global SWFL
 * pill is suppressed on /p/* so the overlay stays clean — see pill-mount). P4 will
 * swap the iframe for an in-modal live rebuild + section/color editing.
 */
export function DeliverableModal({
  deliverableId,
  title,
  onClose,
}: {
  deliverableId: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} widthClass="max-w-5xl">
      <div className="flex items-center justify-end border-b border-white/10 px-4 py-2">
        <a
          href={`/p/${deliverableId}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[#00d4aa] underline underline-offset-2"
        >
          Open in new tab ↗
        </a>
      </div>
      <iframe
        src={`/p/${deliverableId}`}
        title={title}
        className="h-[78vh] w-full border-0 bg-white"
      />
    </Modal>
  );
}
