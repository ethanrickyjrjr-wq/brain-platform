"use client";

import { useState } from "react";
import Link from "next/link";
import { useHighlighterContext } from "@/lib/highlighter/context";
import type { ProjectItem } from "@/lib/project/items";

const TRAY_ID = "briefcase-tray";

/** A one-line label + sub for a draft item, by kind — customer-clean (no ids/jargon). */
function describe(item: ProjectItem): { title: string; sub?: string } {
  switch (item.kind) {
    case "qa":
      return { title: item.question, sub: "Answer" };
    case "metric":
      return { title: item.label, sub: item.value };
    case "chart":
      return { title: item.title, sub: "Chart" };
    case "source":
      return { title: item.label, sub: "Source" };
    case "note":
      return { title: item.text, sub: "Note" };
    case "report":
      return { title: item.title ?? item.slug, sub: "Report" };
    case "file":
      return { title: item.caption ?? "Attachment", sub: item.mime };
    case "table_slice":
      return { title: item.title, sub: "Table" };
    case "frame":
      return { title: item.title, sub: "Chart" };
  }
}

/**
 * The Briefcase capture tray. A floating button (count badge) that opens a
 * bottom-sheet (mobile) / popover (desktop) listing the anonymous draft project.
 * Reads draftItems/removeItem/draftNearCap from the HighlighterProvider; renders
 * nothing until something has been filed. Mounted once by AskAi (inside the
 * provider). Its root carries `id="briefcase-tray"` so the highlighter's
 * SUPPRESS_CLOSEST leaves selections inside it alone.
 *
 * "File this report" lives here so the whole report can be pinned in one tap.
 */
export function Briefcase({
  reportId,
  freshnessToken,
}: {
  reportId: string;
  freshnessToken?: string;
}) {
  const ctx = useHighlighterContext();
  const [open, setOpen] = useState(false);

  if (!ctx || ctx.draftItems.length === 0) return null;
  const { draftItems, removeItem, fileItem, draftNearCap } = ctx;

  function fileReport() {
    const item: ProjectItem = {
      id: crypto.randomUUID(),
      added_at: new Date().toISOString(),
      origin: "web",
      kind: "report",
      slug: reportId,
      freshness_token: freshnessToken,
    };
    fileItem(item);
    void fetch("/api/meter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "item_add", report_id: reportId }),
    }).catch(() => {});
  }

  return (
    <>
      {/* Toggle button (stacked above the Ask-AI FAB) */}
      <div className="fixed bottom-20 right-4 z-[56]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`Briefcase — ${draftItems.length} saved item${draftItems.length === 1 ? "" : "s"}`}
          className="relative flex items-center gap-2 rounded-full border border-[#0a8078] bg-[#2c3539] px-4 py-3 text-sm font-semibold text-[#0a8078] shadow-lg shadow-black/40 transition-transform hover:scale-105 active:scale-95"
        >
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect
              x="3"
              y="7"
              width="18"
              height="13"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
          <span>Briefcase</span>
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0a8078] px-1 text-[11px] font-bold text-navy-dark">
            {draftItems.length}
          </span>
        </button>
      </div>

      {open && (
        <div
          id={TRAY_ID}
          role="dialog"
          aria-label="Your briefcase"
          className="fixed inset-x-0 bottom-0 z-[57] flex max-h-[60vh] flex-col rounded-t-2xl border border-[#0a8078] bg-[#2c3539] text-sm text-gray-100 shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-32 sm:right-4 sm:max-h-[70vh] sm:w-80 sm:rounded-xl"
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#0a8078]/30 px-4 py-2.5">
            <span className="font-semibold text-[#0a8078]">Briefcase · {draftItems.length}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fileReport}
                className="rounded border border-[#0a8078]/60 px-2 py-1 text-[11px] font-semibold text-[#0a8078] hover:bg-[#0a8078]/15"
              >
                File this report
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close briefcase"
                className="shrink-0 rounded p-1 text-gray-500 transition-colors hover:text-white"
              >
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4.3 3.3 8 7l3.7-3.7 1 1L9 8l3.7 3.7-1 1L8 9l-3.7 3.7-1-1L7 8 3.3 4.3z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Near-cap nudge */}
          {draftNearCap && (
            <div className="shrink-0 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-[11px] text-amber-300">
              You&apos;re almost out of space in this draft. Sign in to save it before you lose
              room.
            </div>
          )}

          {/* Items */}
          <ul className="flex-1 divide-y divide-white/5 overflow-y-auto px-1 py-1">
            {draftItems.map((item) => {
              const { title, sub } = describe(item);
              return (
                <li key={item.id} className="flex items-start gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-gray-100">{title}</p>
                    {sub && <p className="truncate text-[10px] text-gray-500">{sub}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    aria-label="Remove from briefcase"
                    className="shrink-0 rounded p-1 text-gray-500 transition-colors hover:text-red-400"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M4.3 3.3 8 7l3.7-3.7 1 1L9 8l3.7 3.7-1 1L8 9l-3.7 3.7-1-1L7 8 3.3 4.3z" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Footer */}
          <div className="shrink-0 border-t border-[#0a8078]/30 p-3">
            <Link
              href="/project/draft"
              className="block w-full rounded-lg btn-gradient px-4 py-2 text-center text-xs font-semibold text-navy-dark"
            >
              Open project
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
