"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { popupPosition, type Position } from "@/lib/highlighter/position";
import { buildClaudeHandoff } from "@/lib/highlighter/handoff";
import { useConverse } from "@/lib/highlighter/use-converse";
import type { SelectedFact } from "@/lib/highlighter/use-highlight";
import { resolveMethod } from "@/refinery/lib/methodology-registry.mts";
import { suggestionsForSpan, deriveSelectionType } from "@/lib/highlighter/suggestions";
import { useHighlighterContext, type ChatEntry } from "@/lib/highlighter/context";
import { useFiler } from "@/lib/briefcase/file-routing";
import type { ProjectItem } from "@/lib/project/items";
import { DockChart } from "./DockChart";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";
import type { AssistantContext } from "@/lib/assistant/contract";

// Frames whose chart can be filed to a project (mirrors AskAiDock). bar-table
// only today; zhvi-area + corridor-scatter stay gated. Extend by adding a
// frameId here — explicit, never implicit on a type shape.
const FILABLE_FRAMES = new Set<string>(["bar-table"]);

/** The matched metric's value + provenance, resolved by GlobalHighlighter (via the
 *  report-context store) so "File this figure" can pin a sourced snapshot. Structurally
 *  a subset of MetricSuggestion. Null for prose / unmatched selections. */
interface FileableMetric {
  label: string;
  value?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  freshnessToken?: string;
}

interface PopupProps {
  /**
   * Encoded report surface to GROUND on (`buildReportId(...)`). Optional: undefined
   * OFF-report (home/charts/…), where the answer comes from the OUTSIDE-AI conversation
   * path. This is GROUNDING only — NOT the conversation-thread key (see `threadKey`) and
   * NOT the filing report_id (see the `"swfl"` sentinel). Never pass a pathname here.
   */
  reportId?: string;
  /**
   * The bucket for this popup's conversation thread in the shared HighlighterProvider
   * (`ctx.thread`/`archiveExchange`). On `/r/*` it equals the reportId (per-report
   * thread); OFF-report it is the single `"outside"` bucket so the whole site shares one
   * continuous conversation (parity with the pill's off-project thread).
   */
  threadKey: string;
  fact: SelectedFact;
  suggestions: string[];
  fileableMetric?: FileableMetric | null;
  conclusion?: string;
  freshnessToken?: string;
  /** Assistant grounding for the converse call — computed by GlobalHighlighter from the
   *  project-context store (mirrors the pill's getExtraBody). Undefined off a project. The
   *  digest prop is `briefcaseText` (NOT `briefcase`) — `briefcase` is already the
   *  useBriefcase() binding below; reusing it would be a duplicate identifier. */
  context?: Exclude<AssistantContext, "public">;
  projectId?: string;
  pageContext?: string;
  briefcaseText?: string;
  onClose: () => void;
}

const POPUP_ID = "highlighter-popup";

function isNarrow(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
}

