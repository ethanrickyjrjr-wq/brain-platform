"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useConverse } from "@/lib/assistant/use-converse";
import {
  applyDockDrag,
  applyDockResize,
  clampDockGeom,
  DOCK_DEFAULT,
  type DockGeom,
} from "@/lib/highlighter/dock-geom";
import { useHighlighterContext, type ChatEntry } from "@/lib/highlighter/context";
import { useFiler } from "@/lib/briefcase/file-routing";
import { buildQaItem } from "@/lib/briefcase/qa-item";
import { DockChart } from "./DockChart";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";

const GEOM_KEY = "swfl_ai_dock_geom";

const PROMPTS = [
  "What's the bottom line on this market?",
  "Compare this to other SWFL areas",
  "Walk me through the key trends",
  "What should I be watching or worried about?",
];

type Viewport = { width: number; height: number };

function isNarrow(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
}

function restoreGeom(): DockGeom {
  if (typeof window === "undefined") return DOCK_DEFAULT;
  const v = { width: window.innerWidth, height: window.innerHeight };
  try {
    const raw = localStorage.getItem(GEOM_KEY);
    const parsed = raw ? (JSON.parse(raw) as DockGeom) : DOCK_DEFAULT;
    return clampDockGeom(parsed, v);
  } catch {
    return clampDockGeom(DOCK_DEFAULT, v);
  }
}

