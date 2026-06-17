"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useChatStream, parseChatFrame, type ChatFrame } from "@/lib/chat/use-chat-stream";
import { useBriefcase } from "@/components/briefcase/BriefcaseProvider";
import { buildQaItem } from "@/lib/briefcase/qa-item";
import { describePage } from "@/lib/chat/page-context";
import { briefcaseDigest } from "@/lib/briefcase/briefcase-digest";
import { ChatScheduleCard } from "@/components/briefcase/ChatScheduleCard";
import type { ProjectItem } from "@/lib/project/items";

/** A briefcase chat on /project/[id] is project-scoped → a schedule can attach there.
 *  Anywhere else (the global pill) returns null → the card is the login-capture CTA. */
function projectIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/project\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * The global Briefcase's standalone chat (off /r/*). Streams via the SHARED
 * useChatStream hook against /api/welcome/chat in ANALYST mode — a project-aware,
 * grounded SWFL market analyst (not the cold-lead funnel bot the public landing
 * page uses). Two capabilities ride on top of the stream:
 *   - "File this answer" — files the last answer as a `qa` item into the briefcase.
 *   - "Summarize…" — condenses the whole session into one filed item (server
 *     `mode:"summarize"`), deduping against what's already filed.
 *
 * `starterPrompts` are the context-aware prompts the panel computes from A-7
 * (page + anon revisit count); shown only until the first message.
 *
 * The free weekly cap is enforced server-side by /api/welcome/chat when
 * WELCOME_CHAT_FREE_WEEKLY_CAP is set — no metering code lives here (A-6 step 3).
 */

/** Drain a complete SSE response (the short summarize reply) into one string. */
async function drainSseText(res: Response): Promise<string> {
  const raw = await res.text();
  return raw
    .split("\n\n")
    .map((f) => parseChatFrame(f))
    .filter((e): e is ChatFrame => e !== null && typeof e.text === "string")
    .map((e) => e.text as string)
    .join("");
}