export function HighlightPopup({
  reportId,
  threadKey,
  fact,
  suggestions,
  fileableMetric,
  conclusion,
  freshnessToken,
  context,
  projectId,
  pageContext,
  briefcaseText,
  onClose,
}: PopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isMobile, setIsMobile] = useState(isNarrow);
  const [question, setQuestion] = useState("");
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  // Thread now lives in the shared provider so it survives close/reopen and is
  // shared with the Ask-AI dock. activeQuestion stays local (transient live state).
  const ctx = useHighlighterContext();
  // F2: file into the OPEN project (the add-item event) when one is active, else the tray.
  const { file: fileToTarget } = useFiler();
  const thread = useMemo(() => ctx?.thread(threadKey) ?? [], [ctx, threadKey]);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  // Transient "Filed ✓" feedback, keyed per file affordance (figure / live / a<i>).
  const [filed, setFiled] = useState<string | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [showChips, setShowChips] = useState(true);
  const {
    ask,
    answer,
    reach,
    followups,
    answered,
    chart,
    groundedPlace,
    groundedToken,
    error,
    streaming,
    reset,
  } = useConverse();
  const [dismissedChart, setDismissedChart] = useState<unknown>(null);

  // Filing identity. ON /r/*: the real reportId + the report's freshness token. OFF-report:
  // the grounded ZIP captured from the conversation path's prelude `place` frame, falling
  // back to the "swfl" region sentinel — the pill's EXACT off-report convention
  // (`report_id: groundedZip || "swfl"`), so a filed item is always schema-valid and never
  // suppressed (INVARIANT #2). Grounding/threading do NOT use these.
  const filingReportId = reportId ?? (groundedPlace?.zip || "swfl");
  const filingToken = freshnessToken ?? groundedToken;

  // Mobile breakpoint subscription (initial value from lazy initializer above)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Re-show chips when selection changes (new fact highlighted while panel is open)
  const prevFactRef = useRef(fact);
  useEffect(() => {
    if (fact !== prevFactRef.current) {
      setShowChips(true);
      prevFactRef.current = fact;
    }
  }, [fact]);

  // Re-show chips when an answer finishes, so the real-time follow-ups surface.
  // submit() hides chips while composing; without this they'd never reappear
  // within the same selection. Uses the previous-value-ref pattern (mirrors the
  // fact-change effect above) so it only fires on the streaming→done transition,
  // not on mount — and so it doesn't trip react-hooks/set-state-in-effect.
  const prevCompletedRef = useRef(false);
  useEffect(() => {
    const completed = !streaming && Boolean(activeQuestion) && Boolean(answer) && !error;
    if (completed && !prevCompletedRef.current) setShowChips(true);
    prevCompletedRef.current = completed;
  }, [streaming, activeQuestion, answer, error]);

  // Recalculate position when selection moves (desktop only); reset drag on new selection
  useLayoutEffect(() => {
    if (isMobile) return;
    const el = ref.current;
    if (!el) return;
    setPos(
      popupPosition(
        {
          top: fact.rect.top,
          left: fact.rect.left,
          width: fact.rect.width,
          height: fact.rect.height,
        },
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    setDragOffset({ x: 0, y: 0 });
  }, [fact, isMobile]);

  // Esc closes. No outside-click close — panel persists so user can reference the answer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Scroll isolation: while the popup is open, wheel events inside it scroll the body
  // container only — the page never scrolls behind it.
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      if (ref.current?.contains(e.target as Node)) {
        e.preventDefault();
        if (bodyRef.current) bodyRef.current.scrollTop += e.deltaY;
      }
    }
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  // Auto-scroll body to bottom while streaming
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [answer, thread]);

  // Close copy menu on outside click
  useEffect(() => {
    if (!showCopyMenu) return;
    function onDown(e: MouseEvent) {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) setShowCopyMenu(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showCopyMenu]);

  function startDrag(e: React.PointerEvent) {
    if (isMobile) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const base = { ...dragOffset };
    function move(ev: PointerEvent) {
      setDragOffset({ x: base.x + ev.clientX - startX, y: base.y + ev.clientY - startY });
    }
    function end() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }

  const isSection = fact.mode === "section";
  const sectionLabel = fact.context ?? "this section";
  // Always send the REAL selected text (so a chart/section summary has actual
  // content to work with). Sending the bare "this section" label made the AI
  // reply "I don't see a specific highlight" — it had nothing to read.
  const factWithContext = fact.context ? `${fact.context}: ${fact.text}` : fact.text;

  const entry = fact.slug ? resolveMethod(fact.slug) : null;
  // Static heuristic chips — the STARTER set (before any answer) and the fallback
  // when the model didn't return real-time follow-ups.
  const staticChips = entry
    ? suggestionsForSpan({
        entry,
        value: fact.text,
        place: fact.factType === "place" ? fact.text : undefined,
      })
    : isSection
      ? [
          "Give me a plain-English summary of this",
          "What's the most important thing happening here?",
          "What should I be watching or concerned about?",
          "Break this down further",
        ]
      : suggestions;

  // After an answer completes, prefer the model's real-time follow-ups (tailored
  // to that answer); fall back to the static set if the tail was missing.
  const hasCompletedAnswer = Boolean(activeQuestion && answer && !streaming && !error);
  const realtimeChips = hasCompletedAnswer && followups.length > 0;
  const chips = realtimeChips ? followups : staticChips;

  function submit(q: string, opts?: { fromChip?: boolean; isRealtime?: boolean }) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuestion("");
    setShowChips(false);

    // Build full history including the currently-live exchange BEFORE any state updates
    const allEntries: ChatEntry[] = [
      ...thread,
      ...(activeQuestion && answer ? [{ question: activeQuestion, answer }] : []),
    ];
    const priorContext =
      allEntries.length > 0
        ? "\n\nPrior context from this session:\n" +
          allEntries.map((m) => `Q: ${m.question}\nA: ${m.answer}`).join("\n\n")
        : "";

    // Archive current live exchange to the shared provider thread (keyed by threadKey,
    // NOT the grounding reportId — off-report this is the single "outside" bucket).
    if (activeQuestion && answer) {
      ctx?.archiveExchange(threadKey, { question: activeQuestion, answer });
    }

    setActiveQuestion(trimmed);
    reset();
    void ask({
      reportId,
      context,
      projectId,
      pageContext,
      briefcase: briefcaseText, // ConverseInput.briefcase ← the popup's briefcaseText prop
      fact: factWithContext,
      slug: fact.slug,
      selectionType: deriveSelectionType(fact),
      fromChip: opts?.fromChip ?? false,
      isRealtime: opts?.isRealtime ?? false,
      question: trimmed + priorContext,
    });
  }

  // --- Briefcase "File this …" affordances. All event-driven (no effects). ---
  function fileAndMeter(item: ProjectItem, key: string) {
    fileToTarget(item);
    setFiled(key);
    setTimeout(() => setFiled((k) => (k === key ? null : k)), 1800);
    void fetch("/api/meter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "item_add", report_id: filingReportId }),
    }).catch(() => {});
  }

  function fileAnswer(q: string, a: string, key: string, withReach: boolean) {
    fileAndMeter(
      {
        id: crypto.randomUUID(),
        added_at: new Date().toISOString(),
        origin: "web",
        kind: "qa",
        report_id: filingReportId,
        question: q,
        answer: a,
        fact: factWithContext,
        selection_type: deriveSelectionType(fact),
        reach: withReach && reach.length > 0 ? reach : undefined,
        freshness_token: filingToken,
      },
      key,
    );
  }

  function fileFigure() {
    fileAndMeter(
      {
        id: crypto.randomUUID(),
        added_at: new Date().toISOString(),
        origin: "web",
        kind: "metric",
        report_id: filingReportId,
        label: fileableMetric?.label ?? fact.context ?? "Figure",
        value: fileableMetric?.value ?? fact.text,
        source_url: fileableMetric?.sourceUrl,
        source_label: fileableMetric?.sourceLabel,
        freshness_token: fileableMetric?.freshnessToken ?? filingToken ?? "",
      },
      "figure",
    );
  }

  async function fileChart() {
    const cs = chart as ChartSpec | null;
    if (!cs || !cs.frameId || !FILABLE_FRAMES.has(cs.frameId)) return;
    try {
      const res = await fetch("/api/charts/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          block: cs,
          source_meta: { report_id: filingReportId },
          freshness_token: filingToken,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const { id } = (await res.json()) as { id: string };
      fileToTarget({
        id: crypto.randomUUID(),
        added_at: new Date().toISOString(),
        origin: "web",
        kind: "chart",
        chart_id: id,
        title: cs.title,
      });
      setFiled("chart");
      setTimeout(() => setFiled((k) => (k === "chart" ? null : k)), 1800);
    } catch {
      setFiled("chartErr");
      setTimeout(() => setFiled((k) => (k === "chartErr" ? null : k)), 2500);
    }
  }

  // The Claude handoff is inherently report-referencing — it emits a `swfl_fetch
  // report_id="…"` MCP line that is meaningless with the "swfl" sentinel. So it is
  // built (and its UI shown) ONLY on a real report; off-report the affordances hide
  // entirely rather than ship a 404-on-call prompt (#9).
  const handoff = reportId
    ? buildClaudeHandoff({
        report_id: reportId,
        fact: factWithContext,
        conclusion: conclusion ?? "",
        freshness_token: freshnessToken ?? "",
      })
    : "";

  function copyText(text: string) {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {},
    );
    setShowCopyMenu(false);
  }

  const lastAnswer =
    activeQuestion && answer ? answer : thread.length > 0 ? thread[thread.length - 1].answer : "";

  // Shield against running off the bottom: cap the popup's height to the space
  // below its top so it always stays on-screen and the body scrolls inside.
  // popupPosition clamps at OPEN time, but the answer streams in and grows the
  // popup downward afterward — this re-bounds it on every render.
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const effectiveTop = (pos?.top ?? 0) + dragOffset.y;
  const containerStyle: React.CSSProperties = isMobile
    ? { height: "50dvh" }
    : {
        top: (pos?.top ?? -9999) + dragOffset.y,
        left: (pos?.left ?? -9999) + dragOffset.x,
        visibility: pos ? "visible" : "hidden",
        maxHeight: pos ? `${Math.max(180, viewportH - effectiveTop - 12)}px` : undefined,
      };

  return (
    <div
      id={POPUP_ID}
      ref={ref}
      role="dialog"
      aria-label="Ask about this figure"
      className={
        isMobile
          ? "fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-2xl border border-[#0a8078] bg-[#2c3539] text-sm text-gray-100 shadow-2xl shadow-black/50"
          : "fixed z-[60] flex w-[min(92vw,360px)] max-h-[80vh] flex-col rounded-xl border border-[#0a8078] bg-[#2c3539] text-sm text-gray-100 shadow-2xl shadow-black/50"
      }
      style={containerStyle}
    >
      {/* Header — drag handle on desktop */}
      <div
        onPointerDown={startDrag}
        className={`flex shrink-0 items-start justify-between gap-2 border-b border-[#0a8078]/30 px-3 py-2.5 ${
          isMobile ? "" : "cursor-move select-none"
        }`}
        style={isMobile ? undefined : { touchAction: "none" }}
      >
        <div className="min-w-0 flex-1">
          {isSection ? (
            <p className="line-clamp-1 break-words text-xs font-semibold text-[#0a8078]">
              {sectionLabel}
            </p>
          ) : (
            <>
              {fact.context && (
                <p className="mb-0.5 line-clamp-1 break-words text-[10px] text-gray-500">
                  {fact.context}
                </p>
              )}
              <p className="line-clamp-1 break-words font-mono text-xs font-semibold text-[#0a8078]">
                {fact.text}
              </p>
            </>
          )}
        </div>
        {!isMobile && (
          <svg
            className="mt-1 h-3 w-3 shrink-0 text-gray-600"
            viewBox="0 0 12 12"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect y="1" width="12" height="1.5" rx="0.75" />
            <rect y="5.25" width="12" height="1.5" rx="0.75" />
            <rect y="9.5" width="12" height="1.5" rx="0.75" />
          </svg>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded p-1 text-gray-500 transition-colors hover:text-white"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.3 3.3 8 7l3.7-3.7 1 1L9 8l3.7 3.7-1 1L8 9l-3.7 3.7-1-1L7 8 3.3 4.3z" />
          </svg>
        </button>
      </div>

      {/* File-this-figure affordance — numeric selections only. */}
      {!isSection && fact.factType === "metric" && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#0a8078]/20 px-3 py-1.5">
          <button
            type="button"
            onClick={fileFigure}
            className="rounded border border-[#0a8078]/60 px-2 py-1 text-[11px] font-semibold text-[#0a8078] transition-colors hover:bg-[#0a8078]/15"
          >
            {filed === "figure" ? "Filed ✓" : "+ File this figure"}
          </button>
        </div>
      )}

      {/* Chat body — scrollable */}
      <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-2">
        {/* Archived thread — condensed on reopen: question visible, answer behind a tap. */}
        {thread.map((archived, i) => {
          const isOpen = expanded.has(i);
          return (
            <div key={i}>
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
                aria-expanded={isOpen}
                className="mb-1 ml-6 flex w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-lg bg-[#0a8078]/10 px-2.5 py-1.5 text-xs text-gray-300 transition-colors hover:bg-[#0a8078]/20"
              >
                <span className="text-[10px] text-gray-500">{isOpen ? "▾" : "▸"}</span>
                <span className="min-w-0 flex-1 truncate text-left">{archived.question}</span>
              </button>
              {isOpen && archived.answer && (
                <div>
                  <p className="whitespace-pre-wrap text-xs leading-5 text-gray-200">
                    {archived.answer}
                  </p>
                  <button
                    type="button"
                    onClick={() => fileAnswer(archived.question, archived.answer, `a${i}`, false)}
                    className="mt-1 text-[11px] text-[#0a8078] underline underline-offset-2 transition-colors hover:text-[#0a8078]/80"
                  >
                    {filed === `a${i}` ? "Filed ✓" : "File this answer"}
                  </button>
                </div>
              )}
              {(i < thread.length - 1 || activeQuestion) && (
                <div className="mt-3 border-t border-[#0a8078]/10" />
              )}
            </div>
          );
        })}

        {/* Live / current exchange */}
        {activeQuestion && (
          <div>
            <p className="mb-1 ml-6 rounded-lg bg-[#0a8078]/10 px-2.5 py-1.5 text-right text-xs text-gray-300">
              {activeQuestion}
            </p>
            {(() => {
              const cs = chart as ChartSpec | null;
              if (!cs || chart === dismissedChart) return null;
              const canFile = !!cs.frameId && FILABLE_FRAMES.has(cs.frameId);
              return (
                <div className="mb-2 overflow-hidden rounded-lg border border-white/10 bg-[#0d1e2b]/80">
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[10px] text-gray-500">Chart</span>
                    <div className="flex items-center gap-2">
                      {canFile ? (
                        <button
                          type="button"
                          onClick={() => {
                            void fileChart();
                          }}
                          disabled={filed === "chart" || filed === "chartErr"}
                          className="text-[10px] text-[#0a8078] transition-colors hover:text-[#0a8078]/80 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {filed === "chart"
                            ? "Filed ✓"
                            : filed === "chartErr"
                              ? "Save failed"
                              : "File this chart"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            void fetch("/api/meter", {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({
                                action: "chart_save_gated",
                                report_id: reportId,
                              }),
                            }).catch(() => {});
                          }}
                          className="text-[10px] text-gray-500 hover:text-gray-400"
                          title="Saving this chart type is coming soon"
                        >
                          File this chart
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDismissedChart(chart)}
                        className="text-sm leading-none text-gray-500 hover:text-gray-300"
                        aria-label="Dismiss chart"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <DockChart spec={cs} compact />
                </div>
              );
            })()}
            <div className="whitespace-pre-wrap text-xs leading-5 text-gray-200">
              {error ? (
                <span className="text-red-400">{error}</span>
              ) : (
                <>
                  {answer}
                  {streaming && (
                    <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-[#0a8078]/80 align-middle" />
                  )}
                </>
              )}
            </div>
            {reach.length > 0 && !streaming && (
              <p className="mt-1.5 text-[10px] text-gray-500">Also pulled: {reach.join(", ")}</p>
            )}
            {hasCompletedAnswer && activeQuestion && answer && (
              <button
                type="button"
                onClick={() => fileAnswer(activeQuestion, answer, "live", true)}
                className="mt-2 text-[11px] text-[#0a8078] underline underline-offset-2 transition-colors hover:text-[#0a8078]/80"
              >
                {filed === "live" ? "Filed ✓" : "File this answer"}
              </button>
            )}
            {!streaming && !error && answered === false && (
              <div className="mt-2 rounded-lg border border-amber-400/60 bg-amber-50/10 px-2.5 py-2">
                <p className="mb-1.5 text-[11px] text-amber-300">
                  This data isn&apos;t in the lake yet. Want us to add it?
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void fetch("/api/meter", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "data_request", detail: question }),
                    }).catch(() => {});
                    onClose();
                  }}
                  className="rounded border border-amber-400/70 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-400/20"
                >
                  Request this data
                </button>
              </div>
            )}
          </div>
        )}

        {/* Suggestion chips — starter when no thread, follow-up after answers, hidden while streaming */}
        {showChips && !streaming && chips.length > 0 && (
          <div>
            {(thread.length > 0 || activeQuestion) && (
              <div className="mb-2 border-t border-[#0a8078]/10 pt-2">
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-gray-500">
                  {isSection ? "Explore further" : "Follow up"}
                </p>
              </div>
            )}
            {thread.length === 0 && !activeQuestion && (
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-gray-500">
                {isSection ? "Explore this" : "Ask about this"}
              </p>
            )}
            <ul className="flex flex-col gap-1.5">
              {chips.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => submit(s, { fromChip: true, isRealtime: realtimeChips })}
                    className="w-full rounded-lg border border-[#0a8078] bg-[#0a8078]/5 px-3 py-2 text-left text-xs text-gray-100 transition-colors hover:bg-[#0a8078]/20 hover:text-[#0a8078]"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Input footer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="shrink-0 border-t border-[#0a8078]/30 p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onFocus={() => setShowChips(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(question);
              }
            }}
            rows={2}
            placeholder={activeQuestion ? "Ask a follow-up…" : "Ask your own question…"}
            className="min-w-0 flex-1 resize-none rounded-lg border border-[#0a8078] bg-white px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-[#0a8078] focus:outline-none focus:ring-1 focus:ring-[#0a8078]/40"
          />
          <button
            type="submit"
            disabled={!question.trim() || streaming}
            className="btn-gradient shrink-0 rounded-lg px-4 py-2 text-xs font-semibold text-navy-dark disabled:opacity-40"
          >
            Ask
          </button>
        </div>

        {/* Claude-handoff row — report-grounded only. Hidden OFF-report (#9): the handoff
            MCP line needs a real report_id, not the "swfl" sentinel. */}
        {reportId && (
          <div className="mt-2 flex items-center justify-between gap-2">
            {/* Copy options menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowCopyMenu((v) => !v)}
                className="text-xs text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:decoration-blue-400"
              >
                {copied ? "Copied ✓" : "Copy for Claude ▾"}
              </button>
              {showCopyMenu && (
                <div className="absolute bottom-full left-0 z-10 mb-1 w-52 overflow-hidden rounded-lg border border-gray-700 bg-[#1e2b30] py-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        `${factWithContext}${freshnessToken ? `\nFreshness: ${freshnessToken}` : ""}`,
                      )
                    }
                    className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-[#0a8078]/10 hover:text-[#0a8078]"
                  >
                    Copy key facts
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(handoff)}
                    className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-[#0a8078]/10 hover:text-[#0a8078]"
                  >
                    Copy research prompt
                  </button>
                  {lastAnswer && (
                    <button
                      type="button"
                      onClick={() => copyText(lastAnswer)}
                      className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-[#0a8078]/10 hover:text-[#0a8078]"
                    >
                      Copy this answer
                    </button>
                  )}
                </div>
              )}
            </div>

            <a
              href={`https://claude.ai/new?q=${encodeURIComponent(handoff)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:decoration-blue-400"
            >
              Open in Claude ↗
            </a>
          </div>
        )}
      </form>
    </div>
  );
}
