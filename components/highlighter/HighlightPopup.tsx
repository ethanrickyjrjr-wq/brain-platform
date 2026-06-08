"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { popupPosition, type Position } from "@/lib/highlighter/position";
import { buildClaudeHandoff } from "@/lib/highlighter/handoff";
import { useConverse } from "@/lib/highlighter/use-converse";
import type { SelectedFact } from "@/lib/highlighter/use-highlight";

type Stage = "compose" | "answer";

interface PopupProps {
  reportId: string;
  fact: SelectedFact;
  suggestions: string[];
  conclusion?: string;
  freshnessToken?: string;
  onClose: () => void;
}

const POPUP_ID = "highlighter-popup";

export function HighlightPopup({
  reportId,
  fact,
  suggestions,
  conclusion,
  freshnessToken,
  onClose,
}: PopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [stage, setStage] = useState<Stage>("compose");
  const [question, setQuestion] = useState("");
  const [copied, setCopied] = useState(false);
  const { ask, answer, reach, answered, error, streaming, reset } = useConverse();

  // --- Placement: measure the popup, position via the pure helper. ---
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const popupSize = {
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
    const anchor = {
      top: fact.rect.top,
      left: fact.rect.left,
      width: fact.rect.width,
      height: fact.rect.height,
    };
    setPos(
      popupPosition(anchor, popupSize, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, [fact, stage, answer]);

  // --- Esc + outside-click close (X is wired to onClose directly). ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onDown(e: MouseEvent) {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    // mousedown so it fires before a new selection's mouseup re-opens us.
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  // A chip click or a typed question both land here → switch to the answer
  // view and stream a grounded reply. The SSE/accumulation logic lives in the
  // shared useConverse hook (also used by the Ask-AI dock).
  const isSection = fact.mode === "section";
  const sectionLabel = fact.context ?? "this section";
  // Section mode: send the heading as context, not a 200-word blob.
  const factWithContext = isSection
    ? sectionLabel
    : fact.context
      ? `${fact.context}: ${fact.text}`
      : fact.text;

  const SECTION_CHIPS = [
    "Give me a plain-English summary of this",
    "What's the most important thing happening here?",
    "What should I be watching or concerned about?",
    "Break this down further",
  ];

  function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setStage("answer");
    void ask({ reportId, fact: factWithContext, question: trimmed });
  }

  const handoff = buildClaudeHandoff({
    report_id: reportId,
    fact: factWithContext,
    conclusion: conclusion ?? "",
    freshness_token: freshnessToken ?? "",
  });

  function copyHandoff() {
    void navigator.clipboard?.writeText(handoff).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => setCopied(false),
    );
  }

  return (
    <div
      id={POPUP_ID}
      ref={ref}
      role="dialog"
      aria-label="Ask about this figure"
      className="fixed z-[60] max-h-[85vh] w-[min(92vw,340px)] overflow-y-auto rounded-xl border border-[#00d4aa] bg-[#2c3539] p-4 text-sm text-gray-900 shadow-2xl shadow-black/50"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {isSection ? (
            <>
              <p className="mb-0.5 text-xs text-gray-500">Large selection</p>
              <p className="line-clamp-2 break-words font-semibold text-[#0b6b5a]">
                {sectionLabel}
              </p>
            </>
          ) : (
            <>
              {fact.context && (
                <p className="mb-0.5 line-clamp-2 break-words text-xs text-gray-500">
                  {fact.context}
                </p>
              )}
              <p
                title={factWithContext}
                className="line-clamp-2 break-words font-mono font-semibold text-[#0b6b5a]"
              >
                {fact.text}
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 shrink-0 rounded p-1 text-gray-500 transition-colors hover:text-white"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.3 3.3 8 7l3.7-3.7 1 1L9 8l3.7 3.7-1 1L8 9l-3.7 3.7-1-1L7 8 3.3 4.3z" />
          </svg>
        </button>
      </div>

      {stage === "compose" && (
        <div>
          {(isSection ? SECTION_CHIPS : suggestions).length > 0 && (
            <>
              <p className="mb-2 text-xs uppercase tracking-wider text-gray-500">
                {isSection ? "Explore this" : "Ask about this"}
              </p>
              <ul className="mb-3 flex flex-col gap-1.5">
                {(isSection ? SECTION_CHIPS : suggestions).map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => submit(s)}
                      className="w-full rounded-lg border border-[#00d4aa] bg-[#00d4aa]/5 px-3 py-2 text-left text-gray-900 transition-colors hover:bg-[#00d4aa]/20 hover:text-[#00d4aa]"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(question);
            }}
          >
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              placeholder="Ask your own question…"
              className="w-full resize-none rounded-lg border border-[#00d4aa] bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:border-[#00d4aa] focus:outline-none focus:ring-1 focus:ring-[#00d4aa]/40"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                disabled={!question.trim()}
                className="btn-gradient rounded-lg px-4 py-1.5 text-xs font-semibold text-navy-dark disabled:opacity-40"
              >
                Ask
              </button>
            </div>
          </form>
        </div>
      )}

      {stage === "answer" && (
        <div>
          <div className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap leading-6">
            {error ? (
              <span className="text-red-600">{error}</span>
            ) : (
              <>
                {answer}
                {streaming && (
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[#0b6b5a]/80 align-middle" />
                )}
              </>
            )}
          </div>
          {reach.length > 0 && (
            <p className="mt-3 text-xs text-gray-500">Also pulled: {reach.join(", ")}</p>
          )}
          {!streaming && !error && answered === false && (
            <div className="mt-3 rounded-lg border border-amber-400/60 bg-amber-50/10 px-3 py-2.5">
              <p className="mb-2 text-xs text-amber-300">
                This data isn&apos;t in the lake yet. Want us to add it?
              </p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-amber-400/70 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-400/20"
              >
                Request this data
              </button>
            </div>
          )}
          {!streaming && !error && (
            <button
              type="button"
              onClick={() => {
                setStage("compose");
                setQuestion("");
                reset();
              }}
              className="mt-3 text-xs text-gray-500 underline underline-offset-2 hover:text-[#0b6b5a]"
            >
              Ask another →
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#00d4aa]/30 pt-3">
        <button
          type="button"
          disabled
          title="Charting is coming soon"
          className="cursor-not-allowed rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-400"
        >
          Chart this · soon
        </button>
        <button
          type="button"
          onClick={copyHandoff}
          className="text-xs text-blue-600 underline decoration-blue-600/40 underline-offset-2 transition-colors hover:decoration-blue-600"
        >
          {copied ? "Copied ✓" : "Copy prompt for Claude ↗"}
        </button>
      </div>
    </div>
  );
}
