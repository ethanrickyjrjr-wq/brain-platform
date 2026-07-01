"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useChatStream } from "@/lib/assistant/use-chat-stream";
import { describePage } from "@/lib/chat/page-context";
import { DockChart } from "@/components/highlighter/DockChart";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";
import { CitationList } from "@/components/CitationList";
import type { WelcomeSource } from "@/lib/welcome/frames";

/** The four hardcoded arrival prompts. #1 leads with the recurring-email hook (the
 *  product); #2 is the instant "try it" build; #3 and #4 are conversion prompts. */
const PROMPTS = [
  "Auto-email fresh market data to my clients every week, in my brand",
  "Build me a cited one-pager for a ZIP right now",
  "What's the best lead-gen send for my buyers vs. sellers?",
  "Run this inside my own AI (Claude / ChatGPT)",
];

/**
 * The general, multi-turn conversational chat — the recurring-email hook and the
 * conversational prompts. Streaming now runs on the shared `useChatStream` hook
 * (lib/assistant/use-chat-stream) so there is ONE multi-turn implementation across the
 * welcome page and the global Briefcase pill (A-6 DRY); behavior is unchanged.
 * The ZIP-first grounded answer lives in its sibling GroundedAnswer.
 */
export function ConversationalChat() {
  const pathname = usePathname();
  // The deterministic, cited chart for the current answer (prelude `chart` frame),
  // reset per question in `ask` so it never lingers from a prior turn.
  const [chart, setChart] = useState<ChartSpec | null>(null);
  // Lane-3 web-verified sources for the current answer (prelude `sources` frame),
  // reset per question in `ask` like `chart`.
  const [sources, setSources] = useState<WelcomeSource[]>([]);
  const { messages, busy, send } = useChatStream("/api/assistant", {
    // The public /welcome funnel context of the one assistant (OUTSIDE AI, no auth).
    body: { context: "public" },
    // Context-aware on /welcome too: tell the backend where the visitor landed.
    // (No briefcase here — the funnel page has no draft yet.)
    getExtraBody: () => ({ pageContext: describePage(pathname ?? "/welcome") }),
    onFrame: (f) => {
      if (f.type === "chart" && f.chart) setChart(f.chart as ChartSpec);
      else if (f.type === "sources" && Array.isArray(f.sources))
        setSources(f.sources as WelcomeSource[]);
    },
  });
  const ask = (text: string) => {
    if (busy || !text.trim()) return;
    setChart(null);
    setSources([]);
    send(text);
  };
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as it streams. DOM-only effect (no setState),
  // so it does not trip react-hooks/set-state-in-effect.
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  return (
    <div>
      {messages.length === 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => ask(p)}
              className="rounded-lg border border-gulf-haze bg-gulf-slate px-4 py-3 text-left text-sm text-text-primary transition-colors hover:border-[color:var(--brand-primary)]"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 rounded-xl border border-gulf-haze bg-gulf-deep p-5">
        <div ref={scrollRef} className="mb-4 max-h-80 space-y-3 overflow-y-auto">
          {messages.map((m, i) => (
            <p
              key={i}
              className={
                m.role === "user"
                  ? "text-sm font-medium text-text-primary"
                  : "whitespace-pre-wrap text-sm text-text-secondary"
              }
            >
              {m.content || (busy ? "…" : "")}
            </p>
          ))}
          {chart && (
            <div className="overflow-hidden rounded-lg border border-gulf-haze bg-gulf-slate">
              <div className="px-2 py-1 text-[10px] text-text-tertiary">Chart</div>
              <DockChart spec={chart} compact />
            </div>
          )}
          {sources.length > 0 && (
            // Lane-3 web sources — the locked collapsed Sources box, pulled snug under
            // the answer in this compact panel (its built-in mt-10 is for full pages).
            <div className="-mt-8">
              <CitationList
                sources={sources.map((s) => ({
                  // A figure source shows "label: value — host"; a provenance-only
                  // source (no value, e.g. comp homepage citations) shows just the label.
                  label:
                    s.value != null
                      ? `${s.label}: ${s.value.toLocaleString("en-US")} — ${s.domain}`
                      : s.label,
                  url: s.url,
                }))}
              />
            </div>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
            setInput("");
          }}
          className="flex items-center gap-2 rounded-lg border border-gulf-haze bg-gulf-slate px-4 py-3"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            placeholder="Ask about SWFL real estate, permits, flood risk…"
            className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-text-on-accent disabled:opacity-50"
            style={{ background: "var(--brand-primary)" }}
          >
            Send
          </button>
        </form>
        <p className="mt-3 font-mono text-[11px] text-text-tertiary">
          Set it once. It emails your clients fresh, cited SWFL data on autopilot.{" "}
          <a href="/billing" className="text-gulf-teal underline underline-offset-2">
            See pricing →
          </a>
        </p>
      </div>
    </div>
  );
}
