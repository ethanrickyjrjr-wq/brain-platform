"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * A portal overlay (Piece 1 §D). Renders into `document.body` so it escapes any
 * clipping/stacking parent, dims the page, traps the backdrop click and Escape to
 * close, and locks body scroll while open. `role="dialog" aria-modal`.
 *
 * Cross-build contract: P4 reuses this exact component for the deliverable editing
 * overlay. Only mounted when a parent renders it (i.e. open === true), so the SSR
 * `document` guard never produces a hydration mismatch — the modal simply isn't in
 * the server tree until a client interaction opens it. No props→state effect (this
 * repo build-blocks `react-hooks/set-state-in-effect`); the effect only wires DOM
 * listeners + the scroll lock, never React state.
 */
export function Modal({
  title,
  onClose,
  children,
  widthClass = "max-w-4xl",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Tailwind max-width for the panel (default `max-w-4xl`). */
  widthClass?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[90vh] w-full ${widthClass} flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d1e2b] shadow-2xl`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3">
          <h2 className="truncate text-sm font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full px-2 text-lg leading-none text-gray-400 hover:text-white"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
