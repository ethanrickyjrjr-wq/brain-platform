"use client";

// Sticky bottom-right action button that toggles the Ask-AI dock.
// Positioning lives on the wrapper div, NOT the button: `.btn-gradient` sets
// `position: relative` (globals.css), which would override Tailwind's `fixed`
// if both sat on the same element.

export function AskAiFab({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-[56]">
      <button
        type="button"
        onClick={onClick}
        aria-label={open ? "Close AI chat" : "Ask AI about this report"}
        aria-expanded={open}
        className="btn-gradient flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-navy-dark shadow-lg shadow-black/40 transition-transform hover:scale-105 active:scale-95"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 2l1.7 4.8L18.5 8.5l-4.8 1.7L12 15l-1.7-4.8L5.5 8.5l4.8-1.7z" />
          <path d="M18.5 13.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" />
        </svg>
        <span>{open ? "Close" : "Ask AI"}</span>
      </button>
    </div>
  );
}
