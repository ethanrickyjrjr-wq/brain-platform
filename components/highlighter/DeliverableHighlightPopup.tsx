"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { popupPosition, type Position } from "@/lib/highlighter/position";
import { useSteerSuggestions, type SteerContext } from "@/lib/highlighter/use-steer-suggestions";
import { useConverse } from "@/lib/assistant/use-converse";
import type { IframeSelection } from "@/lib/highlighter/use-iframe-selection";

interface Props {
  deliverableId: string;
  selection: IframeSelection;
  projectId: string | null;
  context: "project" | "outside";
  pageContext?: string;
  briefcase?: string;
  /** Parent is busy submitting the edit — lock the confirm button. */
  confirming: boolean;
  onConfirmEdit: (instruction: string) => void;
  onClose: () => void;
}

type Panel = "edit" | "ask";

export function DeliverableHighlightPopup({
  selection,
  projectId,
  context,
  pageContext,
  briefcase,
  confirming,
  onConfirmEdit,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [panel, setPanel] = useState<Panel>("edit");
  const [selectedSteer, setSelectedSteer] = useState<string | null>(null);
  const [customSteer, setCustomSteer] = useState("");
  const [askInput, setAskInput] = useState("");
  const [lastAskQuestion, setLastAskQuestion] = useState("");

  const steerCtx: SteerContext = {
    context,
    projectId: projectId ?? undefined,
    pageContext,
    briefcase,
  };
  const {
    steers,
    loading: steersLoading,
    error: steersError,
  } = useSteerSuggestions(selection.text, steerCtx, panel === "edit");

  const converse = useConverse();

  // Position relative to the translated selection rect (parent-viewport coords).
  // Hidden until the first layout pass measures the popup's actual size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(
      popupPosition(
        selection.rect,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [selection]);

  const containerStyle: React.CSSProperties = {
    top: pos?.top ?? -9999,
    left: pos?.left ?? -9999,
    visibility: pos ? "visible" : "hidden",
  };

  const activeInstruction = selectedSteer ?? (customSteer.trim() || null);
  const canConfirm = activeInstruction !== null && !confirming;

  function submitAsk(q: string) {
    const trimmed = q.trim();
    if (!trimmed || converse.streaming) return;
    setLastAskQuestion(trimmed);
    setAskInput("");
    void converse.ask({
      context,
      projectId: projectId ?? undefined,
      pageContext,
      briefcase,
      question: trimmed,
      fact: selection.text,
    });
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Edit or ask about selection"
      className="fixed z-[70] flex w-[min(94vw,340px)] flex-col overflow-hidden rounded-xl border border-gulf-teal/60 bg-[#0d1e2b] text-sm text-gray-100 shadow-2xl shadow-black/60"
      style={containerStyle}
    >
      {/* Header — selected span preview + close */}
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <p className="line-clamp-2 min-w-0 flex-1 break-words font-mono text-xs text-gulf-teal">
          &ldquo;{selection.text.length > 120 ? `${selection.text.slice(0, 120)}…` : selection.text}
          &rdquo;
        </p>
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

      {/* Panel tabs */}
      <div className="flex shrink-0 border-b border-white/10">
        {(["edit", "ask"] as Panel[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPanel(p)}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              panel === p
                ? "border-b-2 border-gulf-teal text-gulf-teal"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {p === "edit" ? "Edit" : "Ask"}
          </button>
        ))}
      </div>

      {/* Panel body */}
      <div className="max-h-72 overflow-y-auto p-3">
        {panel === "edit" ? (
          <div className="space-y-3">
            <p className="text-[11px] text-gray-400">
              Pick an AI-suggested steer or write your own, then rebuild.
            </p>

            {steersLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gulf-teal border-t-transparent" />
                Suggesting steers…
              </div>
            )}

            {steersError && (
              <p className="text-[11px] text-amber-400">
                Couldn&apos;t generate suggestions — write one below.
              </p>
            )}

            {steers.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {steers.map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSteer((prev) => (prev === s ? null : s));
                        setCustomSteer("");
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        selectedSteer === s
                          ? "border-gulf-teal bg-gulf-teal/15 text-gulf-teal"
                          : "border-white/15 bg-white/5 text-gray-200 hover:border-gulf-teal/60"
                      }`}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div>
              <label className="mb-1 block text-[11px] text-gray-400">
                {steers.length > 0 ? "Or write your own:" : "One-line steer:"}
              </label>
              <input
                type="text"
                value={customSteer}
                onChange={(e) => {
                  setCustomSteer(e.target.value);
                  if (e.target.value) setSelectedSteer(null);
                }}
                placeholder='e.g. "lead with the vacancy trend"'
                className="w-full rounded-md border border-white/15 bg-[#0a1722] px-2.5 py-1.5 text-xs text-white placeholder:text-gray-500 focus:border-gulf-teal focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                if (activeInstruction) onConfirmEdit(activeInstruction);
              }}
              disabled={!canConfirm}
              className="btn-gradient w-full rounded-lg py-2 text-xs font-semibold text-navy-dark disabled:opacity-40"
            >
              {confirming ? "Rebuilding…" : "Confirm & Rebuild"}
            </button>
          </div>
        ) : (
          /* ASK panel — project-grounded converse */
          <div className="space-y-3">
            {converse.error && <p className="text-xs text-red-400">{converse.error}</p>}

            {converse.answer && (
              <div className="space-y-2">
                <p className="whitespace-pre-wrap text-xs leading-5 text-gray-200">
                  {converse.answer}
                  {converse.streaming && (
                    <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-gulf-teal/80 align-middle" />
                  )}
                </p>
                {!converse.streaming && !converse.error && (
                  <button
                    type="button"
                    onClick={() => {
                      // Pre-fill EDIT panel's custom steer from the last question.
                      setCustomSteer(lastAskQuestion || "");
                      setSelectedSteer(null);
                      setPanel("edit");
                    }}
                    className="text-xs text-gulf-teal underline underline-offset-2 transition-colors hover:text-gulf-teal/80"
                  >
                    Rebuild with a steer →
                  </button>
                )}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitAsk(askInput);
              }}
              className="flex items-end gap-2"
            >
              <textarea
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitAsk(askInput);
                  }
                }}
                rows={2}
                placeholder={converse.answer ? "Ask a follow-up…" : "Ask about this passage…"}
                className="min-w-0 flex-1 resize-none rounded-lg border border-gulf-teal/40 bg-[#0a1722] px-2.5 py-1.5 text-xs text-white placeholder:text-gray-500 focus:border-gulf-teal focus:outline-none"
              />
              <button
                type="submit"
                disabled={!askInput.trim() || converse.streaming}
                className="btn-gradient shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-navy-dark disabled:opacity-40"
              >
                Ask
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
