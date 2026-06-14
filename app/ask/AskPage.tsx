"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useConverse } from "@/lib/highlighter/use-converse";

const STARTERS = [
  "Is Fort Myers Beach a good buy right now?",
  "What's the flood cost in 33931 vs 33908?",
  "Where is residential permit velocity highest in Lee County?",
  "What's asking rent doing on the Naples corridors?",
];

export function AskPage({ initialQ, reportId }: { initialQ: string; reportId: string }) {
  const [question, setQuestion] = useState(initialQ);
  const { ask, answer, streaming, error, reset } = useConverse();
  const answerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasSubmittedInitial = useRef(false);

  // Auto-submit when a ?q= param is provided
  useEffect(() => {
    if (initialQ && !hasSubmittedInitial.current) {
      hasSubmittedInitial.current = true;
      void ask({ reportId, question: initialQ });
    }
  }, [initialQ, reportId, ask]);

  // Scroll answer into view as it streams
  useEffect(() => {
    if (answer && answerRef.current) {
      answerRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [answer]);

  function submit() {
    const q = question.trim();
    if (!q || streaming) return;
    reset();
    void ask({ reportId, question: q });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const showAnswer = streaming || answer || error;

  return (
    <div className="min-h-dvh bg-navy-dark font-sans text-white">
      <div className="mx-auto max-w-2xl px-6 py-12 sm:px-8 sm:py-16">
        {/* Header */}
        <header className="mb-10">
          <Link
            href="/"
            className="flex items-center gap-2 text-gray-400 hover:text-gray-200 transition-colors w-fit"
          >
            <Image
              src="/logo.png"
              alt="SWFL Data Gulf"
              width={28}
              height={28}
              className="h-7 w-7 rounded-lg"
            />
            <span className="text-xs uppercase tracking-wider">SWFL Data Gulf</span>
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Ask anything</h1>
          <p className="mt-2 text-gray-400 text-sm">
            Real data on Southwest Florida — real estate, flood risk, economy, permits, and more.
          </p>
        </header>

        {/* Input */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about SWFL real estate, economy, or market data…"
            rows={3}
            className="w-full resize-none bg-transparent text-white placeholder:text-gray-500 focus:outline-none text-sm"
          />
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
            <span className="text-[11px] text-gray-500">Shift+Enter for new line</span>
            <button
              onClick={submit}
              disabled={!question.trim() || streaming}
              className="btn-gradient rounded-lg px-4 py-2 text-sm font-semibold text-navy-dark disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {streaming ? "Thinking…" : "Ask"}
            </button>
          </div>
        </div>

        {/* Starters — shown when no answer yet */}
        {!showAnswer && (
          <div className="mt-6">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">Try asking</p>
            <div className="flex flex-col gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setQuestion(s);
                    reset();
                    void ask({ reportId, question: s });
                  }}
                  className="text-left rounded-lg border border-white/10 px-4 py-2.5 text-sm text-gray-300 hover:border-[#0a8078]/50 hover:text-white hover:bg-[#0a8078]/5 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Answer */}
        {showAnswer && (
          <div ref={answerRef} className="mt-8">
            <div className="rounded-xl border border-white/10 bg-white/5 p-5">
              {error ? (
                <p className="text-red-400 text-sm">{error}</p>
              ) : (
                <>
                  <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                    {answer}
                    {streaming && (
                      <span className="inline-block w-1.5 h-4 bg-[#0a8078] ml-1 animate-pulse rounded-sm" />
                    )}
                  </p>
                  {!streaming && answer && (
                    <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Grounded in SWFL lake data</span>
                      <button
                        onClick={() => {
                          reset();
                          setQuestion("");
                          setTimeout(() => inputRef.current?.focus(), 50);
                        }}
                        className="text-xs text-[#0a8078] hover:text-[#0a8078]/80 transition-colors"
                      >
                        Ask another →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 border-t border-white/10 pt-6 flex items-center justify-between text-[11px] text-gray-500">
          <span>© SWFL Data Gulf</span>
          <Link href="/r/master" className="hover:text-gray-300 transition-colors">
            Full market report →
          </Link>
        </footer>
      </div>
    </div>
  );
}
