"use client";

import { useState, useSyncExternalStore } from "react";
import { useBriefcase } from "@/components/briefcase/BriefcaseProvider";
import { useSession } from "@/lib/auth/use-session";
import { BriefcasePanel } from "@/components/briefcase/BriefcasePanel";
import { AskAiDock } from "@/components/highlighter/AskAiDock";
import { browserStorage } from "@/lib/briefcase/draft";
import { readVisits, type PillPage } from "@/lib/briefcase/visits";
import { shouldAutoOpenPill } from "@/lib/briefcase/pill-mount";

/**
 * A-3 — the ONE unified "AI + Briefcase" pill. A single bottom-right button on
 * every page (replaces the per-/r/* AskAiFab + Briefcase tray), badge = draft count
 * from the root BriefcaseProvider.
 *
 * Mode (operator decision — Option 1, dock preserved):
 *  - BRIDGED (reportId present, rendered per /r/* page by HighlighterLayer): opens the
 *    EXISTING AskAiDock with ZERO behavior change — the report thread + file-this-chart
 *    stay exactly as they were. (Bridging the dock chat into the panel via use-converse
 *    is PHASE 2, deferred — see A/README.md.)
 *  - STANDALONE (no reportId, mounted once at root by AppShell): opens the A-5
 *    BriefcasePanel (chat + examples + draft + build), no HighlighterContext needed.
 *
 * First-visit auto-open (2026-06-21): the standalone pill pops itself open ONCE for a
 * brand-new, logged-out visitor — the funnel hook (prompts + project examples already
 * live in the panel). Decision is the pure `shouldAutoOpenPill`; see below for why this
 * is hydration-safe and effect-free.
 */

// First visit = the anonymous visit counter is still 0 (BriefcasePanel bumps it to 1
// the first time it mounts). Read it via useSyncExternalStore so the SERVER snapshot is
// always false (pill closed in the SSR HTML) and the real client value lands AFTER
// hydration — no mismatch, and no set-state-in-effect (this repo hard-errors on both).
// Same pattern as use-ai-context.ts / PhoneContactPicker.tsx.
const noopSubscribe = () => () => {};
function firstVisitSnapshot(): boolean {
  return readVisits(browserStorage()) === 0;
}

export function AiBriefcasePill({
  reportId,
  conclusion,
  freshnessToken,
  page = { kind: "generic" },
}: {
  reportId?: string;
  conclusion?: string;
  freshnessToken?: string;
  page?: PillPage;
}) {
  const briefcase = useBriefcase();
  const session = useSession();
  const count = briefcase?.draftItems.length ?? 0;
  const bridged = typeof reportId === "string" && reportId.length > 0;

  const [open, setOpen] = useState(false);
  // One-shot guard so the funnel pop fires at most once per page load: right after it
  // opens, the BriefcasePanel mounts and bumps the visit counter (flipping
  // firstVisitSnapshot to false). The guard keeps that flip from yanking the panel
  // back closed, and the user's own toggles win from here on.
  const [autoOpenResolved, setAutoOpenResolved] = useState(false);
  const firstVisit = useSyncExternalStore(noopSubscribe, firstVisitSnapshot, () => false);

  // The auto-open decision runs DURING RENDER (no effect — the repo bans
  // set-state-in-effect), and only once auth has RESOLVED (`session !== null`) so a
  // logged-in first-load never flashes open. Set-state-during-render is the sanctioned
  // no-effect pattern; `autoOpenResolved` prevents a render loop. Because `session` is
  // null in SSR + the first client paint, this is skipped during hydration — the
  // committed DOM matches the server HTML before the pop fires.
  if (!autoOpenResolved && session !== null) {
    setAutoOpenResolved(true);
    if (shouldAutoOpenPill({ firstVisit, authed: session.authed, bridged })) {
      setOpen(true);
    }
  }

  return (
    <>
      <div className="fixed bottom-4 right-4 z-[56] print-hide">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Close AI and Briefcase" : "Open AI and Briefcase"}
          className="btn-gradient relative flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-navy-dark shadow-lg shadow-black/40 transition-transform hover:scale-105 active:scale-95"
        >
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 512 512" fill="none" aria-hidden="true">
            <g stroke="currentColor" strokeLinecap="round" strokeWidth="56">
              <path d="M80 160 C 144 112, 208 112, 256 160 C 304 208, 368 208, 432 160" />
              <path
                d="M80 256 C 144 208, 208 208, 256 256 C 304 304, 368 304, 432 256"
                opacity="0.7"
              />
              <path
                d="M80 352 C 144 304, 208 304, 256 352 C 304 400, 368 400, 432 352"
                opacity="0.4"
              />
            </g>
          </svg>
          <span>{open ? "Close" : "AI + Briefcase"}</span>
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-navy-dark px-1 text-[11px] font-bold text-[#0a8078]">
              {count}
            </span>
          )}
        </button>
      </div>

      {/* BRIDGED: the existing report dock, untouched (thread + file-this-chart). */}
      {open && bridged && (
        <div className="print-hide">
          <AskAiDock
            reportId={reportId}
            conclusion={conclusion}
            freshnessToken={freshnessToken}
            onClose={() => setOpen(false)}
          />
        </div>
      )}

      {/* STANDALONE: the A-5 project-view panel in a popover shell. */}
      {open && !bridged && (
        <div
          role="dialog"
          aria-label="AI and Briefcase"
          // PHONE ONLY: the auto-open sheet was max-h-[80vh] and buried the homepage map
          // on first visit. Cap it at 60vh so the map stays visible above it. Desktop
          // (sm:) keeps its 70vh / 360px popover unchanged.
          className="fixed inset-x-0 bottom-0 z-[57] flex max-h-[60vh] flex-col overflow-y-auto rounded-t-2xl border border-[#0a8078] bg-[#2c3539] p-4 shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-20 sm:right-4 sm:max-h-[70vh] sm:w-[360px] sm:rounded-xl"
        >
          <BriefcasePanel page={page} />
        </div>
      )}
    </>
  );
}
