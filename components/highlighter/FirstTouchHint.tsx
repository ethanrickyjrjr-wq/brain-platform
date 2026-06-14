"use client";

import { useEffect, useState } from "react";

const COOKIE = "swfl_highlighter_seen";

function hasSeen(): boolean {
  if (typeof document === "undefined") return true;
  return document.cookie.split(";").some((c) => c.trim().startsWith(`${COOKIE}=1`));
}

function markSeen() {
  document.cookie = `${COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

interface FirstTouchHintProps {
  /** When the user first activates the highlighter, auto-dismiss the hint. */
  used?: boolean;
}

/**
 * One-time coachmark. Anchored bottom-left so it doesn't overlap the
 * bottom-right Ask-AI FAB on mobile. Auto-dismisses (and sets the seen cookie)
 * the first time the user activates a highlight, or on explicit close.
 */
export function FirstTouchHint({ used = false }: FirstTouchHintProps) {
  const [show, setShow] = useState(false);
  const [prevUsed, setPrevUsed] = useState(false);

  useEffect(() => {
    if (hasSeen()) return;
    const t = setTimeout(() => setShow(true), 900);
    return () => clearTimeout(t);
  }, []);

  // React-recommended pattern for prop-derived state transitions: set state
  // DURING rendering (not in an effect) so React can batch and skip the commit.
  // When `used` flips true for the first time, permanently dismiss the hint.
  if (used && !prevUsed) {
    setPrevUsed(true);
    if (show) {
      markSeen();
      setShow(false);
    }
  }

  function dismiss() {
    markSeen();
    setShow(false);
  }

  if (!show) return null;

  return (
    // Anchored left — stays well clear of the bottom-right FAB on all phones.
    <div className="pointer-events-none fixed bottom-4 left-4 z-[55]">
      <div className="pointer-events-auto flex max-w-[185px] items-center gap-3 rounded-full border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-xl shadow-black/20 sm:max-w-xs">
        <span className="shrink-0 text-[#0a8078]">✦</span>
        <span className="min-w-0 leading-snug">
          Double-tap a figure — or highlight it — to ask or chart it.
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss tip"
          className="shrink-0 rounded-full bg-gray-200 p-1.5 text-gray-600 transition-colors hover:bg-gray-300 hover:text-gray-900 active:bg-gray-400"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.3 3.3 8 7l3.7-3.7 1 1L9 8l3.7 3.7-1 1L8 9l-3.7 3.7-1-1L7 8 3.3 4.3z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