export function BriefcaseChat({ starterPrompts = [] }: { starterPrompts?: string[] }) {
  const briefcase = useBriefcase();
  const pathname = usePathname();
  // Grounding identity captured from the prelude `place` frame, so a filed Q&A
  // pins the same ZIP + freshness token the answer was grounded on. Refs (not
  // state) — these change mid-stream and must not trigger re-render.
  const placeRef = useRef<{ zip: string; name: string } | null>(null);
  const tokenRef = useRef<string | undefined>(undefined);
  // The grounded place ALSO drives the in-chat "Send weekly" card — that needs a
  // re-render, so it's mirrored into state (set once per answer when the prelude
  // place frame lands; a no-op setState when the ZIP is unchanged).
  const [place, setPlace] = useState<{ zip: string; name: string } | null>(null);
  const onFrame = (f: ChatFrame) => {
    if (f.type === "place") {
      const p = f.place as { zip?: string; name?: string } | undefined;
      if (p) {
        const next = { zip: p.zip ?? "", name: p.name ?? "" };
        placeRef.current = next;
        setPlace((prev) =>
          prev && prev.zip === next.zip && prev.name === next.name ? prev : next,
        );
      }
      if (typeof f.freshness_token === "string") tokenRef.current = f.freshness_token;
    }
  };

  const { messages, busy, send } = useChatStream("/api/welcome/chat", {
    body: { mode: "analyst" },
    onFrame,
    // The single capture point: every send (chip or typed) carries WHERE the user
    // is + WHAT'S in their briefcase, read live so it's current at click time.
    getExtraBody: () => ({
      pageContext: describePage(pathname ?? "/"),
      briefcase: briefcaseDigest(briefcase?.draftItems ?? []),
    }),
  });
  const [input, setInput] = useState("");
  const [filed, setFiled] = useState<string | null>(null);
  const [summaryState, setSummaryState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view while streaming — DOM-only effect (no setState).
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  function fileAnswer(answer: string) {
    // The most recent user turn is the question this answer responds to.
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    briefcase?.fileItem(
      buildQaItem({
        report_id: placeRef.current?.zip || "swfl",
        question: lastUser,
        answer,
        freshness_token: tokenRef.current,
      }),
    );
    setFiled("qa");
    setTimeout(() => setFiled((k) => (k === "qa" ? null : k)), 1800);
  }

  async function summarize() {
    if (messages.length < 4 || summaryState === "saving") return;
    setSummaryState("saving");
    try {
      // Pass the qa items already filed so the model synthesizes without repeating
      // them verbatim (the basic dedup; F-3 narrows to this-session items).
      const alreadyFiled = (briefcase?.draftItems ?? [])
        .filter((i): i is Extract<ProjectItem, { kind: "qa" }> => i.kind === "qa")
        .map((i) => ({ question: i.question, answer: i.answer }));
      // Append a final user turn so the route's last-must-be-user gate passes;
      // the summarize system prompt does the actual synthesis over the thread.
      const convo = [
        ...messages,
        {
          role: "user" as const,
          content: "Summarize the important findings from this conversation so far.",
        },
      ];
      const res = await fetch("/api/welcome/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "summarize", messages: convo, alreadyFiled }),
      });
      if (!res.ok) throw new Error("summarize failed");
      const text = (await drainSseText(res)).trim();
      if (!text) throw new Error("empty summary");
      briefcase?.fileItem(
        buildQaItem({
          report_id: placeRef.current?.zip || "swfl",
          question: "Conversation summary",
          answer: text,
          freshness_token: tokenRef.current,
        }),
      );
      setSummaryState("done");
      setTimeout(() => setSummaryState((s) => (s === "done" ? "idle" : s)), 1800);
    } catch {
      setSummaryState("error");
      setTimeout(() => setSummaryState((s) => (s === "error" ? "idle" : s)), 2500);
    }
  }

  const summarizeLabel =
    summaryState === "saving"
      ? "Summarizing…"
      : summaryState === "done"
        ? "Filed ✓"
        : summaryState === "error"
          ? "Couldn't summarize — try again"
          : "Summarize conversation → file to project";

  // Show the in-chat "Send weekly" card under a COMPLETE assistant answer that was
  // grounded on a specific in-scope ZIP (the prelude `place` frame carries a 5-digit
  // ZIP only for a resolved SWFL place; the region-wide "Southwest Florida" prelude has
  // an empty zip and is correctly skipped — we never offer a sub-grain send we can't honor).
  const lastMsg = messages[messages.length - 1];
  const scheduleCardPlace =
    !busy &&
    lastMsg?.role === "assistant" &&
    lastMsg.content.length > 0 &&
    place &&
    /^\d{5}$/.test(place.zip)
      ? place
      : null;
  const scheduleProjectId = projectIdFromPath(pathname ?? "/");

  return (
    <div className="flex flex-col">
      {messages.length === 0 && starterPrompts.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1.5">
          {starterPrompts.map((p) => (
            <li key={p}>
              <button
                type="button"
                onClick={() => send(p)}
                className="w-full rounded-lg border border-[#0a8078] bg-[#0a8078]/10 px-3 py-2 text-left text-xs text-[#f0ede6] transition-colors hover:bg-[#0a8078]/20 hover:text-[#0a8078]"
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}

      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="mb-2 max-h-64 space-y-2 overflow-y-auto rounded-lg bg-[#0f1d24] p-3"
        >
          {messages.map((m, i) => {
            const showFile =
              i === messages.length - 1 && m.role === "assistant" && !busy && m.content.length > 0;
            return (
              <div key={i}>
                <p
                  className={
                    m.role === "user"
                      ? "text-xs font-medium text-[#f0ede6]"
                      : "whitespace-pre-wrap text-xs leading-5 text-gray-300"
                  }
                >
                  {m.content || (busy ? "…" : "")}
                </p>
                {showFile && (
                  <button
                    type="button"
                    onClick={() => fileAnswer(m.content)}
                    disabled={filed === "qa"}
                    className="mt-1 text-xs text-[#0a8078] transition-colors hover:text-[#0a8078]/80 disabled:opacity-60"
                  >
                    {filed === "qa" ? "Filed ✓" : "File this answer"}
                  </button>
                )}
              </div>
            );
          })}
          {scheduleCardPlace && (
            <ChatScheduleCard
              key={scheduleCardPlace.zip}
              zip={scheduleCardPlace.zip}
              placeName={scheduleCardPlace.name}
              projectId={scheduleProjectId}
            />
          )}
        </div>
      )}

      {/* Persistent: summarize the whole session into one filed item. Visible once
          the conversation has started; needs ≥ 2 exchanges (4 messages) of substance. */}
      {messages.length > 0 && (
        <button
          type="button"
          onClick={() => void summarize()}
          disabled={messages.length < 4 || summaryState === "saving"}
          title={
            messages.length < 4
              ? "Ask a couple of questions first"
              : "Summarize this conversation and file it to your project"
          }
          className="mb-3 w-full rounded-lg border border-[#0a8078]/40 px-3 py-2 text-xs text-gray-400 transition-colors hover:border-[#0a8078] hover:text-[#0a8078] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {summarizeLabel}
        </button>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
          setInput("");
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
              setInput("");
            }
          }}
          rows={2}
          disabled={busy}
          placeholder="Ask about SWFL real estate, permits, flood risk…"
          className="min-w-0 flex-1 resize-none rounded-lg border border-[#0a8078] bg-[#152832] px-3 py-2 text-xs text-[#f0ede6] placeholder:text-gray-500 focus:border-[#0a8078] focus:outline-none focus:ring-1 focus:ring-[#0a8078]/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="btn-gradient shrink-0 rounded-lg px-4 py-2 text-xs font-semibold text-navy-dark disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
