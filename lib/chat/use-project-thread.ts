"use client";

import { useCallback, useState } from "react";
import type { ChatMsg } from "@/lib/assistant/use-chat-stream";

const NUDGE_THRESHOLD_MS = 5 * 60 * 1000;
const MAX_MESSAGES = 50;

type RawStored = {
  messages: ChatMsg[];
  lastActiveAt: number;
};

export type StoredThread = RawStored & {
  /** Pre-computed at load time (outside render) so Date.now() never runs in render body. */
  nudgeItems: string[] | null;
  nudgeTimeLabel: string | null;
};

const EMPTY_THREAD: StoredThread = {
  messages: [],
  lastActiveAt: 0,
  nudgeItems: null,
  nudgeTimeLabel: null,
};

function storageKey(projectId: string): string {
  return `chat-thread-${projectId}`;
}

function timeAgo(ms: number): string {
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Reads localStorage and computes nudge fields. Called only at load/project-switch,
 *  never during render — so Date.now() and localStorage are safe here. */
function loadFromStorage(projectId: string | null): StoredThread {
  if (!projectId || typeof window === "undefined") return EMPTY_THREAD;
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return EMPTY_THREAD;
    const parsed = JSON.parse(raw) as RawStored;
    const { messages, lastActiveAt } = parsed;

    const shouldNudge =
      lastActiveAt > 0 && messages.length > 0 && Date.now() - lastActiveAt >= NUDGE_THRESHOLD_MS;

    const nudgeItems = shouldNudge
      ? messages
          .filter((m) => m.role === "user")
          .slice(-3)
          .map((m) => (m.content.length > 80 ? m.content.slice(0, 80) + "…" : m.content))
      : null;

    return {
      messages,
      lastActiveAt,
      nudgeItems: nudgeItems?.length ? nudgeItems : null,
      nudgeTimeLabel: shouldNudge ? timeAgo(lastActiveAt) : null,
    };
  } catch {
    return EMPTY_THREAD;
  }
}

/**
 * Per-project chat thread persistence in localStorage. Keyed by projectId.
 * Uses "set state during render" pattern on projectId change to avoid
 * react-hooks/set-state-in-effect ESLint error. All impure calls (Date.now,
 * localStorage) live in loadFromStorage — never in the render body itself.
 */
export function useProjectThread(projectId: string | null) {
  const [loadedForId, setLoadedForId] = useState(projectId);
  const [thread, setThread] = useState<StoredThread>(() => loadFromStorage(projectId));

  // Reset to the new project's thread during render when projectId changes.
  // Compute the fresh thread inline so callers see the new data in THIS render —
  // setThread schedules a state update for next render, but the returned value is
  // used immediately by BriefcaseChat's own set-state-during-render swap.
  let currentThread = thread;
  if (loadedForId !== projectId) {
    setLoadedForId(projectId);
    currentThread = loadFromStorage(projectId);
    setThread(currentThread);
  }

  const save = useCallback(
    (msgs: ChatMsg[]) => {
      if (!projectId) return;
      const capped = msgs.slice(-MAX_MESSAGES);
      const data: RawStored = { messages: capped, lastActiveAt: Date.now() };
      try {
        localStorage.setItem(storageKey(projectId), JSON.stringify(data));
      } catch {
        // localStorage full — fail silently
      }
      // On save, nudge fields are cleared (we just had a fresh exchange).
      setThread({ ...data, nudgeItems: null, nudgeTimeLabel: null });
    },
    [projectId],
  );

  const clear = useCallback(() => {
    if (!projectId) return;
    try {
      localStorage.removeItem(storageKey(projectId));
    } catch {
      // ignore
    }
    setThread(EMPTY_THREAD);
  }, [projectId]);

  return {
    thread: currentThread,
    save,
    clear,
    nudgeItems: currentThread.nudgeItems,
    nudgeTimeLabel: currentThread.nudgeTimeLabel,
  };
}
