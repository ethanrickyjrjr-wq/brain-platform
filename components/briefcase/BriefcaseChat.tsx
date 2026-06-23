"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useChatStream, parseChatFrame, type ChatFrame } from "@/lib/chat/use-chat-stream";
import { useProjectThread } from "@/lib/chat/use-project-thread";
import { useBriefcase } from "@/components/briefcase/BriefcaseProvider";
import { useAiContext } from "@/components/briefcase/use-ai-context";
import { buildQaItem } from "@/lib/briefcase/qa-item";
import { routeFiledItem } from "@/lib/briefcase/file-routing";
import { describePage, projectPageContextForPath } from "@/lib/chat/page-context";
import { briefcaseDigest } from "@/lib/briefcase/briefcase-digest";
import { ChatScheduleCard } from "@/components/briefcase/ChatScheduleCard";
import { projectIdFromPath } from "@/lib/briefcase/pill-mount";
import { getAiContext } from "@/lib/project/ai-context-store";
import type { ProjectItem } from "@/lib/project/items";
import { DockChart } from "@/components/highlighter/DockChart";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";

/**
 * The global Briefcase's standalone chat (off /r/*). Streams via the SHARED
 * useChatStream hook against /api/assistant in the OUTSIDE/PROJECT context — a
 * project-aware, grounded SWFL market analyst (not the cold-lead funnel voice the
 * public /welcome landing page uses). Two capabilities ride on top of the stream:
 *   - "File this answer" — files the last answer as a `qa` item into the briefcase.
 *   - "Summarize…" — condenses the whole session into one filed item (the assistant
 *     `action:"summarize"`), deduping against what's already filed.
 *
 * `starterPrompts` are the context-aware prompts the panel computes from A-7
 * (page + anon revisit count); shown only until the first message.
 *
 * The free weekly cap is enforced server-side by the conversation path when
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

  // Active project — drives per-project thread isolation.
  const aiContext = useAiContext();
  const projectId = aiContext?.projectId ?? null;
  const { thread, save, clear, nudgeItems, nudgeTimeLabel } = useProjectThread(projectId);

  // Grounding identity captured from the prelude `place` frame, so a filed Q&A
  // pins the same ZIP + freshness token the answer was grounded on. Refs (not
  // state) — these change mid-stream and must not trigger re-render.
  const placeRef = useRef<{ zip: string; name: string } | null>(null);
  const tokenRef = useRef<string | undefined>(undefined);
  // The grounded place ALSO drives the in-chat "Send weekly" card — that needs a
  // re-render, so it's mirrored into state (set once per answer when the prelude
  // place frame lands; a no-op setState when the ZIP is unchanged).
  const [place, setPlace] = useState<{ zip: string; name: string } | null>(null);
  // The deterministic, cited chart for the current answer (prelude `chart` frame).
  // Reset per question in submit() so it never lingers from a prior turn.
  const [chart, setChart] = useState<ChartSpec | null>(null);
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
    } else if (f.type === "chart" && f.chart) {
      setChart(f.chart as ChartSpec);
    }
  };

  const { messages, setMessages, busy, send } = useChatStream("/api/assistant", {
    onFrame,
    // The single capture point: every send (chip or typed) carries WHERE the user
    // is + WHAT'S in their briefcase, read live so it's current at click time. On a
    // project page, also name the open project (scope + contents) via the live digest
    // from the context-bus store (read at send time → never stale) so the analyst
    // answers at the project's grain (Piece 2 §D). Rides the SAME pageContext field —
    // no new request field, no route change; the route clamps + DATA-frames it.
    getExtraBody: () => {
      const path = pathname ?? "/";
      // projectPageContextForPath reads the live store + guards projectId===path (so a
      // stale digest from a previous project never leaks into this project's chat).
      return {
        // The honest AssistantRequest contract, computed client-side (was the legacy
        // {mode:"analyst"} the deleted shim mapped): PROJECT AI when a project is open,
        // else OUTSIDE AI — never the public funnel voice (that's /welcome only).
        context: projectId ? ("project" as const) : ("outside" as const),
        // The open project's id → the engine's cookie-authed TIER B cross-project read
        // (shallow, frozen, advisory index of the user's OTHER projects). Undefined off a
        // project page → no read. RLS still scopes the read server-side regardless.
        project_id: projectId ?? undefined,
        pageContext: describePage(path, projectPageContextForPath(path, getAiContext())),
        briefcase: briefcaseDigest(briefcase?.draftItems ?? []),
      };
    },
  });

  // Every new question re-grounds from scratch — clear the PRIOR answer's grounding
  // (place + freshness token) before streaming the next one, so the in-chat "Send
  // weekly" card never lingers from a previous ZIP. Without this, a region-wide
  // "Southwest Florida" follow-up (whose prelude carries no 5-digit place) keeps the
  // last town's card. The next answer's prelude `place` frame re-populates these.
  const submit = (text: string) => {
    if (busy || !text.trim()) return; // mirror useChatStream.send's own guard
    placeRef.current = null;
    tokenRef.current = undefined;
    setPlace(null);
    setChart(null);
    send(text);
  };

  const [input, setInput] = useState("");
  const [filed, setFiled] = useState<string | null>(null);
  const [summaryState, setSummaryState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  // Swap to the new project's stored thread when the active project changes.
  // "Set state during render" pattern — avoids react-hooks/set-state-in-effect.
  const [loadedProjectId, setLoadedProjectId] = useState(projectId);
  if (loadedProjectId !== projectId) {
    setLoadedProjectId(projectId);
    setMessages(thread.messages);
    setNudgeDismissed(false);
  }

  // Persist messages to localStorage after each exchange (localStorage write only —
  // no setState here, so useEffect is safe per the rule).
  useEffect(() => {
    if (messages.length > 0) save(messages);
  }, [messages, save]);

  // Keep the latest message in view while streaming — DOM-only effect (no setState).
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  function fileAnswer(answer: string) {
    // The most recent user turn is the question this answer responds to.
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    routeFiledItem(
      buildQaItem({
        report_id: placeRef.current?.zip || "swfl",
        question: lastUser,
        answer,
        freshness_token: tokenRef.current,
      }),
      projectId,
      (i) => briefcase?.fileItem(i),
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
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // summarize is an ACTION within outside/project, not a context (was the legacy
        // {mode:"summarize"} the deleted shim mapped to action:"summarize").
        body: JSON.stringify({
          context: projectId ? "project" : "outside",
          action: "summarize",
          messages: convo,
          alreadyFiled,
          project_id: projectId ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("summarize failed");
      const text = (await drainSseText(res)).trim();
      if (!text) throw new Error("empty summary");
      routeFiledItem(
        buildQaItem({
          report_id: placeRef.current?.zip || "swfl",
          question: "Conversation summary",
          answer: text,
          freshness_token: tokenRef.current,
        }),
        projectId,
        (i) => briefcase?.fileItem(i),
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
          {/* PHONE ONLY: show just the first prompt so the panel stays short over the
              homepage map; every prompt after the first is hidden < sm and restored at sm:
              (desktop is unchanged). */}
          {starterPrompts.map((p, i) => (
            <li key={p} className={i === 0 ? undefined : "hidden sm:block"}>
              <button
                type="button"
                onClick={() => submit(p)}
                className="w-full rounded-lg border border-[#0a8078] bg-[#0a8078]/10 px-3 py-2 text-left text-xs text-[#f0ede6] transition-colors hover:bg-[#0a8078]/20 hover:text-[#0a8078]"
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!nudgeDismissed && nudgeItems && nudgeItems.length > 0 && (
        <div className="mb-2 rounded-lg border border-[#0a8078]/30 bg-[#0f1d24] p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs text-gray-500">Last session · {nudgeTimeLabel}</span>
            <button
              type="button"
              onClick={() => setNudgeDismissed(true)}
              aria-label="Dismiss"
              className="text-xs text-gray-600 transition-colors hover:text-gray-400"
            >
              ×
            </button>
          </div>
          <ul className="space-y-0.5">
            {nudgeItems.map((item, i) => (
              <li key={i} className="text-xs text-gray-400">
                · {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {messages.length > 0 && (
        <div className="mb-1 flex items-center justify-end">
          <button
            type="button"
            onClick={() => {
              clear();
              setMessages([]);
              setNudgeDismissed(false);
            }}
            className="text-xs text-gray-500 transition-colors hover:text-red-400"
          >
            × Clear
          </button>
        </div>
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
          {chart && (
            <div className="overflow-hidden rounded-lg border border-white/10 bg-[#0d1e2b]/80">
              <div className="px-2 py-1 text-[10px] text-gray-500">Chart</div>
              <DockChart spec={chart} compact />
            </div>
          )}
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
          submit(input);
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
              submit(input);
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
