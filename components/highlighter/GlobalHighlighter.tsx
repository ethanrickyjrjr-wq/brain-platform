"use client";

import { usePathname } from "next/navigation";
import { useHighlight } from "@/lib/highlighter/use-highlight";
import { useHighlighterContext } from "@/lib/highlighter/context";
import {
  useReportContext,
  resolveSuggestions,
  resolveMetric,
} from "@/lib/highlighter/report-context-store";
import { shouldMountHighlighter } from "@/lib/briefcase/pill-mount";
import { HighlightPopup } from "./HighlightPopup";
import { FirstTouchHint } from "./FirstTouchHint";
import { DiscoveryTicker } from "./DiscoveryTicker";
import { useBriefcase } from "@/components/briefcase/BriefcaseProvider";
import { useAiContext } from "@/components/briefcase/use-ai-context";
import { describePage, projectPageContextForPath } from "@/lib/chat/page-context";
import { briefcaseDigest } from "@/lib/briefcase/briefcase-digest";
import { getAiContext } from "@/lib/project/ai-context-store";

/**
 * The ONE app-root Highlighter — the SELECTION-triggered twin of the CLICK-triggered AI
 * pill (`AppShell`). Mounted once in `app/layout.tsx` INSIDE the lifted `HighlighterProvider`
 * + `BriefcaseProvider`, so it shares the pill's brain (the `/api/assistant` engine) and its
 * file cabinet (the briefcase) on EVERY page — not just the 5 `/r/*` routes it used to live on.
 *
 * It renders ONLY the selection popup + first-touch coachmark + ambient ticker — NEVER a pill
 * (AppShell is the sole pill owner). Two environments, selected by the report-context store the
 * per-report `ReportHighlightBridge` publishes:
 *   - ON /r/*  → report-grounded: the encoded `reportId` grounds the answer, dossier chips +
 *     "File this figure" light up, per-report thread.
 *   - OFF /r/* → OUTSIDE AI: no `reportId` (the engine's `isReportRequest` is false →
 *     conversation path), generic chips, one shared `"outside"` thread for whole-site continuity.
 *
 * Suppressed on the white-label/auth set (`/p/`, `/embed/`, `/login`, `/auth`) via
 * `shouldMountHighlighter`. Selection capture (`use-highlight`) is unchanged — snap-to-word/
 * number + the phone/desktop breakpoint rules carry over byte-identical (INVARIANT #1).
 */
export function GlobalHighlighter() {
  const pathname = usePathname() ?? "/";
  const reportCtx = useReportContext();
  const { fact: selectedFact, clear } = useHighlight();
  // chipFact comes from the (now app-root) HighlighterProvider, set by FactChip taps in
  // MetricsTable on /r/* report pages. Off-report there are no FactChips — only text selection.
  const hctx = useHighlighterContext();
  const chipFact = hctx?.chipFact ?? null;
  const setChipFact = hctx?.setChipFact ?? null;

  const fact = chipFact ?? selectedFact;

  // Project signal — the SAME store the pill reads (useAiContext). Hooks must stay above the
  // only early return (line 54). Both subscribe, so the popup's grounding stays current when
  // the active project or the briefcase changes while the popup is open.
  const aiContext = useAiContext();
  const briefcaseCtx = useBriefcase();

  function close() {
    setChipFact?.(null);
    clear();
    // Don't clear the DOM selection — user may want to copy the highlighted text; the
    // browser clears it naturally on the next click elsewhere.
  }

  // All hooks are above this line — the suppress gate is the only early return.
  if (!shouldMountHighlighter(pathname)) return null;

  const onReport = reportCtx !== null;
  const carried = reportCtx?.metricSuggestions ?? [];
  const projectId = aiContext?.projectId ?? null;
  // Off-report selections share ONE bucket; /r/* keeps per-report threads; inside a project,
  // its own per-project bucket. This is the conversation-thread key, NOT a grounding id.
  const threadKey = reportCtx?.reportId ?? projectId ?? "outside";
  // PROJECT AI when a project is open, else OUTSIDE — never the public funnel voice. Mirrors the
  // pill's getExtraBody (BriefcaseChat.tsx): getAiContext() is the IMPERATIVE store snapshot used
  // inside pageContext (not the hook); describePage/briefcaseDigest are pure.
  const assistantContext = projectId ? ("project" as const) : ("outside" as const);
  const pageContext = describePage(pathname, projectPageContextForPath(pathname, getAiContext()));
  const briefcaseText = briefcaseDigest(briefcaseCtx?.draftItems ?? []);

  return (
    <div className="print-hide">
      {fact && (
        <HighlightPopup
          reportId={reportCtx?.reportId}
          threadKey={threadKey}
          context={assistantContext}
          projectId={projectId ?? undefined}
          pageContext={pageContext}
          briefcaseText={briefcaseText}
          fact={fact}
          // Prefer the dossier's precomputed suggestions for a matched metric (only present
          // on /r/*); off-report `carried` is empty → the client generator's type-aware chips.
          suggestions={fact.mode === "section" ? [] : resolveSuggestions(fact, carried)}
          // The matched metric's value + provenance for "File this figure"; null off-report.
          fileableMetric={fact.mode === "section" ? null : resolveMetric(fact, carried)}
          conclusion={reportCtx?.conclusion}
          freshnessToken={reportCtx?.freshnessToken}
          onClose={close}
        />
      )}
      <FirstTouchHint used={!!fact} />
      <DiscoveryTicker onReport={onReport} />
    </div>
  );
}
