"use client";

import { useEffect, useState } from "react";

const COOKIE = "swfl_highlighter_seen";

function hasSeen(): boolean {
  if (typeof document === "undefined") return true;
  return document.cookie
    .split(";")
    .some((c) => c.trim().startsWith(`${COOKIE}=1`));
}

function markSeen() {
  // 1-year cookie; SameSite=Lax is fine for a same-site UI flag.
  document.cookie = `${COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

/**
 * One-time coachmark. Shows a small bottom-center toast on the first visit
 * telling the user they can tap any figure or place. Dismissing (or it
 * auto-hiding) sets a cookie so it never appears again.
 */
export function FirstTouchHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (hasSeen()) return;
    // Defer a beat so it doesn't fight the page's first paint.
    const t = setTimeout(() => setShow(true), 900);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    markSeen();
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[55] flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-xl shadow-black/20">
        <span className="text-[#0b6b5a]">✦</span>
        <span className="min-w-0">
          Double-tap a figure — or highlight it — to ask or chart it.
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss tip"
          className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:text-gray-700"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.3 3.3 8 7l3.7-3.7 1 1L9 8l3.7 3.7-1 1L8 9l-3.7 3.7-1-1L7 8 3.3 4.3z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