export function AskAiDock({
  reportId,
  conclusion,
  freshnessToken,
  onClose,
}: {
  reportId: string;
  conclusion?: string;
  freshnessToken?: string;
  onClose: () => void;
}) {
  // The dock only mounts client-side (after the FAB click), so reading
  // window/localStorage in the lazy initializers below is safe and avoids a
  // setState-in-effect cascade (react-hooks/set-state-in-effect).
  const [isMobile, setIsMobile] = useState(isNarrow);
  const [geom, setGeom] = useState<DockGeom>(restoreGeom);
  const [stage, setStage] = useState<"compose" | "summarize" | "answer">("compose");
  const [isSummaryAnswer, setIsSummaryAnswer] = useState(false);
  const [question, setQuestion] = useState("");
  const [customFocus, setCustomFocus] = useState("");
  const [copied, setCopied] = useState(false);
  // Thread is shared with the popup via the provider so the dock and popup show
  // one continuous conversation per report. When no provider is in the tree
  // (dock mounted standalone), fall back to a local thread so it never crashes.
  const ctx = useHighlighterContext();
  const { file } = useFiler();
  const [localThread, setLocalThread] = useState<ChatEntry[]>([]);
  const thread = ctx ? ctx.thread(reportId) : localThread;
  const archive = (entry: ChatEntry) =>
    ctx ? ctx.archiveExchange(reportId, entry) : setLocalThread((t) => [...t, entry]);
  const [activeQuestion, setActiveQuestion] = useState("");
  const { ask, answer, reach, chart, error, streaming, reset } = useConverse();
  const [dismissedChart, setDismissedChart] = useState<unknown>(null);
  const [filed, setFiled] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const vp = (): Viewport => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // --- Mobile = full-screen sheet (no drag/resize). Subscribe only; the
  //     initial value comes from the lazy initializer above. ---
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // --- Esc closes (no outside-click close: a chat dock should persist while
  //     you read the report). ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // --- Keep the latest answer in view while streaming. ---
  useEffect(() => {
    if (stage === "answer" && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [answer, stage]);

  function persist(g: DockGeom) {
    try {
      localStorage.setItem(GEOM_KEY, JSON.stringify(g));
    } catch {
      /* localStorage unavailable — geometry just won't persist */
    }
  }

  // Shared pointer driver for both move (header) and resize (handle). `apply`
  // is the pure dock-geom transform; geometry is clamped on every move and
  // persisted on release.
  function startPointer(
    e: React.PointerEvent,
    apply: (base: DockGeom, dx: number, dy: number, v: Viewport) => DockGeom,
  ) {
    if (isMobile) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const base = geom;
    function move(ev: PointerEvent) {
      setGeom(apply(base, ev.clientX - startX, ev.clientY - startY, vp()));
    }
    function end() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      setGeom((g) => {
        persist(g);
        return g;
      });
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }

  function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setActiveQuestion(trimmed);
    setIsSummaryAnswer(false);
    setStage("answer");
    void ask({ reportId, question: trimmed });
  }

  function archiveAndReset() {
    if (activeQuestion && answer) {
      archive({ question: activeQuestion, answer });
    }
    setActiveQuestion("");
    setIsSummaryAnswer(false);
    setStage("compose");
    setQuestion("");
    reset();
  }

  function buildHistoryContext(): string {
    if (thread.length === 0) return "";
    return (
      "\n\nContext from our conversation:\n" +
      thread.map((h) => `Q: ${h.question}\nA: ${h.answer}`).join("\n\n")
    );
  }

  function submitSummary(prompt: string) {
    setActiveQuestion("summary");
    setIsSummaryAnswer(true);
    setStage("answer");
    void ask({ reportId, question: prompt });
  }

  function triggerSummary(type: "full" | "highlights" | "custom") {
    const reportUrl = typeof window !== "undefined" ? window.location.href : "";
    const urlNote = reportUrl ? ` End with this link on its own line: ${reportUrl}` : "";
    const conclusionNote = conclusion ? ` The report's overall thesis is: "${conclusion}".` : "";
    const freshNote = freshnessToken ? ` Data freshness: ${freshnessToken}.` : "";
    const ctx = buildHistoryContext();

    if (type === "full") {
      submitSummary(
        `Summarize the most important findings from this report in 4-6 sentences — key metrics, what they signal, and the bottom line.${conclusionNote}${freshNote} Write it so someone can paste it into any AI and get useful follow-up answers.${urlNote}${ctx}`,
      );
    } else if (type === "highlights") {
      submitSummary(
        `In 2-3 sentences, what is the single most important thing to know from this report right now?${conclusionNote} Be direct and specific — include the actual numbers.${urlNote}${ctx}`,
      );
    } else {
      const focus = customFocus.trim();
      if (!focus) return;
      submitSummary(
        `The user is focused on: "${focus}". Summarize only the findings from this report most relevant to that. 3-5 sentences, include key numbers, end with the bottom line.${urlNote}${ctx}`,
      );
    }
  }

  function copySummary() {
    void navigator.clipboard?.writeText(answer).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      },
      () => {},
    );
  }

  async function fileChart() {
    const cs = chart as ChartSpec | null;
    if (!cs || !cs.frameId) return;
    try {
      const res = await fetch("/api/charts/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          block: cs,
          source_meta: { report_id: reportId },
          freshness_token: freshnessToken,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const { id } = (await res.json()) as { id: string };
      file({
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

  // Capability parity with the standalone analyst chat: file the current grounded
  // answer as a `qa` item (same builder, so both surfaces produce identical items).
  function fileAnswer() {
    if (!answer) return;
    file(
      buildQaItem({
        report_id: reportId,
        question: activeQuestion,
        answer,
        freshness_token: freshnessToken,
      }),
    );
    setFiled("qa");
    setTimeout(() => setFiled((k) => (k === "qa" ? null : k)), 1800);
  }

  const containerClass = isMobile
    ? "fixed inset-x-0 bottom-0 top-16 z-[58] flex flex-col rounded-t-2xl border border-gulf-teal bg-[#0f1d24] text-sm text-[#f0ede6] shadow-2xl shadow-black/50"
    : "fixed z-[58] flex flex-col overflow-hidden rounded-xl border border-gulf-teal bg-[#0f1d24] text-sm text-[#f0ede6] shadow-2xl shadow-black/50";

  const containerStyle: React.CSSProperties | undefined = isMobile
    ? undefined
    : {
        right: geom.right,
        bottom: geom.bottom,
        width: geom.width,
        height: geom.height,
      };

  return (
    <div
      id="ask-ai-dock"
      role="dialog"
      aria-label="Ask AI about this report"
      className={containerClass}
      style={containerStyle}
    >
      {/* Header / drag handle */}
      <div
        onPointerDown={(e) => startPointer(e, applyDockDrag)}
        className={`flex items-center justify-between gap-2 border-b border-gulf-teal/30 px-4 py-2.5 ${
          isMobile ? "" : "cursor-move select-none"
        }`}
        style={isMobile ? undefined : { touchAction: "none" }}
      >
        <div className="flex items-center gap-2">
          <Image
            src="/logo-transparent.svg"
            alt=""
            aria-hidden="true"
            width={20}
            height={20}
            className="shrink-0"
          />
          <span className="font-semibold text-gulf-teal">SWFL Data Gulf</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 shrink-0 rounded p-1 text-gray-500 transition-colors hover:text-white"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.3 3.3 8 7l3.7-3.7 1 1L9 8l3.7 3.7-1 1L8 9l-3.7 3.7-1-1L7 8 3.3 4.3z" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3">
        {stage === "compose" && (
          <div>
            <p className="mb-3 text-gray-300">
              Ask comparative questions, dig into specific metrics, or explore trends across SWFL —
              all answers pull from verified local data.
            </p>
            <ul className="flex flex-col gap-1.5">
              {PROMPTS.map((p, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => submit(p)}
                    className="w-full rounded-lg border border-gulf-teal bg-gulf-teal/10 px-3 py-2 text-left text-[#f0ede6] transition-colors hover:bg-gulf-teal/20 hover:text-gulf-teal"
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setStage("summarize")}
              className="mt-4 text-xs text-gray-400 underline underline-offset-2 hover:text-gulf-teal"
            >
              Summarize for my AI →
            </button>
          </div>
        )}

        {stage === "summarize" && (
          <div>
            <p className="mb-3 text-gray-300">What should the summary cover?</p>
            <ul className="flex flex-col gap-1.5">
              <li>
                <button
                  type="button"
                  onClick={() => triggerSummary("highlights")}
                  className="w-full rounded-lg border border-gulf-teal bg-gulf-teal/10 px-3 py-2 text-left text-[#f0ede6] transition-colors hover:bg-gulf-teal/20 hover:text-gulf-teal"
                >
                  Just the highlights — 2-3 sentences
                </button>
              </li>
              <li>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customFocus}
                    onChange={(e) => setCustomFocus(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customFocus.trim()) triggerSummary("custom");
                    }}
                    placeholder="Tell me what you care about most…"
                    className="min-w-0 flex-1 rounded-lg border border-gulf-teal bg-[#152832] px-3 py-2 text-sm text-[#f0ede6] placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-gulf-teal/40"
                  />
                  <button
                    type="button"
                    disabled={!customFocus.trim()}
                    onClick={() => triggerSummary("custom")}
                    className="btn-gradient shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-navy-dark disabled:opacity-40"
                  >
                    Go
                  </button>
                </div>
              </li>
            </ul>
            <button
              type="button"
              onClick={() => setStage("compose")}
              className="mt-3 text-xs text-gray-400 underline underline-offset-2 hover:text-gulf-teal"
            >
              ← Back
            </button>
          </div>
        )}

        {stage === "answer" && (
          <>
            {(() => {
              const cs = chart as ChartSpec | null;
              if (!cs || chart === dismissedChart) return null;
              const canFile = !!cs.frameId;
              return (
                <div className="mb-3 overflow-hidden rounded-lg border border-white/10 bg-[#0d1e2b]/80">
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
                          className="text-[10px] text-gulf-teal transition-colors hover:text-gulf-teal/80 disabled:cursor-not-allowed disabled:opacity-50"
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
            <div className="whitespace-pre-wrap leading-6">
              {error ? (
                <span className="text-red-600">{error}</span>
              ) : (
                <>
                  {answer}
                  {streaming && (
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-gulf-teal/80 align-middle" />
                  )}
                </>
              )}
              {reach.length > 0 && (
                <p className="mt-3 text-xs text-gray-500">Also pulled: {reach.join(", ")}</p>
              )}
              {!streaming && !error && isSummaryAnswer && (
                <div className="mt-3 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={copySummary}
                    className="rounded-lg border border-gulf-teal bg-gulf-teal/10 px-4 py-2 text-xs font-semibold text-gulf-teal transition-colors hover:bg-gulf-teal/20"
                  >
                    {copied ? "Copied ✓" : "Copy this summary"}
                  </button>
                  <button
                    type="button"
                    onClick={() => fileAnswer()}
                    disabled={filed === "qa"}
                    className="text-xs text-gulf-teal transition-colors hover:text-gulf-teal/80 disabled:opacity-60"
                  >
                    {filed === "qa" ? "Filed ✓" : "File this summary"}
                  </button>
                </div>
              )}
              {!streaming && !error && !isSummaryAnswer && (
                <div className="mt-3 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => fileAnswer()}
                    disabled={filed === "qa"}
                    className="text-xs text-gulf-teal transition-colors hover:text-gulf-teal/80 disabled:opacity-60"
                  >
                    {filed === "qa" ? "Filed ✓" : "File this answer"}
                  </button>
                  <button
                    type="button"
                    onClick={archiveAndReset}
                    className="text-xs text-gray-500 underline underline-offset-2 hover:text-gulf-teal"
                  >
                    Ask another →
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="border-t border-gulf-teal/30 p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(question);
              }
            }}
            rows={2}
            placeholder="Ask about this report…"
            className="min-w-0 flex-1 resize-none rounded-lg border border-gulf-teal bg-[#152832] px-3 py-2 text-[#f0ede6] placeholder:text-gray-500 focus:border-gulf-teal focus:outline-none focus:ring-1 focus:ring-gulf-teal/40"
          />
          <button
            type="submit"
            disabled={!question.trim()}
            className="btn-gradient shrink-0 rounded-lg px-4 py-2 text-xs font-semibold text-navy-dark disabled:opacity-40"
          >
            Ask
          </button>
        </div>
      </form>

      {/* Resize handle (desktop only) — top-left, grows up-left. */}
      {!isMobile && (
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            startPointer(e, applyDockResize);
          }}
          aria-hidden="true"
          title="Drag to resize"
          className="absolute left-0 top-0 flex h-4 w-4 cursor-nwse-resize items-center justify-center"
          style={{ touchAction: "none" }}
        >
          <svg className="h-2.5 w-2.5 text-gray-400" viewBox="0 0 10 10" fill="none">
            <path d="M9 1 1 9M9 5 5 9" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>
      )}
    </div>
  );
}
