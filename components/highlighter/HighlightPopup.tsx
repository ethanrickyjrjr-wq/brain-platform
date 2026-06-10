"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { popupPosition, type Position } from "@/lib/highlighter/position";
import { buildClaudeHandoff } from "@/lib/highlighter/handoff";
import { useConverse } from "@/lib/highlighter/use-converse";
import type { SelectedFact } from "@/lib/highlighter/use-highlight";
import { resolveMethod } from "@/refinery/lib/methodology-registry.mts";
import { suggestionsForSpan } from "@/lib/highlighter/suggestions";

interface ChatEntry {
  question: string;
  answer: string;
}

interface PopupProps {
  reportId: string;
  fact: SelectedFact;
  suggestions: string[];
  conclusion?: string;
  freshnessToken?: string;
  onClose: () => void;
}

const POPUP_ID = "highlighter-popup";

function isNarrow(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
}

export function HighlightPopup({
  reportId,
  fact,
  suggestions,
  conclusion,
  freshnessToken,
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
  const [thread, setThread] = useState<ChatEntry[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [showChips, setShowChips] = useState(true);
  const { ask, answer, reach, answered, error, streaming, reset } = useConverse();

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
  const chips = entry
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

  function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuestion("");
    setShowChips(false);

    // Build full history including the currently-live exchange BEFORE any state updates
    const allEntries: ChatEntry[] = [
      ...thread,
      ...(activeQuestion && answer ? [{ question: activeQuestion, answer }] : []),
    ];
    const ctx =
      allEntries.length > 0
        ? "\n\nPrior context from this session:\n" +
          allEntries.map((m) => `Q: ${m.question}\nA: ${m.answer}`).join("\n\n")
        : "";

    // Archive current live exchange to the thread
    if (activeQuestion && answer) {
      setThread((t) => [...t, { question: activeQuestion, answer }]);
    }

    setActiveQuestion(trimmed);
    reset();
    void ask({
      reportId,
      fact: factWithContext,
      slug: fact.slug,
      question: trimmed + ctx,
    });
  }

  const handoff = buildClaudeHandoff({
    report_id: reportId,
    fact: factWithContext,
    conclusion: conclusion ?? "",
    freshness_token: freshnessToken ?? "",
  });

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
          ? "fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-2xl border border-[#00d4aa] bg-[#2c3539] text-sm text-gray-100 shadow-2xl shadow-black/50"
          : "fixed z-[60] flex w-[min(92vw,360px)] max-h-[80vh] flex-col rounded-xl border border-[#00d4aa] bg-[#2c3539] text-sm text-gray-100 shadow-2xl shadow-black/50"
      }
      style={containerStyle}
    >
      {/* Header — drag handle on desktop */}
      <div
        onPointerDown={startDrag}
        className={`flex shrink-0 items-start justify-between gap-2 border-b border-[#00d4aa]/30 px-3 py-2.5 ${
          isMobile ? "" : "cursor-move select-none"
        }`}
        style={isMobile ? undefined : { touchAction: "none" }}
      >
        <div className="min-w-0 flex-1">
          {isSection ? (
            <p className="line-clamp-1 break-words text-xs font-semibold text-[#00d4aa]">
              {sectionLabel}
            </p>
          ) : (
            <>
              {fact.context && (
                <p className="mb-0.5 line-clamp-1 break-words text-[10px] text-gray-500">
                  {fact.context}
                </p>
              )}
              <p className="line-clamp-1 break-words font-mono text-xs font-semibold text-[#00d4aa]">
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

      {/* Chat body — scrollable */}
      <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-2">
        {/* Archived thread */}
        {thread.map((entry, i) => (
          <div key={i}>
            <p className="mb-1 ml-6 rounded-lg bg-[#00d4aa]/10 px-2.5 py-1.5 text-right text-xs text-gray-300">
              {entry.question}
            </p>
            <p className="whitespace-pre-wrap text-xs leading-5 text-gray-200">{entry.answer}</p>
            {(i < thread.length - 1 || activeQuestion) && (
              <div className="mt-3 border-t border-[#00d4aa]/10" />
            )}
          </div>
        ))}

        {/* Live / current exchange */}
        {activeQuestion && (
          <div>
            <p className="mb-1 ml-6 rounded-lg bg-[#00d4aa]/10 px-2.5 py-1.5 text-right text-xs text-gray-300">
              {activeQuestion}
            </p>
            <div className="whitespace-pre-wrap text-xs leading-5 text-gray-200">
              {error ? (
                <span className="text-red-400">{error}</span>
              ) : (
                <>
                  {answer}
                  {streaming && (
                    <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-[#0b6b5a]/80 align-middle" />
                  )}
                </>
              )}
            </div>
            {reach.length > 0 && !streaming && (
              <p className="mt-1.5 text-[10px] text-gray-500">Also pulled: {reach.join(", ")}</p>
            )}
            {!streaming && !error && answered === false && (
              <div className="mt-2 rounded-lg border border-amber-400/60 bg-amber-50/10 px-2.5 py-2">
                <p className="mb-1.5 text-[11px] text-amber-300">
                  This data isn&apos;t in the lake yet. Want us to add it?
                </p>
                <button
                  type="button"
                  onClick={onClose}
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
              <div className="mb-2 border-t border-[#00d4aa]/10 pt-2">
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
                    onClick={() => submit(s)}
                    className="w-full rounded-lg border border-[#00d4aa] bg-[#00d4aa]/5 px-3 py-2 text-left text-xs text-gray-100 transition-colors hover:bg-[#00d4aa]/20 hover:text-[#00d4aa]"
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
        className="shrink-0 border-t border-[#00d4aa]/30 p-3"
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
            className="min-w-0 flex-1 resize-none rounded-lg border border-[#00d4aa] bg-white px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-[#00d4aa] focus:outline-none focus:ring-1 focus:ring-[#00d4aa]/40"
          />
          <button
            type="submit"
            disabled={!question.trim() || streaming}
            className="btn-gradient shrink-0 rounded-lg px-4 py-2 text-xs font-semibold text-navy-dark disabled:opacity-40"
          >
            Ask
          </button>
        </div>

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
                  className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-[#00d4aa]/10 hover:text-[#00d4aa]"
                >
                  Copy key facts
                </button>
                <button
                  type="button"
                  onClick={() => copyText(handoff)}
                  className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-[#00d4aa]/10 hover:text-[#00d4aa]"
                >
                  Copy research prompt
                </button>
                {lastAnswer && (
                  <button
                    type="button"
                    onClick={() => copyText(lastAnswer)}
                    className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-[#00d4aa]/10 hover:text-[#00d4aa]"
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
      </form>
    </div>
  );
}
