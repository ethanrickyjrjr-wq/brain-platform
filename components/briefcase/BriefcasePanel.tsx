"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/auth/use-session";
import { useBriefcase } from "@/components/briefcase/BriefcaseProvider";
import { browserStorage } from "@/lib/briefcase/draft";
import {
  bumpVisitsOnce,
  promptsForPage,
  createSuggestion,
  ctaIntensity,
  type PillPage,
} from "@/lib/briefcase/visits";
import { panelState, resolveBuildAction } from "@/lib/briefcase/panel-logic";
import { EXAMPLE_CARDS } from "@/lib/briefcase/example-cards";
import { BriefcaseChat } from "@/components/briefcase/BriefcaseChat";
import { MCPInstallCard } from "@/components/briefcase/MCPInstallCard";
import { LoginModal } from "@/components/landing/LoginModal";
import type { ProjectItem } from "@/lib/project/items";

/** One customer-clean line per filed item (no internal ids / jargon). */
function itemTitle(item: ProjectItem): string {
  switch (item.kind) {
    case "qa":
      return item.question;
    case "metric":
      return `${item.label}: ${item.value}`;
    case "chart":
    case "frame":
    case "table_slice":
      return item.title;
    case "source":
      return item.label;
    case "report":
      return item.title ?? item.slug;
    case "note":
      return item.text;
    case "file":
      return item.caption ?? "Attachment";
  }
}

/** Ladder-aligned CTA subtext — escalates by anon revisit count. Builds are NEVER blocked. */
function ladderCopy(intensity: "soft" | "medium" | "hard"): string {
  switch (intensity) {
    case "soft":
      return "Build free — your first month's builds come out clean.";
    case "medium":
      return "Build free. After a month builds carry our mark — go Pro for clean, branded, emailable.";
    case "hard":
      return "Builds are always free. Go Pro for clean, branded, emailable sends (connected via Claude = discount).";
  }
}

/**
 * A-5 — the state-branching pill panel (the "project view"). Renders the panel
 * CONTENT; the A-3 pill provides the popover shell + (on /r/*) the report-thread
 * bridge. Empty draft → pitch + live example cards + the two ladder exits;
 * any filed item → the draft list + the (gated) build path. Copy is
 * "context-aware" (page + anon revisit count), NEVER "learns how you work".
 */
export function BriefcasePanel({ page }: { page: PillPage }) {
  const session = useSession();
  const briefcase = useBriefcase();
  // Count the visit once per PAGE LOAD (not per panel mount — the panel unmounts on
  // pill close + remounts on reopen; bumpVisitsOnce guards against toggle inflation).
  // localStorage write in the lazy init — no effect, SSR-safe.
  const [visits] = useState(() => bumpVisitsOnce(browserStorage()));
  const [loginOpen, setLoginOpen] = useState(false);
  const [showMcp, setShowMcp] = useState(false);

  const authed = session?.authed ?? false;
  const draftItems = briefcase?.draftItems ?? [];
  const state = panelState(draftItems.length);
  const prompts = promptsForPage(page, visits);

  // Create-gate: a logged-out Build opens the login wall; it NEVER POSTs the build
  // API (the build runs at /project, reached only after auth). Authed → /project,
  // which imports the draft and builds. No build POST is ever fired from this panel.
  function onBuild() {
    if (resolveBuildAction(authed) === "login") {
      setLoginOpen(true);
      return;
    }
    window.location.assign("/project");
  }

  return (
    <div className="flex flex-col gap-3 text-sm text-[#f0ede6]">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[#0a8078]">AI + Briefcase</span>
        <span className="text-[10px] text-gray-500">context-aware</span>
      </div>

      <BriefcaseChat starterPrompts={prompts} />

      {state === "pitch" ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-300">
            Ask anything about SWFL, then file the answers, charts, and figures into a project — and
            turn them into a cited, client-ready deliverable.
          </p>

          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-gray-500">
              See a live example
            </p>
            <ul className="grid grid-cols-1 gap-1.5">
              {EXAMPLE_CARDS.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/p/${c.id}`}
                    className="block rounded-lg border border-[#0a8078]/40 bg-[#0a8078]/5 px-3 py-2 transition-colors hover:border-[#0a8078] hover:bg-[#0a8078]/15"
                  >
                    <span className="block text-xs font-semibold text-[#f0ede6]">{c.title}</span>
                    <span className="block text-[10px] text-gray-400">{c.blurb}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onBuild}
              className="btn-gradient w-full rounded-lg px-4 py-2 text-center text-xs font-semibold text-navy-dark"
            >
              Build &amp; send here
            </button>
            <button
              type="button"
              onClick={() => setShowMcp((v) => !v)}
              className="w-full rounded-lg border border-[#0a8078]/60 px-4 py-2 text-center text-xs font-semibold text-[#0a8078] transition-colors hover:bg-[#0a8078]/15"
            >
              Use me in your own Claude — free
            </button>
            {showMcp && <MCPInstallCard />}
          </div>

          <p className="text-[10px] text-gray-500">{ladderCopy(ctaIntensity(visits))}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-[#0a8078]">{createSuggestion(page)}</p>

          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-gray-500">
              In your briefcase · {draftItems.length}
            </p>
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {draftItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 rounded bg-[#0f1d24] px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-200">
                    {itemTitle(item)}
                  </span>
                  <button
                    type="button"
                    onClick={() => briefcase?.removeItem(item.id)}
                    aria-label="Remove from briefcase"
                    className="shrink-0 text-gray-500 transition-colors hover:text-red-400"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M4.3 3.3 8 7l3.7-3.7 1 1L9 8l3.7 3.7-1 1L8 9l-3.7 3.7-1-1L7 8 3.3 4.3z" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={onBuild}
            className="btn-gradient w-full rounded-lg px-4 py-2 text-center text-xs font-semibold text-navy-dark"
          >
            {authed ? "Open project & build" : "Sign in to build"}
          </button>
          <p className="text-[10px] text-gray-500">{ladderCopy(ctaIntensity(visits))}</p>
        </div>
      )}

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
