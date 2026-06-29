"use client";
// components/email-lab/PhotopeaModal.tsx (Build G3 — operator track)
//
// Embeds Photopea in an iframe. When the user saves, Photopea POSTs the image
// bytes to /api/email-lab/save-photo (build 04), which stores it and returns
// a script that calls echoToOE — sending the new URL back via postMessage.
// We listen for that message and write the URL into the block's props.
//
// Pre-crop: if the block has a layout, we pass a resizeCanvas script so Photopea
// opens the photo already cropped to the block's email pixel dimensions.
import { useEffect } from "react";
import type { EmailBlock } from "@/lib/email/doc/types";
import { colSpanToPx, GRID_ROW_HEIGHT } from "@/lib/email/grid-schema";

function photoUrlOf(block: EmailBlock): string | undefined {
  if (block.type === "image") return block.props.url;
  if (block.type === "listing") return block.props.photoUrl;
}

function pixelDims(block: EmailBlock): { w: number; h: number } | null {
  const layout = block.layout;
  if (!layout) return null;
  return { w: colSpanToPx(layout.w), h: layout.h * GRID_ROW_HEIGHT };
}

export function PhotopeaModal({
  block,
  onSave,
  onClose,
}: {
  block: EmailBlock;
  onSave: (blockId: string, url: string) => void;
  onClose: () => void;
}) {
  const photoUrl = photoUrlOf(block);
  const dims = pixelDims(block);

  const config: Record<string, unknown> = {
    server: {
      url: `${window.location.origin}/api/email-lab/save-photo`,
      formats: ["png", "jpg:0.9"],
    },
  };
  if (photoUrl) config.files = [photoUrl];
  if (dims) {
    config.script = `app.activeDocument.resizeCanvas(${dims.w},${dims.h},AnchorPosition.TOPLEFT);`;
  }

  const src = `https://www.photopea.com#${encodeURIComponent(JSON.stringify(config))}`;

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (typeof e.data !== "string") return;
      try {
        const msg = JSON.parse(e.data) as { type?: string; url?: string };
        if (msg.type === "photopea-saved" && msg.url) {
          onSave(block.id, msg.url);
          onClose();
        }
      } catch {
        // ignore non-JSON postMessages from Photopea or other iframes
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [block.id, onSave, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="relative flex h-[90dvh] w-[95vw] max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-2">
          <span className="text-sm font-semibold text-gray-700">Edit photo</span>
          <button
            type="button"
            aria-label="Close photo editor"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        <iframe
          src={src}
          className="min-h-0 flex-1"
          title="Photopea photo editor"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
