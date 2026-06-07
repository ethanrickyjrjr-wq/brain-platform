"use client";

import { useEffect, useRef, useState } from "react";
import { buildClaudeHandoff } from "@/lib/highlighter/handoff";
import { useConverse } from "@/lib/highlighter/use-converse";
import {
  applyDockDrag,
  applyDockResize,
  clampDockGeom,
  DOCK_DEFAULT,
  type DockGeom,
} from "@/lib/highlighter/dock-geom";

const GEOM_KEY = "swfl_ai_dock_geom";

// Report-level seed prompts. Each /api/converse call is independently grounded
// in the report dossier (no server-side history), so these are single-shot
// starters, not a threaded conversation.
const PROMPTS = [
  "What's the bottom line?",
  "What's driving this?",
  "How does this compare across SWFL?",
  "What should I watch next?",
];

type Viewport = { width: number; height: number };

function isNarrow(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 639px)").matches
  );
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
  const [stage, setStage] = useState<"compose" | "answer">("compose");
  const [question, setQuestion] = useState("");
  const [copied, setCopied] = useState(false);
  const { ask, answer, reach, error, streaming, reset } = useConverse();
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
    setStage("answer");
    void ask({ reportId, question: trimmed }); // report-level: no fact
  }

  const handoff = buildClaudeHandoff({
    report_id: reportId,
    fact: "",
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

  const containerClass = isMobile
    ? "fixed inset-x-0 bottom-0 top-16 z-[58] flex flex-col rounded-t-2xl border border-gray-200 bg-white text-sm text-gray-900 shadow-2xl shadow-black/50"
    : "fixed z-[58] flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-sm text-gray-900 shadow-2xl shadow-black/50";

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
        className={`flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-2.5 ${
          isMobile ? "" : "cursor-move select-none"
        }`}
        style={isMobile ? undefined : { touchAction: "none" }}
      >
        <div className="flex items-center gap-2 font-semibold text-[#0b6b5a]">
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 2l1.7 4.8L18.5 8.5l-4.8 1.7L12 15l-1.7-4.8L5.5 8.5l4.8-1.7z" />
          </svg>
          Ask AI
          <span className="font-normal text-gray-400">· this report</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 shrink-0 rounded p-1 text-gray-400 transition-colors hover:text-gray-700"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.3 3.3 8 7l3.7-3.7 1 1L9 8l3.7 3.7-1 1L8 9l-3.7 3.7-1-1L7 8 3.3 4.3z" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3">
        {stage === "compose" ? (
          <div>
            <p className="mb-3 text-gray-600">
              Ask anything about this report — answers are grounded in our data
              and cite their source, or say what we don&apos;t hold.
            </p>
            <ul className="flex flex-col gap-1.5">
              {PROMPTS.map((p, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => submit(p)}
                    className="w-full rounded-lg border border-[#00d4aa] bg-[#00d4aa]/5 px-3 py-2 text-left text-gray-800 transition-colors hover:bg-[#00d4aa]/15 hover:text-[#0b6b5a]"
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="whitespace-pre-wrap leading-6 text-gray-800">
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
            {reach.length > 0 && (
              <p className="mt-3 text-xs text-gray-500">
                Also pulled: {reach.join(", ")}
              </p>
            )}
            {!streaming && !error && (
              <button
                type="button"
                onClick={() => {
                  setStage("compose");
                  setQuestion("");
                  reset();
                }}
                className="mt-3 block text-xs text-gray-500 underline underline-offset-2 hover:text-[#0b6b5a]"
              >
                Ask another →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="border-t border-gray-200 p-3"
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
            className="min-w-0 flex-1 resize-none rounded-lg border border-[#00d4aa] bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:border-[#00d4aa] focus:outline-none focus:ring-1 focus:ring-[#00d4aa]/40"
          />
          <button
            type="submit"
            disabled={!question.trim()}
            className="btn-gradient shrink-0 rounded-lg px-4 py-2 text-xs font-semibold text-navy-dark disabled:opacity-40"
          >
            Ask
          </button>
        </div>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={copyHandoff}
            className="text-xs text-blue-600 underline decoration-blue-600/40 underline-offset-2 transition-colors hover:decoration-blue-600"
          >
            {copied ? "Copied ✓" : "Copy prompt for Claude ↗"}
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
          <svg
            className="h-2.5 w-2.5 text-gray-400"
            viewBox="0 0 10 10"
            fill="none"
          >
            <path
              d="M9 1 1 9M9 5 5 9"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
